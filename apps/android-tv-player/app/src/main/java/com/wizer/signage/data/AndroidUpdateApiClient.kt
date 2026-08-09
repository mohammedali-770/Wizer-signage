package com.wizer.signage.data

import com.wizer.signage.BuildConfig
import com.wizer.signage.data.model.AndroidUpdatePolicy
import com.wizer.signage.data.model.AndroidUpdateResult
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Device-token authenticated control plane for staged OTA eligibility + telemetry. */
class AndroidUpdateApiClient(
    baseUrl: String = BuildConfig.API_BASE_URL,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    private val base = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = false; explicitNulls = false }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun getPolicy(token: String): AndroidUpdatePolicy? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/update/policy")
            .header("X-Device-Token", token)
            .get()
            .build()
        try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                json.decodeFromString<AndroidUpdatePolicy>(response.body?.string().orEmpty())
            }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun report(token: String, result: AndroidUpdateResult): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/update/result")
            .header("X-Device-Token", token)
            .post(json.encodeToString(result).toRequestBody(jsonMedia))
            .build()
        try {
            http.newCall(request).execute().use { it.isSuccessful }
        } catch (_: Exception) {
            false
        }
    }
}
