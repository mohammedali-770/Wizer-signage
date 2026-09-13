package com.wizer.signage

import com.wizer.signage.data.ApiClient
import java.nio.file.Files
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Caching an asset straight from object storage instead of proxying every byte
 * through the API.
 *
 * Two properties here are security properties, not optimisations, and both are
 * easy to lose in a refactor:
 *
 *  1. The pre-signed URL must be fetched with NO credentials. The device token
 *     authenticates every device endpoint -- manifest, heartbeat, commands,
 *     screenshots, OTA -- so leaking it to a third-party host is a full device
 *     compromise. A pre-signed URL needs no credential by construction.
 *
 *  2. Redirects must not be followed. OkHttp follows them by default and, on a
 *     cross-host hop, strips only the literal `Authorization` header -- a custom
 *     header like `X-Device-Token` would be carried along. Refusing redirects
 *     removes the class of accident instead of relying on header-name luck.
 */
class DirectAssetDownloadTest {
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

    private fun client(): ApiClient = ApiClient(server.url("/api").toString(), OkHttpClient())

    @Test
    fun `sends no device token to the storage host`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("PAYLOAD"))
        val dest = Files.createTempFile("direct", ".part").toFile()

        val ok = client().downloadFromUrl(server.url("/object/signed/abc").toString(), dest)

        assertTrue(ok)
        val recorded = server.takeRequest()
        assertNull(
            "the device token must never reach a pre-signed storage URL",
            recorded.getHeader("X-Device-Token"),
        )
        assertNull(recorded.getHeader("Authorization"))
        assertEquals("PAYLOAD", dest.readText())
        dest.delete()
    }

    @Test
    fun `does not follow a redirect`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .setHeader("Location", server.url("/somewhere-else").toString()),
        )
        val dest = Files.createTempFile("direct", ".part").toFile()

        val ok = client().downloadFromUrl(server.url("/object/signed/abc").toString(), dest)

        assertFalse("a redirect must not be followed", ok)
        assertEquals("exactly one request — the redirect was refused", 1, server.requestCount)
        assertFalse("no partial bytes may survive a refused download", dest.exists())
    }

    @Test
    fun `deletes the destination on an error response`() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody("<Error>expired</Error>"))
        val dest = Files.createTempFile("direct", ".part").toFile()

        val ok = client().downloadFromUrl(server.url("/object/signed/expired").toString(), dest)

        assertFalse(ok)
        assertFalse(
            "an expired signed URL must not leave an error body to be checksummed",
            dest.exists(),
        )
    }

    @Test
    fun `writes the body verbatim on success`() = runTest {
        // Larger than one copy buffer, so a truncating stream copy would show up.
        val payload = "x".repeat(64 * 1024)
        server.enqueue(MockResponse().setResponseCode(200).setBody(payload))
        val dest = Files.createTempFile("direct", ".part").toFile()

        val ok = client().downloadFromUrl(server.url("/object/signed/big").toString(), dest)

        assertTrue(ok)
        assertEquals(payload.length.toLong(), dest.length())
        assertEquals(payload, dest.readText())
        dest.delete()
    }
}
