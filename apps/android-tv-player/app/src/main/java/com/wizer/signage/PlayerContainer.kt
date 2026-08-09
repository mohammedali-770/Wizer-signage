package com.wizer.signage

import android.content.Context
import com.wizer.signage.data.AndroidReleaseClient
import com.wizer.signage.data.AndroidUpdateApiClient
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
import com.wizer.signage.update.AndroidUpdateController
import java.io.File

/**
 * Manual dependency container (no DI framework in the foundation). Wires the
 * pairing repository, offline cache/sync, monitoring, proof-of-play and the
 * fail-closed Android OTA controller.
 */
class PlayerContainer(context: Context) {

    private val appContext = context.applicationContext
    private val store = DeviceStore(appContext)
    private val api = ApiClient()

    val repository = PairingRepository(api, store)
    val isPaired: Boolean get() = repository.isPaired

    /** Soft-kiosk preference (default on). Read live by the kiosk controller. */
    val softKioskEnabled: Boolean get() = store.softKioskEnabled

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

    // Production OTA — public signed release transport + authenticated staged
    // rollout policy. The controller is started only while a device is paired.
    val updateController = AndroidUpdateController(
        context = appContext,
        store = store,
        control = AndroidUpdateApiClient(),
        releases = AndroidReleaseClient(),
    )

    // Phase 9 — proof-of-play (bounded offline buffer + best-effort flush).
    private val proofOfPlayQueue = ProofOfPlayQueue(File(cacheDir, "proof_of_play_queue.json"))
    val proofOfPlayReporter = ProofOfPlayReporter(
        tokenProvider = { store.deviceToken },
        send = { token, request -> api.reportProofOfPlay(token, request) },
        queue = proofOfPlayQueue,
    )
    val playbackEventTracker = PlaybackEventTracker()
}
