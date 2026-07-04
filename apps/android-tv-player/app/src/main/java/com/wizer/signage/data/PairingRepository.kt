package com.wizer.signage.data

import android.os.Build
import com.wizer.signage.BuildConfig
import com.wizer.signage.data.model.DeviceConfig
import com.wizer.signage.data.model.PairingStatusResponse
import com.wizer.signage.data.model.StartPairingRequest
import com.wizer.signage.data.model.StartPairingResponse

/**
 * Orchestrates the pairing flow + manifest access on top of {@link ApiClient}
 * and {@link DeviceStore}. The single source of truth for "am I paired".
 */
class PairingRepository(
    private val api: ApiClient,
    private val store: DeviceStore,
) {
    val isPaired: Boolean get() = store.isPaired
    val screenName: String? get() = store.screenName

    /** Begin pairing: mint a code + secret and remember them locally. */
    suspend fun startPairing(): StartPairingResponse {
        val resp = api.startPairing(
            StartPairingRequest(
                deviceId = store.deviceId,
                platform = "android-tv",
                modelName = "${Build.MANUFACTURER} ${Build.MODEL}",
                osVersion = "Android ${Build.VERSION.RELEASE}",
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
        store.pairingCode = resp.code
        store.pairingSecret = resp.pairingSecret
        return resp
    }

    /** Poll pairing status; on success, persist the device token + bound screen. */
    suspend fun pollStatus(): PairingStatusResponse? {
        val code = store.pairingCode ?: return null
        val secret = store.pairingSecret ?: return null
        val resp = api.pairingStatus(code, secret)
        if (resp.status == PairingStatusResponse.PAIRED && resp.deviceToken != null && resp.screenId != null) {
            store.savePairing(resp.deviceToken, resp.screenId, resp.screen?.name)
        }
        return resp
    }

    suspend fun fetchManifest(): ManifestResult =
        store.deviceToken?.let { api.getManifest(it) } ?: ManifestResult.Unauthorized

    suspend fun fetchConfig(): DeviceConfig? = store.deviceToken?.let { api.getConfig(it) }

    /** Forget the pairing (token revoked / unpaired by the dashboard). */
    fun unpair() = store.clearPairing()
}
