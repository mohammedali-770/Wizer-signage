package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

@Serializable
data class CrashReportPayload(
    val crashedAtMillis: Long,
    val fingerprint: String,
    val crashCount: Int,
    val appVersion: String? = null,
)
