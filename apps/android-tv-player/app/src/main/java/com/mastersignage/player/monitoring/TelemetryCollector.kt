package com.mastersignage.player.monitoring

import android.os.Build
import android.os.SystemClock
import com.mastersignage.player.BuildConfig
import com.mastersignage.player.data.ConnectivityObserver
import com.mastersignage.player.data.SyncManager
import com.mastersignage.player.data.model.HeartbeatPayload

/**
 * Builds the heartbeat telemetry payload from current player + cache state
 * (Phase 8). Does NOT report sync status (that is owned by the Phase 7
 * sync-status snapshot, to avoid clobbering it with a guess).
 */
class TelemetryCollector(
    private val sync: SyncManager,
    private val connectivity: ConnectivityObserver,
) {
    fun collect(): HeartbeatPayload {
        val online = connectivity.isOnline()
        val manifest = sync.activeManifest.value
        val item = sync.currentItem.value
        val (cacheSize, available, cachedCount) = sync.cacheStats()

        return HeartbeatPayload(
            appVersion = BuildConfig.VERSION_NAME,
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}",
            osVersion = "Android ${Build.VERSION.RELEASE}",
            platform = "android-tv",
            uptimeSeconds = (SystemClock.elapsedRealtime() / 1000).toInt(),
            playbackState = derivePlaybackState(manifest?.items?.isNotEmpty() == true, sync.manifestSource.value),
            currentContentId = item?.contentId,
            currentPlaylistId = manifest?.playlistId,
            currentScheduleId = manifest?.scheduleId,
            manifestVersion = manifest?.generatedAt,
            networkStatus = if (online) "ONLINE" else "OFFLINE",
            cacheSizeBytes = cacheSize,
            availableStorageBytes = available,
            cachedAssets = cachedCount,
            capabilities = mapOf(
                "screenshot" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O),
                "reboot" to false,
                "powerControl" to false,
                "kiosk" to false,
                "autoStart" to false,
            ),
        )
    }

    companion object {
        /** Pure: IDLE when nothing playing, OFFLINE_PLAYBACK from cache, else PLAYING. */
        fun derivePlaybackState(hasItems: Boolean, manifestSource: String): String = when {
            !hasItems -> "IDLE"
            manifestSource == SyncManager.SOURCE_LOCAL -> "OFFLINE_PLAYBACK"
            else -> "PLAYING"
        }
    }
}
