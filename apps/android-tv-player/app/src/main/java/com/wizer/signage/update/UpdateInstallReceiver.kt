package com.wizer.signage.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/**
 * PackageInstaller callback. Never launches STATUS_PENDING_USER_ACTION UI on a
 * signage screen; a platform that cannot perform the update unattended is
 * recorded as BLOCKED and the currently-running player remains untouched.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val state = AndroidUpdateStateStore(context)
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_SUCCESS -> state.record("COMMIT_ACCEPTED")
            PackageInstaller.STATUS_PENDING_USER_ACTION -> state.record(
                "BLOCKED",
                "platform_requires_user_action",
            )
            else -> state.record(
                "FAILED",
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "package_installer_failed",
            )
        }
    }
}
