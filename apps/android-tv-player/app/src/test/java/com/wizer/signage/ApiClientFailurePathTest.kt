package com.wizer.signage

import com.wizer.signage.data.ApiClient
import com.wizer.signage.data.ManifestResult
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ApiClientFailurePathTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun client(http: OkHttpClient = OkHttpClient()): ApiClient =
        ApiClient(server.url("/api").toString(), http)

    @Test
    fun `manifest 401 is distinguished from a transient failure`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))

        val result = client().getManifest("device-secret")

        assertTrue(result is ManifestResult.Unauthorized)
        val request = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/api/device/manifest", request.path)
        assertEquals("device-secret", request.getHeader("X-Device-Token"))
    }

    @Test
    fun `manifest 429 remains a retryable error rather than revoking the device`() = runTest {
        server.enqueue(MockResponse().setResponseCode(429).setBody("rate limited"))

        val result = client().getManifest("token")

        assertEquals(ManifestResult.Error("HTTP 429"), result)
    }

    @Test
    fun `manifest 5xx remains a retryable error`() = runTest {
        server.enqueue(MockResponse().setResponseCode(503).setBody("maintenance"))

        val result = client().getManifest("token")

        assertEquals(ManifestResult.Error("HTTP 503"), result)
    }

    @Test
    fun `malformed successful manifest fails closed instead of replacing cached playback`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("{\"manifestVersion\":"),
        )

        val result = client().getManifest("token")

        assertTrue(result is ManifestResult.Error)
    }

    @Test
    fun `read timeout returns promptly as a network error`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val fastTimeoutClient = OkHttpClient.Builder()
            .connectTimeout(100, TimeUnit.MILLISECONDS)
            .readTimeout(50, TimeUnit.MILLISECONDS)
            .callTimeout(150, TimeUnit.MILLISECONDS)
            .build()

        val started = System.nanoTime()
        val result = client(fastTimeoutClient).getManifest("token")
        val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)

        assertTrue(result is ManifestResult.Error)
        assertTrue("test transport should time out quickly (elapsed=${elapsedMs}ms)", elapsedMs < 1_000)
    }

    @Test
    fun `http content failure deletes any stale destination`() = runTest {
        server.enqueue(MockResponse().setResponseCode(503).setBody("maintenance"))
        val directory = Files.createTempDirectory("wizer-api-client-test").toFile()
        val destination = directory.resolve("asset.bin").apply { writeText("stale-bytes") }

        try {
            val ok = client().downloadToFile("token", "/device/content/asset/download", destination)

            assertFalse(ok)
            assertFalse("failed HTTP download must remove stale destination bytes", destination.exists())
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun `truncated content download deletes the partial file`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("short")
                .setHeader("Content-Length", "100"),
        )
        val directory = Files.createTempDirectory("wizer-api-client-test").toFile()
        val destination = directory.resolve("asset.bin")

        try {
            val ok = client().downloadToFile("token", "/device/content/asset/download", destination)

            assertFalse(ok)
            assertFalse("partial content must never remain at the destination", destination.exists())
        } finally {
            directory.deleteRecursively()
        }
    }
}
