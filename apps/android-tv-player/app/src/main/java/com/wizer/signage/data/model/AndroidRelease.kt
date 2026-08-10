package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

@Serializable
data class AndroidRelease(
    val schemaVersion: Int,
    val packageName: String,
    val versionName: String,
    val versionCode: Int,
    val fileName: String,
    val downloadUrl: String,
    val sha256: String,
    val certificateSha256: String,
    val sizeBytes: Long,
    val minSdk: Int,
    val publishedAt: String,
)

sealed interface AndroidReleaseDecision {
    data class UpdateAvailable(val release: AndroidRelease) : AndroidReleaseDecision
    data object Current : AndroidReleaseDecision
    data class Rejected(val reason: String) : AndroidReleaseDecision
}

/**
 * Fail-closed validation of the public release manifest before any APK bytes are
 * downloaded. Cryptographic verification of the downloaded APK is a separate
 * step; this function establishes that the metadata itself points only at the
 * Wizer immutable Android release namespace and only moves versionCode forward.
 */
object AndroidReleasePolicy {
    private const val PACKAGE = "com.wizer.signage"
    private val sha256 = Regex("^[0-9a-fA-F]{64}$")
    private val fileName = Regex("^wizer-signage-v[A-Za-z0-9._-]+-[0-9]+\\.apk$")

    fun evaluate(
        release: AndroidRelease,
        installedVersionCode: Int,
        sdkInt: Int,
    ): AndroidReleaseDecision {
        if (release.schemaVersion != 1) return AndroidReleaseDecision.Rejected("unsupported_schema")
        if (release.packageName != PACKAGE) return AndroidReleaseDecision.Rejected("wrong_package")
        if (release.versionCode <= 0) return AndroidReleaseDecision.Rejected("invalid_version_code")
        if (release.versionCode <= installedVersionCode) return AndroidReleaseDecision.Current
        if (release.minSdk > sdkInt) return AndroidReleaseDecision.Rejected("min_sdk_too_high")
        if (release.sizeBytes <= 0) return AndroidReleaseDecision.Rejected("invalid_size")
        if (!fileName.matches(release.fileName)) return AndroidReleaseDecision.Rejected("invalid_filename")
        if (release.downloadUrl != "/api/downloads/android/${release.fileName}") {
            return AndroidReleaseDecision.Rejected("invalid_download_url")
        }
        if (!sha256.matches(release.sha256)) return AndroidReleaseDecision.Rejected("invalid_sha256")
        if (!sha256.matches(release.certificateSha256)) {
            return AndroidReleaseDecision.Rejected("invalid_certificate_sha256")
        }
        return AndroidReleaseDecision.UpdateAvailable(release)
    }
}
