package com.wizer.signage.data

import com.wizer.signage.data.cache.AssetDownloader
import com.wizer.signage.data.cache.CacheManager
import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import com.wizer.signage.data.model.SyncStatusReport
import com.wizer.signage.util.Jitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import kotlin.coroutines.coroutineContext

/**
 * The Phase 7 offline-cache / smart-sync engine. Drives: fetch config + manifest
 * + sync plan, download missing assets (current manifest first), keep an
 * offline-safe last-good manifest, prune unreferenced assets, and report status.
 *
 * Behaviour:
 *  - Online: show the freshest manifest (streams uncached items via signed URL);
 *    download plan assets; advance the offline-safe last-good only once all the
 *    manifest's file assets are cached; never delete cache referenced by the
 *    current/last-good/plan sets.
 *  - Offline: fall back to the last-good manifest + cached files; never blank the
 *    screen if cached content exists.
 *  - 401: clear pairing and signal re-pair.
 */
class SyncManager(
    private val api: ApiClient,
    private val store: DeviceStore,
    private val manifestStore: ManifestStore,
    private val cache: CacheManager,
    private val downloader: AssetDownloader,
    private val connectivity: ConnectivityObserver,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _activeManifest = MutableStateFlow(manifestStore.loadLastGood())
    val activeManifest: StateFlow<PlaybackManifest?> = _activeManifest.asStateFlow()

    private val _manifestSource = MutableStateFlow(if (_activeManifest.value != null) SOURCE_LOCAL else SOURCE_NONE)
    val manifestSource: StateFlow<String> = _manifestSource.asStateFlow()

    private val _online = MutableStateFlow(true)
    val online: StateFlow<Boolean> = _online.asStateFlow()

    private val _unauthorized = MutableStateFlow(false)
    val unauthorized: StateFlow<Boolean> = _unauthorized.asStateFlow()

    private val _restartEpoch = MutableStateFlow(0)
    /** Bumped to ask the player to restart its loop from the first item (Phase 8 RESTART_PLAYBACK). */
    val restartEpoch: StateFlow<Int> = _restartEpoch.asStateFlow()

    private val _currentItem = MutableStateFlow<ManifestItem?>(null)
    /** The item currently on screen (reported by the player, used in telemetry). */
    val currentItem: StateFlow<ManifestItem?> = _currentItem.asStateFlow()

    fun reportCurrentItem(item: ManifestItem?) {
        _currentItem.value = item
    }

    private var loop: Job? = null
    private var refreshMs = 60_000L
    private var everStarted = false

    fun start() {
        loop?.cancel()
        // Stagger only the very first cycle after boot: a site-wide power cut
        // otherwise has every screen asking for its manifest in the same second.
        // A manual refreshNow() must stay immediate.
        val stagger = !everStarted
        everStarted = true
        loop = scope.launch { run(stagger) }
    }

    fun stop() {
        loop?.cancel()
    }

    /**
     * Trigger an IMMEDIATE sync cycle, bypassing the periodic refresh delay
     * (~60s). Cancels the running loop and relaunches it now, so it re-fetches
     * the manifest and re-syncs right away. Invoked by the remote commands
     * FORCE_SYNC / REFRESH_MANIFEST / RELOAD_CONFIG (Req 3) — the command poll
     * runs every ~12s, so a dashboard "Force sync" takes effect within seconds.
     */
    fun refreshNow() = start()

    /** Ask the player to restart playback from the beginning. */
    fun requestRestart() {
        _restartEpoch.value = _restartEpoch.value + 1
    }

    /**
     * Clear non-critical cache safely (Phase 8 CLEAR_CACHE). Keeps the current
     * manifest + last-good assets so the currently-playing file is never removed;
     * `full` additionally drops last-good (re-downloaded on the next sync). Then
     * triggers a sync to re-fill.
     */
    fun clearCache(full: Boolean) {
        val current = _activeManifest.value?.items?.map { it.contentId to it.version } ?: emptyList()
        if (full) {
            // Drop the last-good manifest too, so offline never references deleted assets.
            manifestStore.clearLastGood()
            cache.cleanup(current.toSet())
        } else {
            val lastGood = manifestStore.loadLastGood()?.items?.map { it.contentId to it.version } ?: emptyList()
            cache.cleanup((current + lastGood).toSet())
        }
        refreshNow()
    }

    /** Cache summary for telemetry/heartbeat. */
    fun cacheStats(): Triple<Long, Long, Int> = Triple(cache.totalSizeBytes(), cache.availableStorageBytes(), cache.cachedCount())

    /** Ready local file for a manifest item (by content id + version), or null. */
    fun localFile(item: ManifestItem): File? {
        val file = cache.readyFile(item.contentId, item.version)
        if (file != null) cache.touch(item.contentId, item.version)
        return file
    }

    private suspend fun run(stagger: Boolean) {
        if (stagger) delay(Jitter.startupDelay())
        while (coroutineContext.isActive) {
            val token = store.deviceToken
            if (token == null) {
                _unauthorized.value = true
                return
            }
            val isOnline = connectivity.isOnline()
            _online.value = isOnline
            if (isOnline) {
                try {
                    syncOnce(token)
                } catch (e: Exception) {
                    if (_activeManifest.value == null) fallToCache()
                }
            } else {
                fallToCache()
                report(
                    token,
                    SyncStatusReport(
                        status = "OFFLINE_PLAYBACK",
                        manifestSource = if (_activeManifest.value != null) SOURCE_LOCAL else null,
                        cachedAssets = cache.cachedCount(),
                        cacheSizeBytes = cache.totalSizeBytes(),
                        availableStorageBytes = cache.availableStorageBytes(),
                    ),
                )
            }
            delay(Jitter.periodic(refreshMs))
        }
    }

    private fun fallToCache() {
        val lastGood = manifestStore.loadLastGood()
        if (lastGood != null) {
            _activeManifest.value = lastGood
            _manifestSource.value = SOURCE_LOCAL
        } else {
            _manifestSource.value = if (_activeManifest.value != null) SOURCE_LOCAL else SOURCE_NONE
        }
    }

    private suspend fun syncOnce(token: String) {
        api.getConfig(token)?.let {
            refreshMs = it.manifestRefreshIntervalSeconds.coerceAtLeast(15).toLong() * 1000L
        }

        when (val result = api.getManifest(token)) {
            is ManifestResult.Unauthorized -> {
                store.clearPairing()
                _unauthorized.value = true
                return
            }
            is ManifestResult.Error -> {
                // Keep whatever is already showing; fall back to last-good only if blank.
                if (_activeManifest.value == null) fallToCache()
                return
            }
            is ManifestResult.Success -> {
                val manifest = result.manifest
                // Show the freshest manifest now; uncached file items stream via signed URL while online.
                _activeManifest.value = manifest
                _manifestSource.value = SOURCE_REMOTE

                val planItems = api.getSyncPlan(token)?.items?.filter { it.isFile } ?: emptyList()
                val currentIds = manifest.items.mapNotNull { if (it.downloadPath != null) it.contentId else null }.toSet()
                // Current manifest assets first, then upcoming/fallback.
                val ordered = planItems.sortedByDescending { it.contentId in currentIds }

                val failed = mutableListOf<String>()
                for (item in ordered) {
                    if (cache.isReady(item.contentId, item.version)) continue
                    if (!downloader.download(token, item)) failed.add(item.contentId)
                }

                // Advance the offline-safe last-good only when all manifest file assets are cached.
                val manifestReady = manifest.items
                    .filter { it.downloadPath != null }
                    .all { cache.isReady(it.contentId, it.version) }
                if (manifestReady) manifestStore.saveLastGood(manifest)

                // Cleanup: keep current manifest + plan + last-good assets (by content+version);
                // prune the rest. Superseded versions survive until last-good no longer needs them.
                val keep = (
                    manifest.items.map { it.contentId to it.version } +
                        planItems.map { it.contentId to it.version } +
                        (manifestStore.loadLastGood()?.items?.map { it.contentId to it.version } ?: emptyList())
                    ).toSet()
                cache.cleanup(keep)

                val status = when {
                    failed.isEmpty() && manifestReady -> "READY"
                    cache.cachedCount() > 0 -> "PARTIAL"
                    else -> "FAILED"
                }
                report(
                    token,
                    SyncStatusReport(
                        status = status,
                        manifestSource = SOURCE_REMOTE,
                        // Report the stable content hash (Req 6) so the dashboard
                        // can show whether this screen is in sync.
                        manifestVersion = manifest.syncVersion,
                        requiredAssets = ordered.size,
                        cachedAssets = cache.cachedCount(),
                        failedDownloads = failed.size,
                        cacheSizeBytes = cache.totalSizeBytes(),
                        availableStorageBytes = cache.availableStorageBytes(),
                        failedAssetIds = if (failed.isEmpty()) null else failed,
                    ),
                )
            }
        }
    }

    private suspend fun report(token: String, report: SyncStatusReport) {
        try {
            api.reportSyncStatus(token, report)
        } catch (e: Exception) {
            // Status reporting is best-effort.
        }
    }

    companion object {
        const val SOURCE_REMOTE = "REMOTE"
        const val SOURCE_LOCAL = "LOCAL_CACHE"
        const val SOURCE_NONE = "NONE"
    }
}
