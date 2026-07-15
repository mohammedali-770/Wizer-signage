package com.wizer.signage.system

import android.content.Intent
import com.wizer.signage.MainActivity

/**
 * Pure decision logic for launching the player after a device boot.
 *
 * Kept free of Android framework *calls* (only compile-time constants are
 * referenced) so the boot-launch policy is coverable by plain JUnit tests —
 * the project's existing test convention (no Robolectric / instrumentation).
 * [BootReceiver] is the thin Android shell around this object.
 */
object BootLaunch {

    /**
     * Non-standard "fast boot" broadcast sent instead of BOOT_COMPLETED by some
     * Android TV boxes and other AOSP-derived firmwares when resuming from
     * their vendor "quick boot" power-off state. Unlike BOOT_COMPLETED this is
     * NOT a protected broadcast, so any app could send it; accepting it is safe
     * because the only effect is bringing our own launcher activity to the
     * foreground — no state is changed and nothing sensitive is exposed.
     */
    const val ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"

    /** The only broadcast actions that may trigger an auto-launch. */
    private val SUPPORTED_ACTIONS = setOf(
        Intent.ACTION_BOOT_COMPLETED,
        ACTION_QUICKBOOT_POWERON,
    )

    /** Activity launched after boot — the app's single entry point, which itself
     *  routes to the pairing flow or the player based on stored pairing state. */
    val TARGET_ACTIVITY: Class<*> = MainActivity::class.java

    /**
     * NEW_TASK is mandatory when starting an activity from a non-activity
     * context (a BroadcastReceiver). MainActivity is declared
     * launchMode="singleTask", so if a task already exists it is brought to the
     * front instead of a duplicate being created — no extra flags needed.
     */
    const val LAUNCH_FLAGS: Int = Intent.FLAG_ACTIVITY_NEW_TASK

    /** True only for the boot actions this feature explicitly supports. */
    fun isSupportedAction(action: String?): Boolean = action in SUPPORTED_ACTIONS

    /** Whether a received broadcast should result in launching the player. */
    fun shouldLaunch(action: String?, autoStartEnabled: Boolean): Boolean =
        isSupportedAction(action) && autoStartEnabled

    /** Outcome of processing one boot broadcast (used for logging + tests). */
    enum class Result { LAUNCHED, SKIPPED_UNSUPPORTED_ACTION, SKIPPED_DISABLED, FAILED }

    /**
     * Apply the launch policy and, when allowed, invoke [launch]. Any exception
     * thrown by [launch] (OEM background-launch restriction, missing activity,
     * SecurityException, …) is contained so the receiver can never crash the
     * app process during broadcast dispatch; the caller logs the outcome.
     */
    fun attemptLaunch(
        action: String?,
        autoStartEnabled: Boolean,
        onFailure: (Exception) -> Unit = {},
        launch: () -> Unit,
    ): Result {
        if (!isSupportedAction(action)) return Result.SKIPPED_UNSUPPORTED_ACTION
        if (!autoStartEnabled) return Result.SKIPPED_DISABLED
        return try {
            launch()
            Result.LAUNCHED
        } catch (e: Exception) {
            onFailure(e)
            Result.FAILED
        }
    }
}
