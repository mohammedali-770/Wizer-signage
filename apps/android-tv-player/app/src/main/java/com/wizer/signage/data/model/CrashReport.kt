package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

/** Previous-run crash metadata. The exception/stack trace never leaves the TV. */
@Serializable
data class CrashReportPayload(
    val crashedAtMillis: Long,
    val fingerprint: String,
    val crashCount: Int,
    val appVersion: String? = null,
)
