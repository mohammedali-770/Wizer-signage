package com.wizer.signage.data

import com.wizer.signage.BuildConfig
import com.wizer.signage.data.model.CrashReportPayload
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Authenticated, best-effort upload of privacy-bounded previous-run crash metadata. */
class CrashReportClient(
    baseUrl: String = BuildConfig.API_BASE_URL,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    private val base = baseUrl.trimEnd('/')
    private val json = Json { explicitNulls = false }
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun report(token: String, payload: CrashReportPayload): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$base/device/crash-report")
            .header("X-Device-Token", token)
            .post(json.encodeToString(payload).toRequestBody(mediaType))
            .build()
        try {
            http.newCall(request).execute().use { it.isSuccessful }
        } catch (_: Exception) {
            false
        }
    }
}
