package com.mastersignage.player.data.model

import kotlinx.serialization.Serializable

/**
 * The screen playback manifest returned by the backend
 * (GET /api/device/manifest). Mirrors the Phase 5 manifest structure. Unknown
 * fields are ignored by the JSON parser, so the player tolerates additive
 * backend changes.
 */
@Serializable
data class PlaybackManifest(
    val screenId: String,
    val generatedAt: String = "",
    val timezone: String = "UTC",
    val sourceType: String = SOURCE_NONE, // SCHEDULE | FALLBACK | EMERGENCY | NONE
    val scheduleId: String? = null,
    val scheduleName: String? = null,
    val playlistId: String? = null,
    val playlistTitle: String? = null,
    /** Set when sourceType = EMERGENCY (Phase 9). */
    val emergencyBroadcastId: String? = null,
    val priority: Int? = null,
    val outsideHours: Boolean = false,
    val outsideHoursBehavior: String? = null, // FALLBACK | BLACK_SCREEN | CUSTOM_MESSAGE | SLEEP
    val message: String? = null,
    val items: List<ManifestItem> = emptyList(),
    val warnings: List<String> = emptyList(),
) {
    companion object {
        const val SOURCE_SCHEDULE = "SCHEDULE"
        const val SOURCE_FALLBACK = "FALLBACK"
        const val SOURCE_EMERGENCY = "EMERGENCY"
        const val SOURCE_NONE = "NONE"
    }
}

@Serializable
data class ManifestItem(
    val contentId: String,
    val type: String, // IMAGE | VIDEO | PDF | URL | TEXT
    val title: String = "",
    val durationSeconds: Int = 0,
    val playFullVideo: Boolean = false,
    val pdfPageDurationSeconds: Int? = null,
    val orientation: String = "UNKNOWN",
    val fileSizeBytes: String? = null,
    val checksum: String? = null,
    val mimeType: String? = null,
    /** Short-lived signed URL for online playback of stored files (IMAGE/VIDEO/PDF). */
    val signedUrl: String? = null,
    /** Device-authenticated download path for offline caching (relative to /api); null for URL/TEXT. */
    val downloadPath: String? = null,
    /** Content version marker (updatedAt ISO) so the cache can detect changes. */
    val version: String = "",
    /** External URL for URL content. */
    val url: String? = null,
    /** Body for TEXT content. */
    val textBody: String? = null,
    val metadata: ManifestItemMeta? = null,
) {
    companion object {
        const val TYPE_IMAGE = "IMAGE"
        const val TYPE_VIDEO = "VIDEO"
        const val TYPE_PDF = "PDF"
        const val TYPE_URL = "URL"
        const val TYPE_TEXT = "TEXT"
    }
}

@Serializable
data class ManifestItemMeta(
    val pageCount: Int? = null,
)
