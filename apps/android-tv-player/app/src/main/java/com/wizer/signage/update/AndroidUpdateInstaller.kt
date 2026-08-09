package com.wizer.signage.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File

class AndroidUpdateInstaller(private val context: Context) {
    sealed interface StartResult {
        data object Started : StartResult
        data class Blocked(val reason: String) : StartResult
        data class Failed(val reason: String) : StartResult
    }

    fun install(apk: File, targetVersionCode: Int): StartResult {
        // Wizer never overlays a confirmation UI on a kiosk. Android 12 is the
        // first release with an explicit self-update no-user-action contract.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return StartResult.Blocked("silent_self_update_requires_android_12")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            return StartResult.Blocked("package_install_permission_not_provisioned")
        }
        if (!apk.isFile || apk.length() <= 0L) return StartResult.Failed("staged_apk_missing")

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }

        return try {
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                val callback = Intent(context, UpdateInstallReceiver::class.java).apply {
                    action = ACTION_INSTALL_RESULT
                    putExtra(EXTRA_TARGET_VERSION_CODE, targetVersionCode)
                }
                // PackageInstaller populates result extras into this PendingIntent,
                // so it must be mutable on modern Android. It is explicit and
                // targets our non-exported receiver, limiting who can reach it.
                val pending = PendingIntent.getBroadcast(
                    context,
                    targetVersionCode,
                    callback,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(pending.intentSender)
            }
            StartResult.Started
        } catch (e: SecurityException) {
            StartResult.Blocked(e.message ?: "package_installer_security_exception")
        } catch (e: Exception) {
            StartResult.Failed(e.message ?: "package_installer_exception")
        }
    }

    companion object {
        const val ACTION_INSTALL_RESULT = "com.wizer.signage.action.OTA_INSTALL_RESULT"
        const val EXTRA_TARGET_VERSION_CODE = "targetVersionCode"
    }
}
