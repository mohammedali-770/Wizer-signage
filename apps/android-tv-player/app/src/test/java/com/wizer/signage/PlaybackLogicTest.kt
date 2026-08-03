package com.wizer.signage

import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.util.Playback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackLogicTest {

    private fun item(
        type: String,
        duration: Int = 0,
        full: Boolean = false,
        signedUrl: String? = null,
        url: String? = null,
    ) = ManifestItem(
        contentId = "c",
        type = type,
        durationSeconds = duration,
        playFullVideo = full,
        signedUrl = signedUrl,
        url = url,
    )

    @Test
    fun imageUsesItsDuration() {
        assertEquals(15_000L, Playback.displayMillis(item(ManifestItem.TYPE_IMAGE, duration = 15)))
    }

    @Test
    fun stillDefaultsWhenDurationMissing() {
        assertEquals(10_000L, Playback.displayMillis(item(ManifestItem.TYPE_IMAGE, duration = 0)))
        assertEquals(10_000L, Playback.displayMillis(item(ManifestItem.TYPE_TEXT, duration = 0)))
    }

    @Test
    fun textUsesItsDuration() {
        assertEquals(8_000L, Playback.displayMillis(item(ManifestItem.TYPE_TEXT, duration = 8)))
    }

    @Test
    fun fullVideoPlaysToNaturalEnd() {
        assertNull(Playback.displayMillis(item(ManifestItem.TYPE_VIDEO, duration = 0, full = true)))
    }

    @Test
    fun videoWithZeroDurationPlaysToNaturalEnd() {
        assertNull(Playback.displayMillis(item(ManifestItem.TYPE_VIDEO, duration = 0, full = false)))
    }

    @Test
    fun videoWithCustomDurationStopsEarly() {
        assertEquals(30_000L, Playback.displayMillis(item(ManifestItem.TYPE_VIDEO, duration = 30, full = false)))
    }

    @Test
    fun nextIndexLoops() {
        assertEquals(1, Playback.nextIndex(0, 3))
        assertEquals(0, Playback.nextIndex(2, 3))
        assertEquals(0, Playback.nextIndex(5, 0)) // empty list guard
    }

    // --- per-play keying (single-item playlist freeze) -------------------------

    @Test
    fun singleItemPlaylistStaysOnIndexZero() {
        // The reason contentId alone can never key a play: the item never changes.
        assertEquals(0, Playback.nextIndex(0, 1))
    }

    @Test
    fun playKeyChangesOnEveryLoopOfTheSameItem() {
        val keys = (0 until 5).map { Playback.playKey("content-1", it) }
        assertEquals(5, keys.toSet().size)
    }

    @Test
    fun playKeyDistinguishesItemsAndPlays() {
        assertEquals(Playback.playKey("a", 3), Playback.playKey("a", 3))
        assertNotEquals(Playback.playKey("a", 3), Playback.playKey("a", 4))
        assertNotEquals(Playback.playKey("a", 3), Playback.playKey("b", 3))
    }

    /** Mirrors the player's advance loop: every play must get a fresh guard key. */
    @Test
    fun loopingOneVideoNeverReusesAPlayKey() {
        val items = listOf(item(ManifestItem.TYPE_VIDEO, full = true))
        var index = 0
        var playCount = 0
        val seen = mutableSetOf<String>()
        repeat(50) {
            assertTrue(seen.add(Playback.playKey(items[index].contentId, playCount)))
            index = Playback.nextIndex(index, items.size)
            playCount++
        }
        assertEquals(50, seen.size)
    }

    // --- video stall watchdog ---------------------------------------------------

    @Test
    fun watchdogAllowsTheDeclaredDurationPlusGrace() {
        val watchdog = Playback.videoWatchdogMillis(item(ManifestItem.TYPE_VIDEO, duration = 30, full = true))
        assertEquals(30_000L + Playback.VIDEO_WATCHDOG_GRACE_MS, watchdog)
    }

    @Test
    fun watchdogFallsBackToASaneCeilingWhenDurationIsUnknown() {
        val watchdog = Playback.videoWatchdogMillis(item(ManifestItem.TYPE_VIDEO, duration = 0, full = true))
        assertEquals(Playback.VIDEO_WATCHDOG_DEFAULT_MS + Playback.VIDEO_WATCHDOG_GRACE_MS, watchdog)
    }

    @Test
    fun watchdogNeverPreemptsAHealthyFixedDurationPlay() {
        // A fixed-duration video must be cut by displayMillis (COMPLETED), never
        // by the watchdog (FAILED) — so the watchdog is always strictly later.
        for (seconds in listOf(1, 5, 30, 600)) {
            val video = item(ManifestItem.TYPE_VIDEO, duration = seconds, full = false)
            val fixed = Playback.displayMillis(video)!!
            assertTrue(Playback.videoWatchdogMillis(video) > fixed)
        }
    }

    @Test
    fun watchdogIsFiniteForEveryVideoShape() {
        // Nothing may return "wait forever": that is the freeze this guards.
        for (video in listOf(
            item(ManifestItem.TYPE_VIDEO, duration = 0, full = true),
            item(ManifestItem.TYPE_VIDEO, duration = 0, full = false),
            item(ManifestItem.TYPE_VIDEO, duration = -5, full = true),
            item(ManifestItem.TYPE_VIDEO, duration = 45, full = true),
        )) {
            val watchdog = Playback.videoWatchdogMillis(video)
            assertTrue(watchdog > 0L)
            assertTrue(watchdog <= Playback.VIDEO_WATCHDOG_DEFAULT_MS + Playback.VIDEO_WATCHDOG_GRACE_MS)
        }
    }

    @Test
    fun mediaUrlPrefersSignedThenUrl() {
        assertEquals("https://signed", Playback.mediaUrl(item(ManifestItem.TYPE_IMAGE, signedUrl = "https://signed", url = "https://public")))
        assertEquals("https://public", Playback.mediaUrl(item(ManifestItem.TYPE_URL, url = "https://public")))
        assertNull(Playback.mediaUrl(item(ManifestItem.TYPE_TEXT)))
    }
}
