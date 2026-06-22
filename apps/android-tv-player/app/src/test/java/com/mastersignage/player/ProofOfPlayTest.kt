package com.mastersignage.player

import com.mastersignage.player.data.model.ManifestItem
import com.mastersignage.player.data.model.ProofOfPlayEvent
import com.mastersignage.player.data.model.ReportProofOfPlayRequest
import com.mastersignage.player.proofofplay.PlaybackEventTracker
import com.mastersignage.player.proofofplay.ProofOfPlayQueue
import com.mastersignage.player.proofofplay.ProofOfPlayReporter
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

private fun item(id: String = "c1", type: String = ManifestItem.TYPE_IMAGE, dur: Int = 10) =
    ManifestItem(contentId = id, type = type, durationSeconds = dur, version = "v1")

private fun ctx(
    source: String = "SCHEDULE",
    emergency: String? = null,
    online: Boolean = true,
    local: Boolean = true,
) = PlaybackEventTracker.Context(
    sourceType = source,
    emergencyBroadcastId = emergency,
    playlistId = "pl1",
    scheduleId = "sch1",
    manifestVersion = "2026-06-16T00:00:00Z",
    online = online,
    localPresent = local,
)

class PlaybackEventTrackerTest {

    private fun tracker(clock: () -> Long): PlaybackEventTracker {
        var n = 0
        return PlaybackEventTracker(clock = clock, newSessionId = { "sess-${++n}" })
    }

    @Test
    fun startedThenCompletedSharesSessionAndRecordsDuration() {
        var t = 1_000L
        val tr = tracker { t }
        val started = tr.started(item(), 0, ctx())
        assertEquals(1, started.size)
        assertEquals(ProofOfPlayEvent.STARTED, started[0].eventType)
        assertEquals("sess-1", started[0].playbackSessionId)

        t = 6_000L
        val completed = tr.completed()!!
        assertEquals(ProofOfPlayEvent.COMPLETED, completed.eventType)
        assertEquals("sess-1", completed.playbackSessionId)
        assertEquals(5_000L, completed.durationMs)
    }

    @Test
    fun newStartWhileActiveInterruptsThePreviousItem() {
        var t = 1_000L
        val tr = tracker { t }
        tr.started(item("a"), 0, ctx())
        t = 3_000L
        val events = tr.started(item("b"), 1, ctx(source = "EMERGENCY", emergency = "eb1"))
        assertEquals(2, events.size)
        assertEquals(ProofOfPlayEvent.INTERRUPTED, events[0].eventType)
        assertEquals("sess-1", events[0].playbackSessionId)
        assertEquals(2_000L, events[0].durationMs)
        assertEquals(ProofOfPlayEvent.STARTED, events[1].eventType)
        assertEquals("eb1", events[1].emergencyBroadcastId)
        assertEquals("EMERGENCY", events[1].sourceType)
    }

    @Test
    fun failedRecordsReason() {
        val tr = tracker { 1_000L }
        tr.started(item(), 0, ctx())
        val failed = tr.failed("decode error")!!
        assertEquals(ProofOfPlayEvent.FAILED, failed.eventType)
        assertEquals("decode error", failed.failureReason)
    }

    @Test
    fun skippedIsStandaloneWithZeroDuration() {
        val tr = tracker { 1_000L }
        val ev = tr.skipped(item(type = ManifestItem.TYPE_VIDEO), 2, ctx(online = false, local = false))
        assertEquals(ProofOfPlayEvent.SKIPPED, ev.eventType)
        assertEquals(0L, ev.durationMs)
        assertTrue(ev.offlinePlayback)
        assertEquals(2, ev.itemSequence)
    }

    @Test
    fun emergencyTextItemReportsNullContentIdAndTextSource() {
        val tr = tracker { 1_000L }
        val synthetic = item(id = "emg:eb1", type = ManifestItem.TYPE_TEXT)
        val started = tr.started(synthetic, 0, ctx(source = "EMERGENCY", emergency = "eb1"))[0]
        assertNull(started.contentId)
        assertEquals(ProofOfPlayEvent.SOURCE_TEXT, started.playbackSource)
        assertEquals(ManifestItem.TYPE_TEXT, started.contentType)
    }

