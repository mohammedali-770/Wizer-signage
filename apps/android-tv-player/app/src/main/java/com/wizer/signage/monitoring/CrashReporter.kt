package com.wizer.signage.monitoring

import com.wizer.signage.BuildConfig
import com.wizer.signage.data.CrashReportClient
import com.wizer.signage.data.model.CrashReportPayload

class CrashReporter(
    private val store: CrashTelemetryStore,
    private val client: CrashReportClient = CrashReportClient(),
) {
    suspend fun reportIfPending(token: String) {
        val snapshot = store.snapshot()
        val fingerprint = snapshot.lastCrashFingerprint ?: return
        val crashedAt = snapshot.lastCrashAtMillis ?: return
        val accepted = client.report(
            token,
            CrashReportPayload(
                crashedAtMillis = crashedAt,
                fingerprint = fingerprint,
                crashCount = snapshot.crashCount.coerceAtLeast(1),
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
        if (accepted) store.acknowledgeIfPending()
    }
}
