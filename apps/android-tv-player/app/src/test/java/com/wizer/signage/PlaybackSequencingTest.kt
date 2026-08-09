package com.wizer.signage

import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.util.Playback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackSequencingTest {
    private fun item(
        type: String = ManifestItem.TYPE_IMAGE,
        durationSeconds: Int = 0,
        playFullVideo: Boolean = false,
    ) = ManifestItem(
        contentId = "content-1",
        type = type,
        version = "v1",
        durationSeconds = durationSeconds,
        playFullVideo = playFullVideo,
    )

    @Test
    fun oneItemPlaylistLoopsWithoutReusingTheSamePlayIdentity() {
        assertEquals(0, Playback.nextIndex(0, 1))
        assertNotEquals(Playback.playKey("content-1", 0), Playback.playKey("content-1", 1))
    }

    @Test
    fun multiItemPlaylistWrapsAtTheEnd() {
        assertEquals(1, Playback.nextIndex(0, 3))
        assertEquals(2, Playback.nextIndex(1, 3))
        assertEquals(0, Playback.nextIndex(2, 3))
        assertEquals(0, Playback.nextIndex(99, 0))
    }

    @Test
    fun nonVideoWithoutDurationUsesSafeDefaultDwell() {
        assertEquals(Playback.DEFAULT_DURATION_SECONDS * 1000L, Playback.displayMillis(item()))
    }

    @Test
    fun fixedDurationVideoAdvancesAtDeclaredDurationBeforeWatchdog() {
        val video = item(type = ManifestItem.TYPE_VIDEO, durationSeconds = 12)
        val display = Playback.displayMillis(video)
        val watchdog = Playback.videoWatchdogMillis(video)

        assertEquals(12_000L, display)
        assertTrue(watchdog > display!!)
    }

    @Test
    fun fullVideoWaitsForNaturalEndButStillHasAWatchdog() {
        val video = item(
            type = ManifestItem.TYPE_VIDEO,
            durationSeconds = 0,
            playFullVideo = true,
        )

        assertNull(Playback.displayMillis(video))
        assertTrue(Playback.videoWatchdogMillis(video) >= Playback.VIDEO_WATCHDOG_DEFAULT_MS)
    }
}
