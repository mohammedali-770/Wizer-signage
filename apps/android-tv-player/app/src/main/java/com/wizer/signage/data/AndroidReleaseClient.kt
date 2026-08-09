package com.wizer.signage.data

import com.wizer.signage.BuildConfig
import com.wizer.signage.data.model.AndroidRelease
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Public release-channel client. It deliberately carries no device token: the
 * release metadata/APK are public distribution artifacts, while rollout
 * eligibility remains a separate authenticated server decision.
 */
class AndroidReleaseClient(
    apiBaseUrl: String = BuildConfig.API_BASE_URL,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    private val apiBase = apiBaseUrl.trimEnd('/')
    private val apiUrl = apiBase.toHttpUrl()
    private val origin = apiUrl.newBuilder().encodedPath("/").query(null).fragment(null).build()
    private val json = Json { ignoreUnknownKeys = false; explicitNulls = false }

    suspend fun fetchLatest(): AndroidRelease? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$apiBase/downloads/android/latest.json")
            .get()
            .build()
        try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                json.decodeFromString<AndroidRelease>(body)
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Streams the immutable APK to [destination] and verifies size + SHA-256
     * before returning it. Any mismatch deletes the staged bytes.
     */
    suspend fun downloadVerified(release: AndroidRelease, destination: File): Boolean = withContext(Dispatchers.IO) {
        val resolved = origin.resolve(release.downloadUrl) ?: return@withContext false
        if (resolved.scheme != origin.scheme || resolved.host != origin.host || resolved.port != origin.port) {
            return@withContext false
        }
        if (!resolved.encodedPath.startsWith("/api/downloads/android/")) return@withContext false

        val tmp = File(destination.parentFile, "${destination.name}.part")
        tmp.delete()
        val request = Request.Builder().url(resolved).get().build()
        try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext false
                val body = response.body ?: return@withContext false
                body.byteStream().use { input -> tmp.outputStream().use { output -> input.copyTo(output) } }
            }
            if (tmp.length() != release.sizeBytes) {
                tmp.delete()
                return@withContext false
            }
            val actual = sha256(tmp)
            if (!actual.equals(release.sha256, ignoreCase = true)) {
                tmp.delete()
                return@withContext false
            }
            destination.delete()
            if (!tmp.renameTo(destination)) {
                tmp.delete()
                return@withContext false
            }
            true
        } catch (_: Exception) {
            tmp.delete()
            false
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
