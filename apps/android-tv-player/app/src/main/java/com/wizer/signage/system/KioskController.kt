package com.wizer.signage.system

/**
 * Thin abstraction over the Android calls the kiosk needs. Implemented for real
 * by [AndroidKioskEnvironment]; a fake implementation lets [KioskController] be
 * unit-tested with plain JUnit (no Robolectric / instrumentation).
 */
interface KioskEnvironment {
    /** DevicePolicyManager.isLockTaskPermitted(pkg) — false if unmanaged or on error. */
    fun isLockTaskPermitted(): Boolean

    /** ActivityManager lock-task state — true when the task is currently pinned. */
    fun isInLockTask(): Boolean

    /** Activity.startLockTask() — only ever called when [isLockTaskPermitted]. */
    fun startLockTask()

    /** Activity.stopLockTask() — leave managed lock task. */
    fun stopLockTask()

    /** Add/clear FLAG_KEEP_SCREEN_ON on the window. */
    fun setKeepScreenOn(on: Boolean)

    /** (Re)enter immersive full-screen, hiding the system bars. */
    fun applyImmersive()
}

/**
 * Applies [KioskPolicy] to the real device via a [KioskEnvironment]. Pure Kotlin
 * (no Android imports) so it is JUnit-testable with a fake environment.
 *
 * Failure-safe by construction: every environment call is wrapped so a
 * DevicePolicyManager that is unavailable/throws, an OEM immersive quirk, or a
 * lock-task SecurityException degrades to ordinary player behaviour and never
 * crashes or blocks playback (Phase 5). Nothing sensitive is logged.
 */
class KioskController(
    private val env: KioskEnvironment,
    /** Reads the soft-kiosk preference; defaults to enabled if it ever throws. */
    private val kioskEnabledProvider: () -> Boolean,
    /** Where contained failures are reported. Default no-op keeps this class pure
     *  + JVM-testable; production passes an android.util.Log-backed sink. */
    private val onError: (String, Throwable) -> Unit = { _, _ -> },
) {
    /** Tracks that we issued a startLockTask so we don't call it repeatedly across
     *  lifecycle events even if [KioskEnvironment.isInLockTask] lags a frame. */
    private var lockTaskRequested = false

    /** Recompute + apply kiosk state for the given paired (player-foreground) state. */
    fun apply(paired: Boolean) {
        val enabled = safe("readPref", default = true) { kioskEnabledProvider() }
        val permitted = safe("isLockTaskPermitted", default = false) { env.isLockTaskPermitted() }
        val inLock = safe("isInLockTask", default = false) { env.isInLockTask() }

        val decision = KioskPolicy.decide(
            KioskPolicy.Inputs(
                paired = paired,
                kioskEnabled = enabled,
                lockTaskPermitted = permitted,
                inLockTask = inLock,
            ),
        )

        safeUnit("setKeepScreenOn") { env.setKeepScreenOn(decision.keepScreenOn) }
        safeUnit("applyImmersive") { env.applyImmersive() }

        if (decision.startLockTask && !lockTaskRequested) {
            lockTaskRequested = safe("startLockTask", default = false) { env.startLockTask(); true }
        } else if (decision.stopLockTask) {
            safeUnit("stopLockTask") { env.stopLockTask() }
            lockTaskRequested = false
        }
        // Resync the guard when we are genuinely not pinned and not requesting it,
        // so a system-driven exit (e.g. MDM removed the allowlist) is picked up.
        if (!inLock && !decision.startLockTask) lockTaskRequested = false
    }

    /** Whether Back should be consumed right now (drives the Compose BackHandler). */
    fun shouldConsumeBack(paired: Boolean): Boolean {
        val enabled = safe("readPref", default = true) { kioskEnabledProvider() }
        return KioskPolicy.softKioskActive(paired, enabled)
    }

    // Lifecycle entry points ---------------------------------------------------

    fun onResume(paired: Boolean) = apply(paired)

    fun onWindowFocusGained(paired: Boolean) {
        safeUnit("applyImmersive") { env.applyImmersive() }
        apply(paired)
    }

    fun onPairedChanged(paired: Boolean) = apply(paired)

    // Failure-safety helpers ---------------------------------------------------

    private inline fun <T> safe(op: String, default: T, block: () -> T): T =
        try {
            block()
        } catch (e: Exception) {
            onError("kiosk op '$op' failed; falling back", e)
            default
        }

    private inline fun safeUnit(op: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            onError("kiosk op '$op' failed; ignoring", e)
        }
    }
}
