package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

/** Response of GET /api/device/sync-plan — the assets the device should keep cached. */
@Serializable
data class SyncPlan(
    val screenId: String = "",
    val generatedAt: String = "",
    val preDownloadWindowSeconds: Int = 3600,
    val items: List<SyncPlanItem> = emptyList(),
)

@Serializable
data class SyncPlanItem(
    val contentId: String,
    val type: String, // IMAGE | VIDEO | PDF | URL | TEXT
    val title: String = "",
    val fileSizeBytes: String? = null,
    val checksum: String? = null,
    val mimeType: String? = null,
    val orientation: String = "UNKNOWN",
    val version: String = "",
    val durationSeconds: Int? = null,
    val playFullVideo: Boolean = false,
    val pdfPageDurationSeconds: Int? = null,
    /** Device-authenticated download path (relative to /api); null for URL/TEXT. */
    val downloadPath: String? = null,
    val url: String? = null,
    val textBody: String? = null,
) {
    val isFile: Boolean get() = downloadPath != null
}

/** Device → backend body for POST /api/device/sync-status. */
@Serializable
data class SyncStatusReport(
    val status: String, // IDLE | SYNCING | READY | PARTIAL | FAILED | OFFLINE_PLAYBACK
    val manifestSource: String? = null, // REMOTE | LOCAL_CACHE
    val manifestVersion: String? = null,
    val requiredAssets: Int? = null,
    val cachedAssets: Int? = null,
    val failedDownloads: Int? = null,
    val cacheSizeBytes: Long? = null,
    val availableStorageBytes: Long? = null,
    val lastError: String? = null,
    val failedAssetIds: List<String>? = null,
)
