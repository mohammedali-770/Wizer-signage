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

    /**
     * Extra slack on top of a video's declared duration before the watchdog gives
     * up: covers slow buffering over a congested link so a healthy video is never
     * cut short.
     */
    const val VIDEO_WATCHDOG_GRACE_MS = 30_000L

    /** Ceiling used when the manifest declares no duration for a full-length video. */
    const val VIDEO_WATCHDOG_DEFAULT_MS = 10 * 60_000L

    /**
     * Deadline after which a video item MUST be force-advanced even though
     * ExoPlayer reported neither STATE_ENDED nor an error. Cheap TV boxes stall
     * their decoder mid-stream and simply go quiet; with no watchdog the playlist
     * sits on one frozen frame until someone drives out and power-cycles the
     * screen. Always strictly later than [displayMillis] so the normal
     * fixed-duration cut still wins and a healthy play is never reported failed.
     */
    fun videoWatchdogMillis(item: ManifestItem): Long {
        val declared =
            if (item.durationSeconds > 0) item.durationSeconds.toLong() * 1000L else VIDEO_WATCHDOG_DEFAULT_MS
        return declared + VIDEO_WATCHDOG_GRACE_MS
    }

    /** Next index in a continuously looping playlist. */
    fun nextIndex(current: Int, size: Int): Int = if (size <= 0) 0 else (current + 1) % size

    /**
     * Identity of ONE play of an item, for keying per-play state and effects.
     *
     * A one-item playlist loops back to the identical item — `nextIndex(0, 1)` is
     * 0 — so the content id alone is constant forever. Keying a one-shot advance
     * guard or a player's setup effect on it means the second play never happens
     * and the screen sits on a frozen frame until someone power-cycles the TV.
     * [playCount] is what makes each play distinct.
     */
    fun playKey(contentId: String, playCount: Int): String = "$contentId#$playCount"

    /** The best media URL to play for a file-backed item, or null. */
    fun mediaUrl(item: ManifestItem): String? = item.signedUrl ?: item.url
}
