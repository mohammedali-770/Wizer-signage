package com.wizer.signage.proofofplay

import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import com.wizer.signage.data.model.ProofOfPlayEvent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Turns the player's actual item transitions into proof-of-play events (Phase 9).
 * Pure + deterministic (clock + id are injectable) so it is fully JVM-testable.
 *
 * Lifecycle per item: [started] opens a session (ITEM_STARTED). Exactly one of
 * [completed] / [failed] / [interrupted] closes it. A new [started] while a
 * session is still open means the running item was pre-empted (e.g. an emergency
 * manifest arrived) — it is auto-closed as ITEM_INTERRUPTED. [skipped] emits a
 * standalone event for an item that could not be shown (offline + uncached).
 */
class PlaybackEventTracker(
    private val clock: () -> Long = { System.currentTimeMillis() },
    /**
     * MONOTONIC millisecond source, used only to measure how long an item played.
     *
     * Durations must never be derived from the wall clock. An Android TV box has
     * no RTC battery: it boots with a bogus time and jumps — often by years —
     * the moment NTP lands, which is routinely mid-playback on the first item
     * after a power cut. Subtracting two wall-clock readings across that jump
     * reported hours of playback for a 15-second image, or (jumping backwards)
     * zero. Proof-of-play is the advertiser-billing and compliance record, so
     * that is not a cosmetic error.
     *
     * `System.nanoTime` is monotonic on both Android and the JVM, which also
     * keeps this class free of android.* imports and fully unit-testable.
     */
    private val elapsed: () -> Long = { System.nanoTime() / 1_000_000 },
    private val newSessionId: () -> String = { UUID.randomUUID().toString() },
) {
    /** Resolved context for the item about to play (derived from the manifest + cache). */
    data class Context(
        val sourceType: String,
        val emergencyBroadcastId: String?,
        val playlistId: String?,
        val scheduleId: String?,
        val manifestVersion: String?,
        val online: Boolean,
        val localPresent: Boolean,
    )

    private data class Active(
        val sessionId: String,
        val item: ManifestItem,
        val ctx: Context,
        val index: Int,
        /** Wall clock — reported as `startedAt`, never used for arithmetic. */
        val startedAtMs: Long,
        /** Monotonic — the only thing duration is measured from. */
        val startedElapsedMs: Long,
    )

    private var active: Active? = null

    /** Begin a new item. Returns the events to report (an INTERRUPTED for a
     * pre-empted previous item, if any, followed by the new ITEM_STARTED). */
    fun started(item: ManifestItem, index: Int, ctx: Context): List<ProofOfPlayEvent> {
        val out = ArrayList<ProofOfPlayEvent>(2)
        active?.let { out += terminal(it, ProofOfPlayEvent.INTERRUPTED, null) }
        val a = Active(newSessionId(), item, ctx, index, clock(), elapsed())
        active = a
        out += ProofOfPlayEvent(
            eventType = ProofOfPlayEvent.STARTED,
            playbackSessionId = a.sessionId,
            startedAt = iso(a.startedAtMs),
            contentId = contentIdOf(item),
            playlistId = ctx.playlistId,
            scheduleId = ctx.scheduleId,
            emergencyBroadcastId = ctx.emergencyBroadcastId,
            sourceType = ctx.sourceType,
            playbackSource = sourceOf(item, ctx),
            contentType = item.type,
            expectedDurationMs = expectedMs(item),
            itemSequence = index,
            offlinePlayback = !ctx.online,
            manifestVersion = ctx.manifestVersion,
        )
        return out
    }

    /** Natural end of the running item. */
    fun completed(): ProofOfPlayEvent? = active?.let {
        active = null
        terminal(it, ProofOfPlayEvent.COMPLETED, null)
    }

    /** The running item failed to render. */
    fun failed(reason: String?): ProofOfPlayEvent? = active?.let {
        active = null
        terminal(it, ProofOfPlayEvent.FAILED, reason)
    }

    /** The running item was pre-empted (emergency / manifest replacement / blank). */
    fun interrupted(): ProofOfPlayEvent? = active?.let {
        active = null
        terminal(it, ProofOfPlayEvent.INTERRUPTED, null)
    }

    /** An item that could not be played at all (offline + uncached). Standalone. */
    fun skipped(item: ManifestItem, index: Int, ctx: Context): ProofOfPlayEvent {
        val now = clock()
        return ProofOfPlayEvent(
            eventType = ProofOfPlayEvent.SKIPPED,
            playbackSessionId = newSessionId(),
            startedAt = iso(now),
            endedAt = iso(now),
            durationMs = 0,
            contentId = contentIdOf(item),
            playlistId = ctx.playlistId,
            scheduleId = ctx.scheduleId,
            emergencyBroadcastId = ctx.emergencyBroadcastId,
            sourceType = ctx.sourceType,
            playbackSource = sourceOf(item, ctx),
            contentType = item.type,
            expectedDurationMs = expectedMs(item),
            itemSequence = index,
            offlinePlayback = !ctx.online,
            manifestVersion = ctx.manifestVersion,
            failureReason = "Not available offline (uncached).",
        )
    }

    private fun terminal(a: Active, type: String, reason: String?): ProofOfPlayEvent {
        // Duration from the monotonic clock; the end TIMESTAMP is then derived
        // from it rather than read from the wall clock again. That keeps the
        // report internally consistent — endedAt - startedAt always equals
        // durationMs — which is what any billing or compliance sum depends on,
        // and it stays true even if NTP corrected the clock mid-item.
        val durationMs = (elapsed() - a.startedElapsedMs).coerceAtLeast(0)
        return ProofOfPlayEvent(
            eventType = type,
            playbackSessionId = a.sessionId,
            startedAt = iso(a.startedAtMs),
            endedAt = iso(a.startedAtMs + durationMs),
            durationMs = durationMs,
            contentId = contentIdOf(a.item),
            playlistId = a.ctx.playlistId,
            scheduleId = a.ctx.scheduleId,
            emergencyBroadcastId = a.ctx.emergencyBroadcastId,
            sourceType = a.ctx.sourceType,
            playbackSource = sourceOf(a.item, a.ctx),
            contentType = a.item.type,
            expectedDurationMs = expectedMs(a.item),
            itemSequence = a.index,
            offlinePlayback = !a.ctx.online,
            manifestVersion = a.ctx.manifestVersion,
            failureReason = reason,
        )
    }

    companion object {
        /** Synthetic TEXT/URL emergency items have no library Content → null contentId. */
        fun contentIdOf(item: ManifestItem): String? =
            if (item.contentId.startsWith(EMERGENCY_SYNTHETIC_PREFIX)) null else item.contentId

        fun sourceOf(item: ManifestItem, ctx: Context): String = when (item.type) {
            ManifestItem.TYPE_TEXT -> ProofOfPlayEvent.SOURCE_TEXT
            ManifestItem.TYPE_URL -> ProofOfPlayEvent.SOURCE_URL
            else -> if (ctx.localPresent) ProofOfPlayEvent.SOURCE_LOCAL_CACHE else ProofOfPlayEvent.SOURCE_STREAMING
        }

        fun expectedMs(item: ManifestItem): Long? =
            if (item.durationSeconds > 0) item.durationSeconds.toLong() * 1000L else null

        /** Build a Context from the active manifest + cache/connectivity state. */
        fun contextFrom(manifest: PlaybackManifest, online: Boolean, localPresent: Boolean): Context = Context(
            sourceType = manifest.sourceType,
            emergencyBroadcastId = manifest.emergencyBroadcastId,
            playlistId = manifest.playlistId,
            scheduleId = manifest.scheduleId,
            manifestVersion = manifest.generatedAt,
            online = online,
            localPresent = localPresent,
        )

        const val EMERGENCY_SYNTHETIC_PREFIX = "emg:"

        // Anonymous ThreadLocal subclass (initialValue() is API 1) rather than
        // ThreadLocal.withInitial(...), which is API 26 and would crash on the
        // minSdk-21..25 range. SimpleDateFormat is not thread-safe, so each
        // thread lazily gets its own UTC-locked formatter — same behaviour.
        private val isoFormat = object : ThreadLocal<SimpleDateFormat>() {
            override fun initialValue(): SimpleDateFormat =
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }
        }

        private fun iso(ms: Long): String = isoFormat.get()!!.format(Date(ms))
    }
}
