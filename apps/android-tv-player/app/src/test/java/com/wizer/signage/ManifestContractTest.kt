package com.wizer.signage

import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The player half of the device-manifest contract (see contracts/README.md).
 *
 * `ManifestParsingTest` proves this model can parse JSON that THIS REPO'S TEST
 * FILE typed by hand. It cannot notice the backend changing, because the backend
 * is not involved: rename `signedUrl` to `signedURL` on the server and that test
 * still passes, the API's own tests still pass, and every screen in the fleet
 * goes blank playing a manifest whose media fields are all null.
 *
 * This test parses the committed fixtures instead — the same bytes the API's
 * `device-manifest.contract.spec.ts` pins to its own types.
 *
 * Two deliberate differences from production parsing:
 *
 *  - `ignoreUnknownKeys = false`. Production keeps it TRUE so a running fleet
 *    tolerates additive backend changes rather than going dark on a deploy. Here
 *    it is the entire point: a field the API sends and this model does not
 *    declare must be a build failure, not a value quietly dropped. That is how
 *    `metadata.emergency` was found — the backend has always sent it and the
 *    player has always discarded it.
 *  - `explicitNulls`/`isLenient` are left at their defaults, so the fixtures
 *    must be strictly valid JSON rather than merely readable.
 */
class ManifestContractTest {

    private val strict = Json { ignoreUnknownKeys = false }

    /**
     * Gradle's working directory for unit tests is the module dir, but that is
     * not contractual. Walk up for the `contracts/` directory instead, and fail
     * loudly if it is gone — a fixture that silently stops being read would
     * restore the exact blind spot this file removes.
     */
    private fun fixture(name: String): String {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "contracts/$name")
            if (candidate.isFile) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError(
            "Could not find contracts/$name walking up from ${System.getProperty("user.dir")}. " +
                "It is shared with the API — see contracts/README.md.",
        )
    }

    @Test
    fun parsesTheScheduleGoldenManifestStrictly() {
        val manifest = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.schedule.golden.json"),
        )

        assertEquals("scr_0000000000000001", manifest.screenId)
        assertEquals(PlaybackManifest.SOURCE_SCHEDULE, manifest.sourceType)
        assertEquals("Asia/Riyadh", manifest.timezone)
        assertEquals(10, manifest.priority)
        assertEquals(5, manifest.items.size)
        assertEquals(1, manifest.warnings.size)
    }

    @Test
    fun parsesTheEmergencyGoldenManifestStrictly() {
        val manifest = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.emergency.golden.json"),
        )

        assertEquals(PlaybackManifest.SOURCE_EMERGENCY, manifest.sourceType)
        assertEquals("emb_0000000000000001", manifest.emergencyBroadcastId)
        assertNull(manifest.scheduleId)
        assertEquals(2, manifest.items.size)
    }

    @Test
    fun readsTheFieldsPlaybackDependsOn() {
        // Named individually rather than asserted as a blob: these are the ones
        // whose loss blanks a screen, and a rename must name the casualty.
        val manifest = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.schedule.golden.json"),
        )
        val image = manifest.items.first { it.type == ManifestItem.TYPE_IMAGE }

        assertNotNull("signedUrl drives online playback", image.signedUrl)
        assertNotNull("downloadPath drives offline caching", image.downloadPath)
        assertNotNull("checksum gates the cached-asset integrity check", image.checksum)
        assertEquals("534210", image.fileSizeBytes)
        assertEquals(10, image.durationSeconds)
        assertTrue("version drives cache invalidation", image.version.isNotEmpty())
    }

    @Test
    fun modelsEveryContentTypeTheBackendSends() {
        val manifest = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.schedule.golden.json"),
        )
        assertEquals(
            listOf(
                ManifestItem.TYPE_IMAGE,
                ManifestItem.TYPE_PDF,
                ManifestItem.TYPE_TEXT,
                ManifestItem.TYPE_URL,
                ManifestItem.TYPE_VIDEO,
            ),
            manifest.items.map { it.type }.sorted(),
        )
    }

    @Test
    fun modelsBothMetadataShapes() {
        // The shape a strict parse catches: production's ignoreUnknownKeys=true
        // silently discarded `emergency`, and nothing failed.
        val schedule = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.schedule.golden.json"),
        )
        assertEquals(3, schedule.items.first { it.type == ManifestItem.TYPE_PDF }.metadata?.pageCount)

        val emergency = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.emergency.golden.json"),
        )
        assertEquals(true, emergency.items.first().metadata?.emergency)
    }

    @Test
    fun prefersTheStableHashOverGeneratedAtForSyncVersion() {
        // syncVersion is what the device reports back; using generatedAt would
        // make every screen look out of date on every resolve.
        val manifest = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.schedule.golden.json"),
        )
        assertEquals(manifest.manifestHash, manifest.syncVersion)
        assertTrue(manifest.manifestHash != manifest.generatedAt)
    }

    @Test
    fun handlesTheNullHeavyUrlAndTextItems() {
        // URL/TEXT items carry null in every media field. This is the shape most
        // likely to be mis-modelled, because it exercises none of the defaults.
        val manifest = strict.decodeFromString<PlaybackManifest>(
            fixture("device-manifest.schedule.golden.json"),
        )

        val url = manifest.items.first { it.type == ManifestItem.TYPE_URL }
        assertEquals("https://dashboard.example.com/kiosk", url.url)
        assertNull(url.signedUrl)
        assertNull(url.downloadPath)
        assertNull(url.checksum)

        val text = manifest.items.first { it.type == ManifestItem.TYPE_TEXT }
        assertEquals("Welcome to the building.", text.textBody)
        assertNull(text.mimeType)
    }
}
