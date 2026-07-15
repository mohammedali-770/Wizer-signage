package com.wizer.signage.system

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.wizer.signage.data.DeviceStore

/**
 * Relaunches the signage player after the device boots (auto-start).
 *
 * A dedicated signage screen must return to playback (or the pairing screen)
 * without someone finding the app in the launcher, so auto-start is ON by
 * default and controlled by the internal [DeviceStore.autoStartOnBoot] flag.
 *
 * Design notes / platform constraints:
 *  - BOOT_COMPLETED is a protected broadcast only the system can send. The
 *    receiver must still be `exported="true"` for the system to deliver it, so
 *    the action is validated and everything else is ignored — the receiver
 *    accepts no external commands and carries no extras-driven behaviour.
 *  - LOCKED_BOOT_COMPLETED is deliberately NOT handled: it would require a
 *    direct-boot-aware receiver using device-protected storage, but the paired
 *    device token lives in Keystore-backed credential-encrypted storage
 *    ([DeviceStore]), which is unavailable before first unlock. Android TV
 *    signage devices have no lock-screen credential, so BOOT_COMPLETED fires
 *    promptly at boot and direct-boot support would add risk for no gain.
 *  - Launching an activity from a receiver is permitted for BOOT_COMPLETED
 *    (the background-activity-launch exemption for system broadcasts), but
 *    some OEM builds still block or delay it; failures are contained and
 *    logged. After a fresh install or a user force-stop, Android keeps the app
 *    in the "stopped" state and delivers NO broadcasts until the app is opened
 *    manually once — that is platform behaviour and cannot be bypassed.
 *  - No foreground service, no SYSTEM_ALERT_WINDOW, no accessibility tricks.
 *  - Nothing sensitive is logged (no tokens, pairing secrets, or media URLs).
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        if (!BootLaunch.isSupportedAction(action)) {
            // Unknown/spoofed action — ignore silently, do not touch any state.
            return
        }

        // Fail-open: on a dedicated signage device, launching is the safe
        // default even if reading the preference fails right after boot.
        val autoStart = try {
            DeviceStore(context).autoStartOnBoot
        } catch (e: Exception) {
            Log.w(TAG, "Could not read auto-start preference; defaulting to enabled.", e)
            true
        }

        val result = BootLaunch.attemptLaunch(
            action = action,
            autoStartEnabled = autoStart,
            onFailure = { e -> Log.w(TAG, "Auto-start launch failed (action=$action).", e) },
        ) {
            val launch = Intent(context, BootLaunch.TARGET_ACTIVITY).addFlags(BootLaunch.LAUNCH_FLAGS)
            context.startActivity(launch)
        }

        when (result) {
            BootLaunch.Result.LAUNCHED ->
                Log.i(TAG, "Auto-start: launched player (action=$action).")
            BootLaunch.Result.SKIPPED_DISABLED ->
                Log.i(TAG, "Auto-start disabled by preference; not launching.")
            else -> Unit // unsupported action already returned; failure already logged
        }
    }

    private companion object {
        const val TAG = "BootReceiver"
    }
}
