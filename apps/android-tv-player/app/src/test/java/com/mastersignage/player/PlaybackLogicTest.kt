package com.mastersignage.player

import com.mastersignage.player.data.model.ManifestItem
import com.mastersignage.player.util.Playback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    @Test
    fun mediaUrlPrefersSignedThenUrl() {
        assertEquals("https://signed", Playback.mediaUrl(item(ManifestItem.TYPE_IMAGE, signedUrl = "https://signed", url = "https://public")))
        assertEquals("https://public", Playback.mediaUrl(item(ManifestItem.TYPE_URL, url = "https://public")))
        assertNull(Playback.mediaUrl(item(ManifestItem.TYPE_TEXT)))
    }
}
