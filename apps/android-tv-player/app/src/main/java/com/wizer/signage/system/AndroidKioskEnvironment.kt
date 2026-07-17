package com.wizer.signage.system

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.view.WindowManager
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Real [KioskEnvironment] backed by the host [Activity]. This is the ONLY kiosk
 * class that touches Android framework APIs, so [KioskController]/[KioskPolicy]
 * stay unit-testable. Individual calls may throw on some OEM builds; the caller
 * ([KioskController]) wraps every call, so nothing here needs to be defensive
 * beyond returning sensible values.
 *
 * Notably this uses ONLY standard, supported APIs — no DeviceAdminReceiver, no
 * device-owner provisioning, no SYSTEM_ALERT_WINDOW, no accessibility service.
 * Lock task is entered programmatically and ONLY when an external DPC/MDM has
 * already allowlisted com.wizer.signage (see [isLockTaskPermitted]).
 */
class AndroidKioskEnvironment(private val activity: Activity) : KioskEnvironment {

    override fun isLockTaskPermitted(): Boolean {
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return false
        // True only when a device/profile owner (the external MDM/DPC) has
        // allowlisted this package for lock task. Unmanaged devices → false, so
        // startLockTask is never attempted (no user-driven screen-pinning prompt).
        return dpm.isLockTaskPermitted(activity.packageName)
    }

    override fun isInLockTask(): Boolean {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
        } else {
            @Suppress("DEPRECATION")
            am.isInLockTaskMode // API 21–22 fallback
        }
    }

    override fun startLockTask() = activity.startLockTask()

    override fun stopLockTask() = activity.stopLockTask()

    override fun setKeepScreenOn(on: Boolean) {
        if (on) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    override fun applyImmersive() {
        val window = activity.window
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
}
