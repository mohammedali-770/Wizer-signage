package com.wizer.signage.data

import com.wizer.signage.BuildConfig
import com.wizer.signage.data.model.DeviceConfig
import com.wizer.signage.data.model.PairingStatusResponse
import com.wizer.signage.data.model.PlaybackManifest
import com.wizer.signage.data.model.StartPairingRequest
import com.wizer.signage.data.model.StartPairingResponse
import com.wizer.signage.data.model.CommandResultPayload
import com.wizer.signage.data.model.HeartbeatPayload
import com.wizer.signage.data.model.PendingCommandsResponse
import com.wizer.signage.data.model.ReportProofOfPlayRequest
import com.wizer.signage.data.model.SyncPlan
import com.wizer.signage.data.model.SyncStatusReport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

/** Result of a device-token manifest fetch (distinguishes a revoked token). */
sealed interface ManifestResult {
    data class Success(val manifest: PlaybackManifest) : ManifestResult
    object Unauthorized : ManifestResult
    data class Error(val message: String) : ManifestResult
}

class ApiException(message: String) : Exception(message)

/**
 * Thin HTTP client for the device-facing API (OkHttp + kotlinx.serialization).
 * Calls run on the IO dispatcher. The base URL comes from BuildConfig.API_BASE_URL.
 *
 * [http] is injectable only so JVM tests can exercise timeout/truncation paths
 * without waiting for the production 10s/20s network deadlines. Normal callers
 * use the exact same production defaults as before.
 */
class ApiClient(
    baseUrl: String = BuildConfig.API_BASE_URL,
    private val http: OkHttpClient = defaultHttpClient(),
) {

    private val base = baseUrl.trimEnd('/')
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        isLenient = true
    }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun startPairing(req: StartPairingRequest): StartPairingResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/pairing/start")
            .post(json.encodeToString(req).toRequestBody(jsonMedia))
            .build()
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw ApiException("pairing/start HTTP ${resp.code}")
            json.decodeFromString<StartPairingResponse>(text)
        }
    }

    suspend fun pairingStatus(code: String, secret: String): PairingStatusResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/pairing/status?code=$code")
            .header("X-Pairing-Secret", secret)
            .get()
            .build()
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (resp.code == 401) throw ApiException("unauthorized")
            if (!resp.isSuccessful) throw ApiException("pairing/status HTTP ${resp.code}")
            json.decodeFromString<PairingStatusResponse>(text)
        }
    }

    suspend fun getManifest(token: String): ManifestResult = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/manifest")
            .header("X-Device-Token", token)
            .get()
            .build()
        try {
            http.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                when {
                    resp.code == 401 -> ManifestResult.Unauthorized
                    resp.isSuccessful -> ManifestResult.Success(json.decodeFromString<PlaybackManifest>(text))
                    else -> ManifestResult.Error("HTTP ${resp.code}")
                }
            }
        } catch (e: Exception) {
            ManifestResult.Error(e.message ?: "network error")
        }
    }

    suspend fun getConfig(token: String): DeviceConfig? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/config")
            .header("X-Device-Token", token)
            .get()
            .build()
        try {
            http.newCall(request).execute().use { resp ->
                if (resp.isSuccessful) json.decodeFromString<DeviceConfig>(resp.body?.string().orEmpty()) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    suspend fun getSyncPlan(token: String): SyncPlan? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/sync-plan")
            .header("X-Device-Token", token)
            .get()
            .build()
        try {
            http.newCall(request).execute().use { resp ->
                if (resp.isSuccessful) json.decodeFromString<SyncPlan>(resp.body?.string().orEmpty()) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    suspend fun reportSyncStatus(token: String, report: SyncStatusReport): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/sync-status")
            .header("X-Device-Token", token)
            .post(json.encodeToString(report).toRequestBody(jsonMedia))
            .build()
        try {
            http.newCall(request).execute().use { resp -> resp.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Download an entitled content file (relative `downloadPath`, e.g.
     * `/device/content/{id}/download`) to [dest]. Streams the body; returns true
     * on success. Any unsuccessful response, missing/truncated body, or network/
     * filesystem exception removes [dest] so stale/partial bytes can never be
     * mistaken for the result of the current attempt. The caller still verifies
     * expected size/checksum before committing the file to cache.
     */
    suspend fun downloadToFile(token: String, downloadPath: String, dest: File): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base$downloadPath")
            .header("X-Device-Token", token)
            .get()
            .build()
        try {
            http.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    dest.delete()
                    return@withContext false
                }
                val body = resp.body
                if (body == null) {
                    dest.delete()
                    return@withContext false
                }
                body.byteStream().use { input -> dest.outputStream().use { output -> input.copyTo(output) } }
                true
            }
        } catch (e: Exception) {
            dest.delete()
            false
        }
    }

    // --- Phase 8 monitoring ------------------------------------------------

    suspend fun sendHeartbeat(token: String, payload: HeartbeatPayload): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/heartbeat")
            .header("X-Device-Token", token)
            .post(json.encodeToString(payload).toRequestBody(jsonMedia))
            .build()
        try {
            http.newCall(request).execute().use { resp -> resp.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun sendEvent(token: String, eventType: String, payloadJson: String? = null): Boolean = withContext(Dispatchers.IO) {
        val body = buildString {
            append("{\"eventType\":")
            append(json.encodeToString(eventType))
            if (payloadJson != null) append(",\"payload\":$payloadJson")
            append('}')
        }.toRequestBody(jsonMedia)
        val request = Request.Builder()
            .url("$base/device/events")
            .header("X-Device-Token", token)
            .post(body)
            .build()
        try {
            http.newCall(request).execute().use { resp -> resp.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun getPendingCommands(token: String): PendingCommandsResponse? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/commands/pending")
            .header("X-Device-Token", token)
            .get()
            .build()
        try {
            http.newCall(request).execute().use { resp ->
                if (resp.isSuccessful) json.decodeFromString<PendingCommandsResponse>(resp.body?.string().orEmpty()) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    suspend fun ackCommand(token: String, commandId: String): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/commands/$commandId/ack")
            .header("X-Device-Token", token)
            .post(ByteArray(0).toRequestBody())
            .build()
        try {
            http.newCall(request).execute().use { resp -> resp.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun reportCommandResult(token: String, commandId: String, payload: CommandResultPayload): Boolean =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$base/device/commands/$commandId/result")
                .header("X-Device-Token", token)
                .post(json.encodeToString(payload).toRequestBody(jsonMedia))
                .build()
            try {
                http.newCall(request).execute().use { resp -> resp.isSuccessful }
            } catch (e: Exception) {
                false
            }
        }

    // --- Phase 9 proof-of-play ---------------------------------------------

    suspend fun reportProofOfPlay(token: String, request: ReportProofOfPlayRequest): Boolean = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("$base/device/proof-of-play/events")
            .header("X-Device-Token", token)
            .post(json.encodeToString(request).toRequestBody(jsonMedia))
            .build()
        try {
            http.newCall(req).execute().use { resp -> resp.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun uploadScreenshot(token: String, jpeg: ByteArray, commandId: String?): Boolean = withContext(Dispatchers.IO) {
        val bodyBuilder = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", "screenshot.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .addFormDataPart("type", if (commandId != null) "MANUAL" else "AUTO")
        if (commandId != null) bodyBuilder.addFormDataPart("commandId", commandId)
        val request = Request.Builder()
            .url("$base/device/screenshots")
            .header("X-Device-Token", token)
            .post(bodyBuilder.build())
            .build()
        try {
            http.newCall(request).execute().use { resp -> resp.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        private fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }
}
