package com.wizer.signage

import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ManifestParsingTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; isLenient = true }

    @Test
    fun parsesAScheduleManifest() {
        val raw = """
            {
              "screenId": "s1",
              "generatedAt": "2026-06-15T12:00:00.000Z",
              "timezone": "Asia/Riyadh",
              "sourceType": "SCHEDULE",
              "scheduleId": "sch1",
              "scheduleName": "Lunch promo",
              "playlistId": "pl1",
              "playlistTitle": "Lobby loop",
              "priority": 10,
              "outsideHours": false,
              "outsideHoursBehavior": null,
              "message": null,
              "items": [
                {
                  "contentId": "c1", "type": "IMAGE", "title": "Banner",
                  "durationSeconds": 10, "playFullVideo": false, "pdfPageDurationSeconds": null,
                  "orientation": "LANDSCAPE", "fileSizeBytes": "534210", "checksum": "abc",
                  "mimeType": "image/png", "signedUrl": "https://signed/img", "url": null,
                  "textBody": null, "metadata": { "pageCount": null }
                },
                {
                  "contentId": "c2", "type": "VIDEO", "title": "Promo clip",
                  "durationSeconds": 0, "playFullVideo": true, "pdfPageDurationSeconds": null,
                  "orientation": "LANDSCAPE", "fileSizeBytes": "9000000", "checksum": "def",
                  "mimeType": "video/mp4", "signedUrl": "https://signed/vid", "url": null,
                  "textBody": null, "metadata": { "pageCount": 3 }
                }
              ],
              "warnings": ["Content is landscape but the screen is portrait."]
            }
        """.trimIndent()

        val manifest = json.decodeFromString<PlaybackManifest>(raw)

        assertEquals("s1", manifest.screenId)
        assertEquals(PlaybackManifest.SOURCE_SCHEDULE, manifest.sourceType)
        assertEquals(10, manifest.priority)
        assertEquals(2, manifest.items.size)
        assertEquals(1, manifest.warnings.size)

        val image = manifest.items[0]
        assertEquals(ManifestItem.TYPE_IMAGE, image.type)
        assertEquals("https://signed/img", image.signedUrl)
        assertEquals(10, image.durationSeconds)
        assertEquals("534210", image.fileSizeBytes)

        val video = manifest.items[1]
        assertEquals(ManifestItem.TYPE_VIDEO, video.type)
        assertTrue(video.playFullVideo)
        assertEquals(3, video.metadata?.pageCount)
    }

    @Test
    fun toleratesUnknownFieldsAndNoneSource() {
        val raw = """
            { "screenId": "s9", "sourceType": "NONE", "items": [], "someFutureField": true }
        """.trimIndent()
        val manifest = json.decodeFromString<PlaybackManifest>(raw)
        assertEquals(PlaybackManifest.SOURCE_NONE, manifest.sourceType)
        assertTrue(manifest.items.isEmpty())
        assertNull(manifest.scheduleId)
    }

    @Test
    fun parsesOutsideHoursManifest() {
        val raw = """
            { "screenId": "s1", "sourceType": "NONE", "outsideHours": true,
              "outsideHoursBehavior": "CUSTOM_MESSAGE", "message": "Back at 9am", "items": [] }
        """.trimIndent()
        val manifest = json.decodeFromString<PlaybackManifest>(raw)
        assertTrue(manifest.outsideHours)
        assertEquals("CUSTOM_MESSAGE", manifest.outsideHoursBehavior)
        assertEquals("Back at 9am", manifest.message)
    }
}
