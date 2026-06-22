package com.mastersignage.player.data.cache

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Atomic, index-backed asset cache. Takes a plain [baseDir] (the caller passes
 * `context.filesDir`) so the whole class is JVM-unit-testable with a temp
 * directory — no Android Context.
 *
 * The index is keyed by **(contentId, version)** so multiple versions of the
 * same content can coexist: while the new manifest's assets are still
 * downloading, the previous (offline-safe last-good) version stays cached and
 * findable. Cleanup keeps a versioned keep-set (current manifest + sync plan +
 * last-good), so the old playable cache is never deleted until the new cache is
 * ready. Assets are written to a temp file, verified by the caller, then
 * committed (renamed) into the final path; the index is only updated on commit.
 */
class CacheManager(
    private val baseDir: File,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val assetsDir = File(baseDir, "assets").apply { mkdirs() }
    val tmpDir: File = File(baseDir, "tmp").apply { mkdirs() }
    private val indexFile = File(baseDir, "cache_index.json")

    private var index: CacheIndex = loadIndex()

    @Synchronized
    private fun loadIndex(): CacheIndex =
        try {
            if (indexFile.exists()) json.decodeFromString(CacheIndex.serializer(), indexFile.readText()) else CacheIndex()
        } catch (e: Exception) {
            CacheIndex()
        }

    @Synchronized
    private fun saveIndex() {
        try {
            indexFile.writeText(json.encodeToString(index))
        } catch (e: Exception) {
            // Best-effort; in-memory state remains correct.
        }
    }

    private fun key(contentId: String, version: String): String = "$contentId@@$version"

    /** A stable, filesystem-safe, version-specific file name. */
    fun fileNameFor(contentId: String, version: String): String =
        "${contentId}_${version.hashCode().toUInt()}.bin"

    @Synchronized
    fun isReady(contentId: String, version: String): Boolean {
        val asset = index.assets[key(contentId, version)] ?: return false
        return File(assetsDir, asset.fileName).exists()
    }

    /** The ready local file for a specific content version, or null. */
    @Synchronized
    fun readyFile(contentId: String, version: String): File? {
        val asset = index.assets[key(contentId, version)] ?: return null
        val file = File(assetsDir, asset.fileName)
        return if (file.exists()) file else null
    }

    /** Commit a verified temp file into the cache atomically and index it (by content+version). */
    @Synchronized
    fun commit(asset: CachedAsset, tempFile: File): File {
        val finalFile = File(assetsDir, asset.fileName)
        if (finalFile.exists()) finalFile.delete()
        if (!tempFile.renameTo(finalFile)) {
            tempFile.copyTo(finalFile, overwrite = true)
            tempFile.delete()
        }
        val stored = asset.copy(fileName = finalFile.name, fileSize = finalFile.length())
        index = index.copy(assets = index.assets + (key(asset.contentId, asset.version) to stored))
        saveIndex()
        return finalFile
    }

    @Synchronized
    fun touch(contentId: String, version: String) {
        val k = key(contentId, version)
        val asset = index.assets[k] ?: return
        index = index.copy(assets = index.assets + (k to asset.copy(lastUsedAt = clock())))
        saveIndex()
    }

    @Synchronized
    fun cachedCount(): Int = index.assets.size

    @Synchronized
    fun totalSizeBytes(): Long =
        index.assets.values.sumOf { File(assetsDir, it.fileName).let { f -> if (f.exists()) f.length() else 0L } }

    fun availableStorageBytes(): Long = assetsDir.usableSpace

    /**
     * Remove cached assets whose (contentId, version) is NOT in [keep] (cleanup).
     * Current, last-good, fallback, and upcoming assets stay (they are in the
     * keep-set). Superseded versions are pruned only once nothing references them.
     * Returns the number removed.
     */
    @Synchronized
    fun cleanup(keep: Set<Pair<String, String>>): Int {
        val keepKeys = keep.mapTo(HashSet()) { key(it.first, it.second) }
        val toRemove = index.assets.keys.filter { it !in keepKeys }
        toRemove.forEach { k -> index.assets[k]?.let { File(assetsDir, it.fileName).delete() } }
        if (toRemove.isNotEmpty()) {
            index = index.copy(assets = index.assets.filterKeys { it in keepKeys })
            saveIndex()
        }
        return toRemove.size
    }
}
