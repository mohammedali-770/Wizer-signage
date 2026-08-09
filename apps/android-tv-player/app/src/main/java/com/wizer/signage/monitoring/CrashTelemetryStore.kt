package com.wizer.signage.monitoring

import android.content.Context
import com.wizer.signage.system.CrashRecovery
import java.io.File
import java.security.MessageDigest

/**
 * Converts CrashRecovery's local previous-run trace into privacy-bounded fleet
 * telemetry. The stack trace never leaves the device: only its SHA-256 prefix,
 * crash timestamp and a cumulative local count are uploaded.
 */
class CrashTelemetryStore(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("wizer_crash_telemetry", Context.MODE_PRIVATE)
    private val crashFile: File get() = File(app.filesDir, CrashRecovery.CRASH_FILE_NAME)

    data class Snapshot(
        val lastCrashAtMillis: Long?,
        val lastCrashFingerprint: String?,
        val crashCount: Int,
    )

    fun snapshot(): Snapshot {
        val report = try {
            crashFile.takeIf { it.isFile }?.readText()
        } catch (_: Throwable) {
            null
        }

        if (report != null) {
            val fingerprint = fingerprint(report)
            val pending = prefs.getString(KEY_PENDING_FINGERPRINT, null)
            if (pending != fingerprint) {
                val nextCount = (prefs.getInt(KEY_CRASH_COUNT, 0) + 1).coerceAtLeast(1)
                prefs.edit()
                    .putInt(KEY_CRASH_COUNT, nextCount)
                    .putString(KEY_PENDING_FINGERPRINT, fingerprint)
                    .putLong(KEY_PENDING_AT, parseAtMillis(report) ?: 0L)
                    .apply()
            }
        }

        return Snapshot(
            lastCrashAtMillis = prefs.getLong(KEY_PENDING_AT, 0L).takeIf { it > 0L },
            lastCrashFingerprint = prefs.getString(KEY_PENDING_FINGERPRINT, null),
            crashCount = prefs.getInt(KEY_CRASH_COUNT, 0).coerceAtLeast(0),
        )
    }

    fun acknowledgeIfPending() {
        if (prefs.getString(KEY_PENDING_FINGERPRINT, null) == null) return
        try {
            crashFile.delete()
        } catch (_: Throwable) {
            return
        }
        if (crashFile.exists()) return
        prefs.edit().remove(KEY_PENDING_FINGERPRINT).remove(KEY_PENDING_AT).apply()
    }

    companion object {
        private const val KEY_CRASH_COUNT = "crash_count"
        private const val KEY_PENDING_FINGERPRINT = "pending_fingerprint"
        private const val KEY_PENDING_AT = "pending_at"

        internal fun parseAtMillis(report: String): Long? =
            Regex("^at=(\\d+)\\s", RegexOption.MULTILINE)
                .find(report)
                ?.groupValues
                ?.getOrNull(1)
                ?.toLongOrNull()

        internal fun fingerprint(report: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(report.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
                .take(24)
    }
}
