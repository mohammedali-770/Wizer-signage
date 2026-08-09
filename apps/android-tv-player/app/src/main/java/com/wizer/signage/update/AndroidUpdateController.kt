package com.wizer.signage.update

import android.content.Context
import android.os.Build
import com.wizer.signage.BuildConfig
import com.wizer.signage.data.AndroidReleaseClient
import com.wizer.signage.data.AndroidUpdateApiClient
import com.wizer.signage.data.DeviceStore
import com.wizer.signage.data.model.AndroidReleaseDecision
import com.wizer.signage.data.model.AndroidReleasePolicy
import com.wizer.signage.data.model.AndroidUpdateResult
import com.wizer.signage.util.Jitter
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

/**
 * Staged OTA orchestrator. Publishing an APK is not enough to install it: the
 * paired device must first receive an authenticated eligible policy whose exact
 * targetVersionCode matches the public release manifest.
 *
 * Every failure is best-effort telemetry only; playback is never stopped to
 * force an update. Platforms that request user confirmation are deliberately
 * reported BLOCKED instead of opening UI over signage.
 */
class AndroidUpdateController(
    context: Context,
    private val store: DeviceStore,
    private val control: AndroidUpdateApiClient = AndroidUpdateApiClient(),
    private val releases: AndroidReleaseClient = AndroidReleaseClient(),
    private val installer: AndroidUpdateInstaller = AndroidUpdateInstaller(context.applicationContext),
    private val state: AndroidUpdateStateStore = AndroidUpdateStateStore(context.applicationContext),
    private val trustVerifier: (File, String) -> ApkTrustVerifier.Result = { apk, expected ->
        ApkTrustVerifier.verify(context.applicationContext, apk, expected)
    },
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val appContext = context.applicationContext
    private val otaDir = File(appContext.cacheDir, "android-ota").apply { mkdirs() }
    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            delay(Jitter.startupDelay())
            loop()
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun loop() {
        var nextDelayMs = DEFAULT_CHECK_SECONDS * 1000L
        while (coroutineContext.isActive) {
            val token = store.deviceToken
            if (token == null) {
                delay(Jitter.periodic(DEFAULT_CHECK_SECONDS * 1000L))
                continue
            }

            try {
                reconcilePreviousAttempt(token)
                val policy = control.getPolicy(token)
                if (policy != null) {
                    nextDelayMs = policy.checkIntervalSeconds
                        .coerceIn(MIN_CHECK_SECONDS, MAX_CHECK_SECONDS)
                        .toLong() * 1000L
                    evaluateAndInstall(token, policy)
                }
            } catch (_: Exception) {
                // OTA can never take playback down. Any actionable update error
                // is reported inside evaluate/reconcile; network failures wait.
            }
            delay(Jitter.periodic(nextDelayMs))
        }
    }

    private suspend fun reconcilePreviousAttempt(token: String) {
        val snapshot = state.snapshot()
        val target = snapshot.pendingVersionCode ?: return
        val installed = BuildConfig.VERSION_CODE

        if (installed >= target) {
            if (control.report(
                    token,
                    AndroidUpdateResult(
                        state = "INSTALLED",
                        targetVersionCode = target,
                        installedVersionCode = installed,
                    ),
                )
            ) {
                state.clear()
            }
            return
        }

        val terminal = snapshot.state == "FAILED" || snapshot.state == "BLOCKED"
        if (terminal && !snapshot.reported) {
            if (control.report(
                    token,
                    AndroidUpdateResult(
                        state = snapshot.state ?: "FAILED",
                        targetVersionCode = target,
                        installedVersionCode = installed,
                        error = snapshot.error,
                    ),
                )
            ) {
                state.markReported()
                state.clear()
            }
            return
        }

        // A successful PackageInstaller commit normally kills/replaces this
        // process. If the app survived for too long without the version moving,
        // treat it as a failed attempt rather than hammering the same APK forever.
        if (snapshot.attemptedAtMs > 0L && System.currentTimeMillis() - snapshot.attemptedAtMs >= INSTALL_TIMEOUT_MS) {
            val result = AndroidUpdateResult(
                state = "FAILED",
                targetVersionCode = target,
                installedVersionCode = installed,
                error = "install_timeout",
            )
            if (control.report(token, result)) state.clear() else state.record("FAILED", "install_timeout")
        }
    }

    private suspend fun evaluateAndInstall(token: String, policy: com.wizer.signage.data.model.AndroidUpdatePolicy) {
        val target = policy.targetVersionCode ?: return
        if (!policy.enabled || !policy.eligible || target <= BuildConfig.VERSION_CODE) return

        // Never begin a second install while the previous one is unresolved.
        if (state.snapshot().pendingVersionCode != null) return

        val latest = releases.fetchLatest() ?: return
        val decision = AndroidReleasePolicy.evaluate(
            release = latest,
            installedVersionCode = BuildConfig.VERSION_CODE,
            sdkInt = Build.VERSION.SDK_INT,
        )
        if (decision !is AndroidReleaseDecision.UpdateAvailable) return
        if (latest.versionCode != target) return // authenticated policy pins the exact binary

        val staged = File(otaDir, latest.fileName)
        staged.delete()
        if (!releases.downloadVerified(latest, staged)) {
            reportFailure(token, target, "download_verification_failed")
            return
        }

        when (val trust = trustVerifier(staged, latest.certificateSha256)) {
            ApkTrustVerifier.Result.Trusted -> Unit
            is ApkTrustVerifier.Result.Rejected -> {
                staged.delete()
                reportBlocked(token, target, trust.reason)
                return
            }
        }

        // DOWNLOADED is useful fleet telemetry, but inability to report it must
        // not strand an otherwise safe update forever; the terminal result will
        // still reconcile after restart or on the next controller cycle.
        control.report(
            token,
            AndroidUpdateResult(
                state = "DOWNLOADED",
                targetVersionCode = target,
                installedVersionCode = BuildConfig.VERSION_CODE,
            ),
        )

        state.begin(target)
        when (val start = installer.install(staged, target)) {
            AndroidUpdateInstaller.StartResult.Started -> control.report(
                token,
                AndroidUpdateResult(
                    state = "INSTALLING",
                    targetVersionCode = target,
                    installedVersionCode = BuildConfig.VERSION_CODE,
                ),
            )
            is AndroidUpdateInstaller.StartResult.Blocked -> {
                state.record("BLOCKED", start.reason)
                reportBlocked(token, target, start.reason)
            }
            is AndroidUpdateInstaller.StartResult.Failed -> {
                state.record("FAILED", start.reason)
                reportFailure(token, target, start.reason)
            }
        }
    }

    private suspend fun reportFailure(token: String, target: Int, error: String) {
        control.report(
            token,
            AndroidUpdateResult(
                state = "FAILED",
                targetVersionCode = target,
                installedVersionCode = BuildConfig.VERSION_CODE,
                error = error,
            ),
        )
    }

    private suspend fun reportBlocked(token: String, target: Int, error: String) {
        control.report(
            token,
            AndroidUpdateResult(
                state = "BLOCKED",
                targetVersionCode = target,
                installedVersionCode = BuildConfig.VERSION_CODE,
                error = error,
            ),
        )
    }

    companion object {
        private const val MIN_CHECK_SECONDS = 15 * 60
        private const val MAX_CHECK_SECONDS = 24 * 60 * 60
        private const val DEFAULT_CHECK_SECONDS = 6 * 60 * 60
        private const val INSTALL_TIMEOUT_MS = 30 * 60_000L
    }
}
