package com.wizer.signage.system

/**
 * Pure, framework-free kiosk policy for the signage player. Given the current
 * app state it decides what kiosk behaviour should be in effect. All Android
 * calls live in [KioskEnvironment] / [AndroidKioskEnvironment]; this object only
 * makes decisions, so it is fully covered by plain JUnit tests (the module's
 * convention — no Robolectric).
 *
 * "Active signage playback" = the device is **paired** and the player route is
 * foreground (in this app the paired route IS the player experience — pairing/
 * setup is the unpaired route). Kiosk behaviour never activates on the pairing/
 * setup screen, so an unpaired device is never trapped.
 */
object KioskPolicy {

    /** Everything the policy needs, captured immutably so decisions are testable. */
    data class Inputs(
        /** True when a device token + bound screen exist (player route foreground). */
        val paired: Boolean,
        /** The internal soft-kiosk preference (default on for a dedicated device). */
        val kioskEnabled: Boolean,
        /** DevicePolicyManager says com.wizer.signage is allowlisted for lock task. */
        val lockTaskPermitted: Boolean,
        /** ActivityManager reports the task is currently pinned (lock task active). */
        val inLockTask: Boolean,
    )

    /** What the controller should apply. */
    data class Decision(
        /** Hold the screen awake (tracks active playback, independent of the toggle). */
        val keepScreenOn: Boolean,
        /** Soft-kiosk (immersive reinforcement + Back suppression) is in effect. */
        val softKioskActive: Boolean,
        /** Consume an accidental Back press so it can't close the player. */
        val consumeBack: Boolean,
        /** Enter managed lock task now (allowlisted + not already pinned). */
        val startLockTask: Boolean,
        /** Leave managed lock task now (no longer in the signage experience). */
        val stopLockTask: Boolean,
    )

    /** Screen stays awake whenever the paired player experience is foreground. */
    fun keepScreenOn(paired: Boolean): Boolean = paired

    /** Soft kiosk activates only on a paired device with the toggle enabled. */
    fun softKioskActive(paired: Boolean, kioskEnabled: Boolean): Boolean = paired && kioskEnabled

    fun decide(i: Inputs): Decision {
        val soft = softKioskActive(i.paired, i.kioskEnabled)
        return Decision(
            keepScreenOn = keepScreenOn(i.paired),
            softKioskActive = soft,
            // Back is suppressed only during the active soft-kiosk signage experience;
            // on the pairing/setup screen (unpaired) Back always works, and if the
            // technician disables soft kiosk Back works too (a supported exit path).
            consumeBack = soft,
            // Managed lock task: enter only while soft-kiosk is active AND the DPC/MDM
            // has allowlisted the app AND we are not already pinned (no duplicate calls).
            // startLockTask is NEVER requested when not allowlisted, so the user-driven
            // screen-pinning confirmation can never be triggered by this app.
            startLockTask = soft && i.lockTaskPermitted && !i.inLockTask,
            // Leave lock task only when we drop out of the signage experience (unpaired
            // or kiosk disabled) — NOT on ordinary pause/resume — so the pairing/setup
            // screen is never left pinned.
            stopLockTask = !soft && i.inLockTask,
        )
    }
}
