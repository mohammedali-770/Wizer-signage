package com.wizer.signage.util

import com.wizer.signage.data.model.ManifestItem

/**
 * Pure playback-sequencing helpers (no Android dependencies) so the timing
 * rules are unit-testable.
 */
object Playback {

    /** Fallback dwell time when an item declares none. */
    const val DEFAULT_DURATION_SECONDS = 10

    /**
     * The fixed on-screen time for an item in milliseconds, or `null` when the
     * item should play to its natural end (a full-length video). Videos with
     * `playFullVideo = true` or a non-positive duration play to the end; every
     * other type uses its duration (or the default).
     */
    fun displayMillis(item: ManifestItem): Long? {
        if (item.type == ManifestItem.TYPE_VIDEO && (item.playFullVideo || item.durationSeconds <= 0)) {
            return null
        }
        val seconds = if (item.durationSeconds > 0) item.durationSeconds else DEFAULT_DURATION_SECONDS
        return seconds.toLong() * 1000L
    }

    /** Next index in a continuously looping playlist. */
    fun nextIndex(current: Int, size: Int): Int = if (size <= 0) 0 else (current + 1) % size

    /** The best media URL to play for a file-backed item, or null. */
    fun mediaUrl(item: ManifestItem): String? = item.signedUrl ?: item.url
}
