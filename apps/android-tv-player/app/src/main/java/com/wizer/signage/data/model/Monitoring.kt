package com.wizer.signage.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Device → backend body for POST /api/device/heartbeat (Phase 8 telemetry). */
@Serializable
data class HeartbeatPayload(
    val appVersion: String? = null,
    val deviceModel: String? = null,
    val osVersion: String? = null,
    val platform: String? = null,
    val uptimeSeconds: Int? = null,
    val playbackState: String? = null, // PLAYING | IDLE | BUFFERING | ERROR | OFFLINE_PLAYBACK
    val currentContentId: String? = null,
    val currentPlaylistId: String? = null,
    val currentScheduleId: String? = null,
    val manifestVersion: String? = null,
    val networkStatus: String? = null, // ONLINE | OFFLINE | METERED
    val syncStatus: String? = null,
    val cacheSizeBytes: Long? = null,
    val availableStorageBytes: Long? = null,
    val requiredAssets: Int? = null,
    val cachedAssets: Int? = null,
    val failedDownloads: Int? = null,
    val lastError: String? = null,
    /** Previous-run crash metadata only; the stack trace never leaves the TV. */
    val lastCrashAtMillis: Long? = null,
    val lastCrashFingerprint: String? = null,
    val crashCount: Int? = null,
    val capabilities: Map<String, Boolean>? = null,
)

@Serializable
data class HeartbeatResponse(
    val ok: Boolean = true,
    val status: String? = null,
    val pendingCommands: Int = 0,
)

@Serializable
data class PendingCommand(
    val id: String,
    val commandType: String,
    val payload: JsonObject? = null,
)

@Serializable
data class PendingCommandsResponse(
    val commands: List<PendingCommand> = emptyList(),
)

/** Device → backend body for POST /api/device/commands/:id/result. */
@Serializable
data class CommandResultPayload(
    val status: String, // SUCCEEDED | FAILED
    val result: JsonObject? = null,
    val error: String? = null,
)