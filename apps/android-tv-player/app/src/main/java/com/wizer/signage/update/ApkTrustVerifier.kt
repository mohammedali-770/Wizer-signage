package com.wizer.signage.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.security.MessageDigest

/**
 * Verifies the staged APK before PackageInstaller ever sees it.
 * Android will enforce update-signature compatibility again at install time;
 * this is an earlier fail-closed boundary for corrupted/misdirected releases.
 */
object ApkTrustVerifier {
    sealed interface Result {
        data object Trusted : Result
        data class Rejected(val reason: String) : Result
    }

    fun verify(context: Context, apk: File, expectedReleaseCertSha256: String): Result {
        val pm = context.packageManager
        val archive = packageArchiveInfo(pm, apk) ?: return Result.Rejected("unreadable_apk")
        if (archive.packageName != context.packageName) return Result.Rejected("wrong_package")

        val installed = try {
            installedPackageInfo(pm, context.packageName)
        } catch (_: Exception) {
            return Result.Rejected("installed_signature_unavailable")
        }

        val archiveCurrent = currentSignerDigests(archive)
        val archiveHistory = signerHistoryDigests(archive)
        val installedHistory = signerHistoryDigests(installed)
        val expected = normalize(expectedReleaseCertSha256)

        if (archiveCurrent.size != 1 || expected !in archiveCurrent) {
            return Result.Rejected("release_certificate_mismatch")
        }
        if (installedHistory.isEmpty() || archiveHistory.intersect(installedHistory).isEmpty()) {
            return Result.Rejected("signing_lineage_mismatch")
        }
        return Result.Trusted
    }

    private fun packageArchiveInfo(pm: PackageManager, apk: File): PackageInfo? {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }
        @Suppress("DEPRECATION")
        return pm.getPackageArchiveInfo(apk.absolutePath, flags)
    }

    private fun installedPackageInfo(pm: PackageManager, packageName: String): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }
        @Suppress("DEPRECATION")
        return pm.getPackageInfo(packageName, flags)
    }

    private fun currentSignerDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners.orEmpty()
        } else {
            @Suppress("DEPRECATION")
            info.signatures.orEmpty()
        }
        return signatures.mapTo(linkedSetOf()) { sha256(it.toByteArray()) }
    }

    private fun signerHistoryDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = info.signingInfo
            if (signingInfo?.hasMultipleSigners() == true) {
                signingInfo.apkContentsSigners.orEmpty()
            } else {
                signingInfo?.signingCertificateHistory.orEmpty()
            }
        } else {
            @Suppress("DEPRECATION")
            info.signatures.orEmpty()
        }
        return signatures.mapTo(linkedSetOf()) { sha256(it.toByteArray()) }
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun normalize(value: String): String = value.replace(":", "").lowercase()
}
