package com.wizer.signage.data.model

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
    /**
     * Stable content fingerprint (sha256) from the backend. Unlike generatedAt
     * (which changes every resolve), this only changes when WHAT plays changes.
     * Reported back as the device's synced manifest version so the dashboard can
     * show in-sync status (Req 6). Null on older backends → falls back to
     * generatedAt.
     */
    val manifestHash: String? = null,
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
    // FALLBACK | BLACK_SCREEN | CUSTOM_MESSAGE. The API normalises before it
    // emits, so the retired SLEEP and BLANK_SCREEN should never arrive on the
    // wire — the player still tolerates both, see BLANKING_BEHAVIORS in
    // PlayerScreen.kt.
    val outsideHoursBehavior: String? = null,
    val message: String? = null,
    val items: List<ManifestItem> = emptyList(),
    val warnings: List<String> = emptyList(),
) {
    /**
     * The value to report as the device's synced manifest version: the stable
     * content hash when the backend provides it, else the generatedAt timestamp.
     */
    val syncVersion: String
        get() = manifestHash ?: generatedAt

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
    /**
     * Set on the synthetic TEXT/URL items an emergency broadcast generates.
     *
     * The player keys emergency handling off `sourceType` and
     * `emergencyBroadcastId`, so nothing reads this yet — it is modelled because
     * the backend sends it. Production parses with `ignoreUnknownKeys = true`,
     * which meant this field was silently discarded and no test noticed; the
     * contract fixtures now parse strictly, so a field the API sends and this
     * model omits is a build failure.
     */
    val emergency: Boolean? = null,
)
