package com.wizer.signage

import com.wizer.signage.data.ApiClient
import com.wizer.signage.data.cache.AssetDownloader
import com.wizer.signage.data.cache.CacheManager
import com.wizer.signage.data.model.SyncPlanItem
import com.wizer.signage.util.Checksums
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The direct-storage path must never be able to strand an asset.
 *
 * The first version of this fallback keyed on the transport result alone:
 *
 *     var downloaded = directUrl != null && api.downloadFromUrl(directUrl, temp)
 *     if (!downloaded && proxiedPath != null) { downloaded = api.downloadToFile(...) }
 *
 * A 200 carrying the WRONG bytes therefore set downloaded = true, skipped the
 * proxy, failed verification, and -- because the direct URL is fixed for the
 * whole call -- repeated the identical bad request on every retry. The
 * authenticated path was never tried at all, so the asset never cached.
 *
 * That is not hypothetical for this system: replacing a file under the same name
 * reuses the storage key (content.service.ts buildKey), which skips the
 * storage.remove that is the only signed-URL cache invalidation, so a screen can
 * be handed a URL that still serves the pre-replace object while the plan's
 * checksum has already advanced.
 */
class AssetDownloadFallbackTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var cache: CacheManager
    private lateinit var downloader: AssetDownloader

    private val goodBytes = "THE-REAL-ASSET".toByteArray()
    private val staleBytes = "STALE-CDN-COPY".toByteArray()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cache = CacheManager(tmp.newFolder("cache"))
        downloader = AssetDownloader(ApiClient(server.url("/api").toString(), OkHttpClient()), cache)
    }

    @After
    fun tearDown() = server.shutdown()

    private fun item(withDirect: Boolean = true, checksumOf: ByteArray? = goodBytes) = SyncPlanItem(
        contentId = "c1",
        type = "IMAGE",
        version = "v2",
        checksum = checksumOf?.let { Checksums.sha256(it) },
        signedUrl = if (withDirect) server.url("/object/signed/c1").toString() else null,
        downloadPath = "/device/content/c1/download",
    )

    /** readyFile() is the public accessor; assetsDir is private to CacheManager. */
    private fun cachedBytes(): ByteArray =
        requireNotNull(cache.readyFile("c1", "v2")) { "asset not committed" }.readBytes()

    @Test
    fun `falls back to the proxy when the direct download is a 200 with the wrong bytes`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(staleBytes)))  // direct: stale
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(goodBytes)))   // proxy: correct

        val ok = downloader.download("tok", item(), maxAttempts = 1)

        assertTrue("a verification failure must still fall back to the proxied path", ok)
        assertEquals("both paths should be tried inside ONE attempt", 2, server.requestCount)
        assertTrue(cache.isReady("c1", "v2"))
        assertArrayEquals("the committed bytes must be the verified ones", goodBytes, cachedBytes())
    }

    @Test
    fun `the proxied retry carries the device token and the direct one does not`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(staleBytes)))
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(goodBytes)))

        downloader.download("tok", item(), maxAttempts = 1)

        val direct = server.takeRequest()
        val proxied = server.takeRequest()
        assertNull(direct.getHeader("X-Device-Token"))
        assertEquals("tok", proxied.getHeader("X-Device-Token"))
    }

    @Test
    fun `still falls back when the direct download fails outright`() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("<Error>expired</Error>"))
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(goodBytes)))

        assertTrue(downloader.download("tok", item(), maxAttempts = 1))
        assertArrayEquals(goodBytes, cachedBytes())
    }

    @Test
    fun `does not commit when both paths deliver unverifiable bytes`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(staleBytes)))
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(staleBytes)))

        val ok = downloader.download("tok", item(), maxAttempts = 1)

        assertFalse(ok)
        assertFalse("bad bytes must never enter the cache", cache.isReady("c1", "v2"))
    }

    @Test
    fun `leaves no temp files behind on any path`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(staleBytes)))
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(goodBytes)))
        downloader.download("tok", item(), maxAttempts = 1)
        assertEquals(
            "a rejected direct download must not leave a .part file",
            0,
            cache.tmpDir.listFiles()?.size ?: 0,
        )
    }

    @Test
    fun `skips the direct path entirely when the plan carries no checksum`() = runTest {
        // Checksums.verify passes a null expected hash, so an unverifiable direct
        // download could admit unchecked third-party bytes. Only the proxy is used.
        server.enqueue(MockResponse().setResponseCode(200).setBody(String(goodBytes)))

        assertTrue(downloader.download("tok", item(checksumOf = null), maxAttempts = 1))
        assertEquals("only the proxied request should be made", 1, server.requestCount)
        assertEquals("/api/device/content/c1/download", server.takeRequest().path)
    }
}
