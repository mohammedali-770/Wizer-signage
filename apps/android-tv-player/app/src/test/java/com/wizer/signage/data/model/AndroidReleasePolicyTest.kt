package com.wizer.signage.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidReleasePolicyTest {
    private fun release(
        versionCode: Int = 2,
        packageName: String = "com.wizer.signage",
        minSdk: Int = 21,
        fileName: String = "wizer-signage-v0.7.0-2.apk",
        downloadUrl: String = "/api/downloads/android/wizer-signage-v0.7.0-2.apk",
        sha256: String = "a".repeat(64),
        certificateSha256: String = "b".repeat(64),
    ) = AndroidRelease(
        schemaVersion = 1,
        packageName = packageName,
        versionName = "0.7.0",
        versionCode = versionCode,
        fileName = fileName,
        downloadUrl = downloadUrl,
        sha256 = sha256,
        certificateSha256 = certificateSha256,
        sizeBytes = 1024,
        minSdk = minSdk,
        publishedAt = "2026-08-09T00:00:00Z",
    )

    @Test
    fun `accepts only a forward compatible Wizer release`() {
        val decision = AndroidReleasePolicy.evaluate(release(), installedVersionCode = 1, sdkInt = 34)
        assertTrue(decision is AndroidReleaseDecision.UpdateAvailable)
    }

    @Test
    fun `treats same or older version as current rather than downgrade`() {
        assertEquals(
            AndroidReleaseDecision.Current,
            AndroidReleasePolicy.evaluate(release(versionCode = 2), installedVersionCode = 2, sdkInt = 34),
        )
        assertEquals(
            AndroidReleaseDecision.Current,
            AndroidReleasePolicy.evaluate(release(versionCode = 1), installedVersionCode = 2, sdkInt = 34),
        )
    }

    @Test
    fun `rejects wrong package or incompatible sdk`() {
        assertEquals(
            AndroidReleaseDecision.Rejected("wrong_package"),
            AndroidReleasePolicy.evaluate(release(packageName = "example.attacker"), 1, 34),
        )
        assertEquals(
            AndroidReleaseDecision.Rejected("min_sdk_too_high"),
            AndroidReleasePolicy.evaluate(release(minSdk = 35), 1, 34),
        )
    }

    @Test
    fun `rejects release urls that leave the immutable android namespace`() {
        assertEquals(
            AndroidReleaseDecision.Rejected("invalid_download_url"),
            AndroidReleasePolicy.evaluate(
                release(downloadUrl = "https://attacker.invalid/payload.apk"),
                1,
                34,
            ),
        )
        assertEquals(
            AndroidReleaseDecision.Rejected("invalid_download_url"),
            AndroidReleasePolicy.evaluate(
                release(downloadUrl = "/api/downloads/android/other.apk"),
                1,
                34,
            ),
        )
    }

    @Test
    fun `rejects malformed checksums and certificate fingerprints`() {
        assertEquals(
            AndroidReleaseDecision.Rejected("invalid_sha256"),
            AndroidReleasePolicy.evaluate(release(sha256 = "not-a-sha"), 1, 34),
        )
        assertEquals(
            AndroidReleaseDecision.Rejected("invalid_certificate_sha256"),
            AndroidReleasePolicy.evaluate(release(certificateSha256 = "00"), 1, 34),
        )
    }
}
