package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

/** Device → backend body for POST /api/device/pairing/start. */
@Serializable
data class StartPairingRequest(
    val deviceId: String,
    val platform: String? = null,
    val modelName: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null,
)

@Serializable
data class StartPairingResponse(
    val code: String,
    val expiresAt: String? = null,
    val pairingSecret: String,
    val refreshIntervalSeconds: Int = 60,
)

/** Response of GET /api/device/pairing/status. */
@Serializable
data class PairingStatusResponse(
    val status: String, // pending | paired | expired | revoked
    val expiresAt: String? = null,
    val deviceToken: String? = null,
    val screenId: String? = null,
    val companyId: String? = null,
    val screen: PairedScreenInfo? = null,
    val refreshIntervalSeconds: Int? = null,
) {
    companion object {
        const val PENDING = "pending"
        const val PAIRED = "paired"
        const val EXPIRED = "expired"
        const val REVOKED = "revoked"
    }
}

@Serializable
data class PairedScreenInfo(
    val name: String? = null,
    val orientation: String? = null,
)

/** Response of GET /api/device/config (only the fields the player consumes). */
@Serializable
data class DeviceConfig(
    val screenId: String,
    val name: String = "",
    val orientation: String = "UNKNOWN",
    val timezone: String = "UTC",
    val manifestRefreshIntervalSeconds: Int = 60,
    val heartbeatIntervalSeconds: Int = 60,
    val commandPollIntervalSeconds: Int = 12,
)
