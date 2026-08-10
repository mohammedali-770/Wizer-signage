package com.wizer.signage

import com.wizer.signage.data.cache.CacheManager
import com.wizer.signage.data.cache.CachedAsset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class CacheManagerTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var baseDir: File
    private lateinit var cache: CacheManager

    @Before
    fun setUp() {
        baseDir = tmp.newFolder("cache")
        cache = CacheManager(baseDir)
    }

    private fun commit(id: String, version: String = "v1", bytes: ByteArray = byteArrayOf(1, 2, 3)): File {
        val temp = File(cache.tmpDir, "t_${id}_$version")
        temp.writeBytes(bytes)
        val asset = CachedAsset(contentId = id, version = version, fileName = cache.fileNameFor(id, version), type = "IMAGE")
        return cache.commit(asset, temp)
    }

    @Test
    fun commitMakesAssetReadyAndMovesTheTempFile() {
        val temp = File(cache.tmpDir, "tmpx")
        temp.writeBytes(byteArrayOf(9, 9, 9))
        val asset = CachedAsset(contentId = "c1", version = "v1", fileName = cache.fileNameFor("c1", "v1"), type = "VIDEO")
        cache.commit(asset, temp)

        assertFalse("temp file should be moved, not left behind", temp.exists())
        assertTrue(cache.isReady("c1", "v1"))
        assertFalse("version mismatch is not ready", cache.isReady("c1", "v2"))
        assertNotNull(cache.readyFile("c1", "v1"))
        assertNull(cache.readyFile("c1", "v2"))
    }

    @Test
    fun cleanupKeepsActiveAndFallbackButRemovesUnreferenced() {
        commit("active")
        commit("fallback")
        commit("stale")
        assertEquals(3, cache.cachedCount())

        val removed = cache.cleanup(setOf("active" to "v1", "fallback" to "v1"))

        assertEquals(1, removed)
        assertTrue(cache.isReady("active", "v1"))
        assertTrue(cache.isReady("fallback", "v1"))
        assertNull(cache.readyFile("stale", "v1"))
        assertEquals(2, cache.cachedCount())
    }

    @Test
    fun keepsBothVersionsUntilCleanupPrunesTheSuperseded() {
        commit("c1", "v1")
        commit("c1", "v2")
        assertEquals("both versions are cached", 2, cache.cachedCount())
        assertTrue(cache.isReady("c1", "v1"))
        assertTrue(cache.isReady("c1", "v2"))

        // Keep only v2 (as the promoted manifest would) — v1 is pruned, v2 stays.
        val removed = cache.cleanup(setOf("c1" to "v2"))
        assertEquals(1, removed)
        assertNull(cache.readyFile("c1", "v1"))
        assertNotNull(cache.readyFile("c1", "v2"))
        assertEquals(1, cache.cachedCount())
    }

    @Test
    fun totalSizeSumsCachedFiles() {
        commit("a", bytes = ByteArray(10))
        commit("b", bytes = ByteArray(20))
        assertEquals(30L, cache.totalSizeBytes())
    }

    @Test
    fun indexPersistsAcrossInstances() {
        commit("c1")
        val reopened = CacheManager(baseDir)
        assertTrue(reopened.isReady("c1", "v1"))
        assertEquals(1, reopened.cachedCount())
    }

    @Test
    fun corruptIndexFailsClosedInsteadOfTrustingOrphanedAssets() {
        val assetFile = commit("c1")
        assertTrue(assetFile.exists())
        File(baseDir, "cache_index.json").writeText("{\"assets\":")

        val reopened = CacheManager(baseDir)

        assertEquals(0, reopened.cachedCount())
        assertFalse("an unindexed orphan must not become playable", reopened.isReady("c1", "v1"))
        assertNull(reopened.readyFile("c1", "v1"))
    }
}