package com.mastersignage.player.data

import com.mastersignage.player.data.model.PlaybackManifest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Persists the last-good playback manifest so the player can keep looping when
 * offline. File-injectable (no Android Context) so it is JVM-unit-testable.
 * The last-good manifest is only advanced once all of its file assets are cached
 * (see SyncManager), so it is always offline-safe.
 */
class ManifestStore(baseDir: File) {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val lastGoodFile = File(baseDir, "manifest_last_good.json")

    fun loadLastGood(): PlaybackManifest? = read(lastGoodFile)

    fun saveLastGood(manifest: PlaybackManifest) = write(lastGoodFile, manifest)

    /** Forget the last-good manifest (e.g. on a full cache clear) so offline never
     * references assets that were deleted. */
    fun clearLastGood() {
        try {
            lastGoodFile.delete()
        } catch (e: Exception) {
            // Best-effort.
        }
    }

    private fun read(file: File): PlaybackManifest? =
        try {
            if (file.exists()) json.decodeFromString(PlaybackManifest.serializer(), file.readText()) else null
        } catch (e: Exception) {
            null
        }

    private fun write(file: File, manifest: PlaybackManifest) {
        try {
            file.writeText(json.encodeToString(manifest))
        } catch (e: Exception) {
            // Best-effort persistence.
        }
    }
}
