package com.wizer.signage.update

import android.content.Context
import android.os.Build
import com.wizer.signage.BuildConfig
import com.wizer.signage.data.AndroidReleaseClient
import com.wizer.signage.data.AndroidUpdateApiClient
import com.wizer.signage.data.DeviceStore
import com.wizer.signage.data.model.AndroidReleaseDecision
import com.wizer.signage.data.model.AndroidReleasePolicy
import com.wizer.signage.data.model.AndroidUpdatePolicy
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
 * target versionName + versionCode names one immutable public manifest.
 *
 * Every result carries the exact policy revision that authorized the attempt.
 * This is required both for terminal retry suppression and for the server-side
 * healthy-heartbeat rollback gate: an old attempt must never poison a new save
 * of the same candidate version.
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
                // Reconcile an already-started install independently of policy
                // fetch availability so an app replacement can still report
                // INSTALLED when the policy endpoint has a transient outage.
                reconcilePreviousAttempt(token)

                val policy = control.getPolicy(token)
                if (policy != null) {
                    nextDelayMs = policy.checkIntervalSeconds
                        .coerceIn(MIN_CHECK_SECONDS, MAX_CHECK_SECONDS)
                        .toLong() * 1000L
                    releaseTerminalStateForNewPolicy(policy)
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
        val revision = snapshot.policyRevision
        val installed = BuildConfig.VERSION_CODE

        if (installed >= target) {
            if (control.report(
                    token,
                    AndroidUpdateResult(
                        state = "INSTALLED",
                        policyRevision = revision,
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
        if (terminal) {
            if (
                !snapshot.reported &&
                reportTerminal(
                    token,
                    snapshot.state ?: "FAILED",
                    target,
                    snapshot.error,
                    revision,
                )
            ) {
                state.markReported()
            }
            return
        }

        // A successful PackageInstaller commit normally kills/replaces this
        // process. If the app survived for too long without the version moving,
        // convert the attempt to a sticky FAILED result instead of hammering the
        // same APK forever.
        if (
            snapshot.attemptedAtMs > 0L &&
            System.currentTimeMillis() - snapshot.attemptedAtMs >= INSTALL_TIMEOUT_MS
        ) {
            state.record("FAILED", "install_timeout")
            if (reportTerminal(token, "FAILED", target, "install_timeout", revision)) {
                state.markReported()
            }
        }
    }

    /**
     * A terminal state blocks the exact revision that caused it. An operator
     * saving a new policy revision (including disabling/re-enabling after device
     * provisioning) explicitly authorizes a new attempt.
     */
    private fun releaseTerminalStateForNewPolicy(policy: AndroidUpdatePolicy) {
        val snapshot = state.snapshot()
        if (AndroidUpdateRetryPolicy.shouldRelease(snapshot, policy)) {
            state.clear()
        }
    }

    private suspend fun evaluateAndInstall(token: String, policy: AndroidUpdatePolicy) {
        val targetCode = policy.targetVersionCode ?: return
        val targetName = policy.targetVersionName?.trim()?.takeIf { it.isNotEmpty() } ?: return
        val revision = policy.policyRevision?.trim()?.takeIf { it.isNotEmpty() } ?: return
        if (!policy.enabled || !policy.eligible || targetCode <= BuildConfig.VERSION_CODE) return

        // Never begin a second install while the previous one is unresolved or
        // while the same policy revision is terminal-sticky.
        if (state.snapshot().pendingVersionCode != null) return

        // Fetch the exact immutable manifest authorized by the authenticated
        // policy. `latest.json` is only discovery metadata and may advance while
        // this screen remains in an earlier canary cohort.
        val release = releases.fetchVersion(targetName, targetCode) ?: return
        if (release.versionName != targetName || release.versionCode != targetCode) return

        when (
            val decision = AndroidReleasePolicy.evaluate(
                release = release,
                installedVersionCode = BuildConfig.VERSION_CODE,
                sdkInt = Build.VERSION.SDK_INT,
            )
        ) {
            is AndroidReleaseDecision.UpdateAvailable -> Unit
            AndroidReleaseDecision.Current -> return
            is AndroidReleaseDecision.Rejected -> {
                state.begin(targetCode, revision)
                state.record("BLOCKED", decision.reason)
                if (reportTerminal(token, "BLOCKED", targetCode, decision.reason, revision)) {
                    state.markReported()
                }
                return
            }
        }

        val staged = File(otaDir, release.fileName)
        staged.delete()
        if (!releases.downloadVerified(release, staged)) {
            // Download failures remain retryable: no install/trust decision has
            // been made and a CDN/network retry may legitimately succeed later.
            reportTerminal(
                token,
                "FAILED",
                targetCode,
                "download_verification_failed",
                revision,
            )
            return
        }

        // From this point on, failures are tied to this exact policy revision.
        state.begin(targetCode, revision)
        when (val trust = trustVerifier(staged, release.certificateSha256)) {
            ApkTrustVerifier.Result.Trusted -> Unit
            is ApkTrustVerifier.Result.Rejected -> {
                staged.delete()
                state.record("BLOCKED", trust.reason)
                if (reportTerminal(token, "BLOCKED", targetCode, trust.reason, revision)) {
                    state.markReported()
                }
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
                policyRevision = revision,
                targetVersionCode = targetCode,
                installedVersionCode = BuildConfig.VERSION_CODE,
            ),
        )

        when (val start = installer.install(staged, targetCode)) {
            AndroidUpdateInstaller.StartResult.Started -> control.report(
                token,
                AndroidUpdateResult(
                    state = "INSTALLING",
                    policyRevision = revision,
                    targetVersionCode = targetCode,
                    installedVersionCode = BuildConfig.VERSION_CODE,
                ),
            )
            is AndroidUpdateInstaller.StartResult.Blocked -> {
                state.record("BLOCKED", start.reason)
                if (reportTerminal(token, "BLOCKED", targetCode, start.reason, revision)) {
                    state.markReported()
                }
            }
            is AndroidUpdateInstaller.StartResult.Failed -> {
                state.record("FAILED", start.reason)
                if (reportTerminal(token, "FAILED", targetCode, start.reason, revision)) {
                    state.markReported()
                }
            }
        }
    }

    private suspend fun reportTerminal(
        token: String,
        terminalState: String,
        target: Int,
        error: String?,
        policyRevision: String?,
    ): Boolean = control.report(
        token,
        AndroidUpdateResult(
            state = terminalState,
            policyRevision = policyRevision,
            targetVersionCode = target,
            installedVersionCode = BuildConfig.VERSION_CODE,
            error = error,
        ),
    )

    companion object {
        private const val MIN_CHECK_SECONDS = 15 * 60
        private const val MAX_CHECK_SECONDS = 24 * 60 * 60
        private const val DEFAULT_CHECK_SECONDS = 6 * 60 * 60
        private const val INSTALL_TIMEOUT_MS = 30 * 60_000L
    }
}
