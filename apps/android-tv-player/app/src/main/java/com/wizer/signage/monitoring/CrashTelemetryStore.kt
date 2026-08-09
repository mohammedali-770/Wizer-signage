package com.wizer.signage.monitoring

import android.content.Context
import com.wizer.signage.system.CrashRecovery
import java.io.File
import java.security.MessageDigest

/**
 * Converts CrashRecovery's local previous-run trace into privacy-bounded fleet
 * telemetry. The stack trace never leaves the device: only its SHA-256 prefix,
 * crash timestamp and a cumulative local count are sent in heartbeats.
 *
 * The crash file is deleted only after the server accepts a heartbeat, so an
 * offline restart cannot lose the signal. SharedPreferences prevents repeatedly
 * incrementing the same pending crash across heartbeat attempts/restarts.
 */
class CrashTelemetryStore(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("wizer_crash_telemetry", Context.MODE_PRIVATE)
    private val crashFile: File get() = File(app.filesDir, CrashRecovery.CRASH_FILE_NAME)

    data class Snapshot(
        val lastCrashAtMillis: Long?,
        val lastCrashFingerprint: String?,
        val crashCount: Int,
    ) {
        val hasPendingCrash: Boolean get() = lastCrashFingerprint != null
    }

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

        val pendingFingerprint = prefs.getString(KEY_PENDING_FINGERPRINT, null)
        val at = prefs.getLong(KEY_PENDING_AT, 0L).takeIf { it > 0L }
        return Snapshot(
            lastCrashAtMillis = at,
            lastCrashFingerprint = pendingFingerprint,
            crashCount = prefs.getInt(KEY_CRASH_COUNT, 0).coerceAtLeast(0),
        )
    }

    fun acknowledgeIfPending() {
        if (prefs.getString(KEY_PENDING_FINGERPRINT, null) == null) return
        try {
            crashFile.delete()
        } catch (_: Throwable) {
            // Clearing the pending marker would lose retryability if the file
            // could not be removed, so leave both intact in that rare case.
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
