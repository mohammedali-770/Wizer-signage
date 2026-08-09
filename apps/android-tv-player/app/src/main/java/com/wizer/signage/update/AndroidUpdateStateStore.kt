package com.wizer.signage.update

import android.content.Context

/** Tiny persistent hand-off between PackageInstaller's receiver and the restarted app. */
class AndroidUpdateStateStore(context: Context) {
    private val prefs = context.getSharedPreferences("wizer_android_update", Context.MODE_PRIVATE)

    data class Snapshot(
        val pendingVersionCode: Int?,
        val policyRevision: String?,
        val attemptedAtMs: Long,
        val state: String?,
        val error: String?,
        val reported: Boolean,
    )

    fun snapshot(): Snapshot = Snapshot(
        pendingVersionCode = prefs.getInt(KEY_PENDING, 0).takeIf { it > 0 },
        policyRevision = prefs.getString(KEY_POLICY_REVISION, null),
        attemptedAtMs = prefs.getLong(KEY_ATTEMPTED_AT, 0L),
        state = prefs.getString(KEY_STATE, null),
        error = prefs.getString(KEY_ERROR, null),
        reported = prefs.getBoolean(KEY_REPORTED, false),
    )

    fun begin(targetVersionCode: Int, policyRevision: String) {
        prefs.edit()
            .putInt(KEY_PENDING, targetVersionCode)
            .putString(KEY_POLICY_REVISION, policyRevision)
            .putLong(KEY_ATTEMPTED_AT, System.currentTimeMillis())
            .putString(KEY_STATE, "INSTALLING")
            .remove(KEY_ERROR)
            .putBoolean(KEY_REPORTED, false)
            .apply()
    }

    fun record(state: String, error: String? = null) {
        prefs.edit()
            .putString(KEY_STATE, state)
            .putString(KEY_ERROR, error)
            .putBoolean(KEY_REPORTED, false)
            .apply()
    }

    fun markReported() = prefs.edit().putBoolean(KEY_REPORTED, true).apply()

    fun clear() = prefs.edit().clear().apply()

    companion object {
        private const val KEY_PENDING = "pending_version_code"
        private const val KEY_POLICY_REVISION = "policy_revision"
        private const val KEY_ATTEMPTED_AT = "attempted_at_ms"
        private const val KEY_STATE = "state"
        private const val KEY_ERROR = "error"
        private const val KEY_REPORTED = "reported"
    }
}
