package com.wizer.signage

import android.content.Context
import com.wizer.signage.data.ApiClient
import com.wizer.signage.data.ConnectivityObserver
import com.wizer.signage.data.DeviceStore
import com.wizer.signage.data.ManifestStore
import com.wizer.signage.data.PairingRepository
import com.wizer.signage.data.SyncManager
import com.wizer.signage.data.cache.AssetDownloader
import com.wizer.signage.data.cache.CacheManager
import com.wizer.signage.monitoring.CommandExecutor
import com.wizer.signage.monitoring.DefaultCommandActions
import com.wizer.signage.monitoring.MonitoringController
import com.wizer.signage.monitoring.TelemetryCollector
import com.wizer.signage.proofofplay.PlaybackEventTracker
import com.wizer.signage.proofofplay.ProofOfPlayQueue
import com.wizer.signage.proofofplay.ProofOfPlayReporter
import java.io.File

/**
 * Manual dependency container (no DI framework in the foundation). Wires the
 * pairing repository (Phase 6) and the offline-cache / smart-sync engine (Phase 7).
 */
class PlayerContainer(context: Context) {

    private val appContext = context.applicationContext
    private val store = DeviceStore(appContext)
    private val api = ApiClient()

    val repository = PairingRepository(api, store)
    val isPaired: Boolean get() = repository.isPaired

    // Phase 7 — offline cache + smart sync.
    private val cacheDir = File(appContext.filesDir, "ms_cache").apply { mkdirs() }
    private val cache = CacheManager(cacheDir)
    private val manifestStore = ManifestStore(cacheDir)
    private val downloader = AssetDownloader(api, cache)
    private val connectivity = ConnectivityObserver(appContext)

    val syncManager = SyncManager(api, store, manifestStore, cache, downloader, connectivity)

    // Phase 8 — heartbeat + remote commands.
    private val telemetry = TelemetryCollector(syncManager, connectivity)
    private val commandExecutor = CommandExecutor(DefaultCommandActions(syncManager, store, api))
    val monitoringController = MonitoringController(api, store, telemetry, commandExecutor)

    // Phase 9 — proof-of-play (bounded offline buffer + best-effort flush).
    private val proofOfPlayQueue = ProofOfPlayQueue(File(cacheDir, "proof_of_play_queue.json"))
    val proofOfPlayReporter = ProofOfPlayReporter(
        tokenProvider = { store.deviceToken },
        send = { token, request -> api.reportProofOfPlay(token, request) },
        queue = proofOfPlayQueue,
    )
    val playbackEventTracker = PlaybackEventTracker()
}
