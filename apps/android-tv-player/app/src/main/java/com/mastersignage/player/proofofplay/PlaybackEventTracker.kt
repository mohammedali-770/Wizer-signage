package com.mastersignage.player.proofofplay

import com.mastersignage.player.data.model.ManifestItem
import com.mastersignage.player.data.model.PlaybackManifest
import com.mastersignage.player.data.model.ProofOfPlayEvent
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
        val startedAtMs: Long,
    )

    private var active: Active? = null

    /** Begin a new item. Returns the events to report (an INTERRUPTED for a
     * pre-empted previous item, if any, followed by the new ITEM_STARTED). */
    fun started(item: ManifestItem, index: Int, ctx: Context): List<ProofOfPlayEvent> {
        val out = ArrayList<ProofOfPlayEvent>(2)
        active?.let { out += terminal(it, ProofOfPlayEvent.INTERRUPTED, null) }
        val a = Active(newSessionId(), item, ctx, index, clock())
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
        val now = clock()
        return ProofOfPlayEvent(
            eventType = type,
            playbackSessionId = a.sessionId,
            startedAt = iso(a.startedAtMs),
            endedAt = iso(now),
            durationMs = (now - a.startedAtMs).coerceAtLeast(0),
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

        private val isoFormat = ThreadLocal.withInitial {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        }

        private fun iso(ms: Long): String = isoFormat.get()!!.format(Date(ms))
    }
}
