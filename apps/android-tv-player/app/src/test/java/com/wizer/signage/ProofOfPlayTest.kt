package com.wizer.signage

import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.ProofOfPlayEvent
import com.wizer.signage.data.model.ReportProofOfPlayRequest
import com.wizer.signage.proofofplay.PlaybackEventTracker
import com.wizer.signage.proofofplay.ProofOfPlayQueue
import com.wizer.signage.proofofplay.ProofOfPlayReporter
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

    /**
     * One timeline: wall clock and monotonic clock advance together. A separate
     * overload is used by the NTP-jump cases below, which move them apart.
     * (Two overloads rather than a default argument so `tracker { t }` trailing
     * -lambda syntax still binds to `clock`.)
     */
    private fun tracker(clock: () -> Long): PlaybackEventTracker = tracker(clock, clock)

    private fun tracker(clock: () -> Long, elapsed: () -> Long): PlaybackEventTracker {
        var n = 0
        return PlaybackEventTracker(
            clock = clock,
            elapsed = elapsed,
            newSessionId = { "sess-${++n}" },
        )
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

    /**
     * Pins the ISO-8601 UTC millisecond format emitted by the (thread-local)
     * SimpleDateFormat. Guards the API-21-safe ThreadLocal refactor: exact
     * strings, fixed clock, no dependence on the host timezone.
     */
    @Test
    fun timestampsAreIso8601UtcMillis() {
        var t = 0L
        val tr = PlaybackEventTracker(clock = { t }, elapsed = { t }, newSessionId = { "s" })
        val started = tr.started(item(), 0, ctx())[0]
        assertEquals("1970-01-01T00:00:00.000Z", started.startedAt)

        t = 86_400_000L + 1L // one day + 1 ms → next date, .001 millis
        val completed = tr.completed()!!
        assertEquals("1970-01-01T00:00:00.000Z", completed.startedAt)
        assertEquals("1970-01-02T00:00:00.001Z", completed.endedAt)
    }

    /**
     * Durations must come from a MONOTONIC clock.
     *
     * An Android TV box has no RTC battery: it boots with a bogus time and jumps,
     * often by years, the moment NTP lands — routinely mid-playback on the first
     * item after a power cut. Subtracting two wall-clock readings across that
     * jump reported hours of playback for a 15-second image, or zero when the
     * jump went backwards. This is the advertiser-billing record.
     */
    @Test
    fun durationSurvivesAnNtpJumpForward() {
        var wall = 1_000L
        var mono = 500L
        val tr = tracker({ wall }, { mono })

        tr.started(item(), 0, ctx())
        // 15 seconds of real playback...
        mono += 15_000
        // ...during which NTP corrects the clock forward by two years.
        wall += 63_072_000_000L

        val done = tr.completed()!!
        assertEquals(15_000L, done.durationMs)
    }

    @Test
    fun durationSurvivesAnNtpJumpBackward() {
        var wall = 63_072_000_000L
        var mono = 500L
        val tr = tracker({ wall }, { mono })

        tr.started(item(), 0, ctx())
        mono += 8_000
        wall = 1_000L // clock corrected backwards

        val done = tr.completed()!!
        // Wall-clock subtraction would have been negative and coerced to 0.
        assertEquals(8_000L, done.durationMs)
    }

    @Test
    fun endedAtStaysConsistentWithDurationAcrossAJump() {
        // Any billing sum depends on endedAt - startedAt == durationMs. Reading
        // the wall clock again at the end would break that the moment NTP fires.
        var wall = 0L
        var mono = 0L
        val tr = tracker({ wall }, { mono })

        tr.started(item(), 0, ctx())
        mono += 12_000
        wall += 99_999_999L

        val done = tr.completed()!!
        assertEquals("1970-01-01T00:00:00.000Z", done.startedAt)
        assertEquals("1970-01-01T00:00:12.000Z", done.endedAt)
        assertEquals(12_000L, done.durationMs)
    }

    @Test
    fun interruptedItemAlsoUsesTheMonotonicDuration() {
        var wall = 1_000L
        var mono = 0L
        val tr = tracker({ wall }, { mono })

        tr.started(item(), 0, ctx())
        mono += 4_000
        wall += 500_000_000L

        // A second `started` pre-empts the first and auto-closes it.
        val out = tr.started(item("c2"), 1, ctx())
        val interrupted = out.first { it.eventType == ProofOfPlayEvent.INTERRUPTED }
        assertEquals(4_000L, interrupted.durationMs)
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