    @Test
    fun fileSourceReflectsCachePresence() {
        assertEquals(ProofOfPlayEvent.SOURCE_LOCAL_CACHE, PlaybackEventTracker.sourceOf(item(), ctx(local = true)))
        assertEquals(ProofOfPlayEvent.SOURCE_STREAMING, PlaybackEventTracker.sourceOf(item(), ctx(local = false)))
    }
}

class ProofOfPlayQueueTest {

    private fun tempFile(): File = File.createTempFile("pop_queue", ".json").apply { deleteOnExit() }

    @Test
    fun fifoAddPeekRemove() {
        val q = ProofOfPlayQueue(tempFile())
        val e = ProofOfPlayEvent(ProofOfPlayEvent.STARTED, "s1", "2026-06-16T00:00:00.000Z")
        q.add(e.copy(playbackSessionId = "s1"))
        q.add(e.copy(playbackSessionId = "s2"))
        q.add(e.copy(playbackSessionId = "s3"))
        assertEquals(listOf("s1", "s2"), q.peek(2).map { it.playbackSessionId })
        q.removeFirst(2)
        assertEquals(listOf("s3"), q.peek(10).map { it.playbackSessionId })
    }

    @Test
    fun boundedDropsOldest() {
        val q = ProofOfPlayQueue(tempFile(), maxEvents = 3)
        repeat(5) { i -> q.add(ProofOfPlayEvent(ProofOfPlayEvent.STARTED, "s$i", "t")) }
        assertEquals(3, q.size())
        assertEquals(listOf("s2", "s3", "s4"), q.peek(10).map { it.playbackSessionId })
    }

    @Test
    fun persistsAcrossInstances() {
        val file = tempFile()
        ProofOfPlayQueue(file).add(ProofOfPlayEvent(ProofOfPlayEvent.COMPLETED, "s1", "t"))
        val reloaded = ProofOfPlayQueue(file)
        assertEquals(1, reloaded.size())
        assertEquals("s1", reloaded.peek(1)[0].playbackSessionId)
    }
}

class ProofOfPlayReporterTest {

    private fun tempFile(): File = File.createTempFile("pop_reporter", ".json").apply { deleteOnExit() }
    private fun anEvent(id: String) = ProofOfPlayEvent(ProofOfPlayEvent.COMPLETED, id, "2026-06-16T00:00:00.000Z")

    @Test
    fun reportBuffersEvenWhenOffline() {
        val queue = ProofOfPlayQueue(tempFile())
        val reporter = ProofOfPlayReporter(tokenProvider = { null }, send = { _, _ -> true }, queue = queue)
        reporter.report(anEvent("s1"))
        assertEquals(1, queue.size()) // enqueued synchronously; flush is a no-op without a token
    }

    @Test
    fun flushSendsAndClearsOnSuccess() = runTest {
        val queue = ProofOfPlayQueue(tempFile())
        queue.add(anEvent("s1"))
        queue.add(anEvent("s2"))
        val sent = mutableListOf<ReportProofOfPlayRequest>()
        val reporter = ProofOfPlayReporter(
            tokenProvider = { "tok" },
            send = { _, req -> sent.add(req); true },
            queue = queue,
        )
        reporter.flush()
        assertEquals(0, queue.size())
        assertEquals(1, sent.size)
        assertEquals(listOf("s1", "s2"), sent[0].events.map { it.playbackSessionId })
    }

    @Test
    fun flushKeepsEventsWhenSendFails() = runTest {
        val queue = ProofOfPlayQueue(tempFile())
        queue.add(anEvent("s1"))
        val reporter = ProofOfPlayReporter(tokenProvider = { "tok" }, send = { _, _ -> false }, queue = queue)
        reporter.flush()
        assertEquals(1, queue.size()) // retained for retry
    }

    @Test
    fun flushDoesNothingWithoutToken() = runTest {
        val queue = ProofOfPlayQueue(tempFile())
        queue.add(anEvent("s1"))
        var called = false
        val reporter = ProofOfPlayReporter(tokenProvider = { null }, send = { _, _ -> called = true; true }, queue = queue)
        reporter.flush()
        assertFalse(called)
        assertEquals(1, queue.size())
    }
}
