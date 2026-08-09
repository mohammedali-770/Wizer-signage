package com.wizer.signage.monitoring

import android.os.Build
import android.os.SystemClock
import com.wizer.signage.BuildConfig
import com.wizer.signage.data.ConnectivityObserver
import com.wizer.signage.data.SyncManager
import com.wizer.signage.data.model.HeartbeatPayload

/**
 * Builds the heartbeat telemetry payload from current player + cache state
 * (Phase 8). Does NOT report sync status (that is owned by the Phase 7
 * sync-status snapshot, to avoid clobbering it with a guess).
 *
 * Previous-run crash metadata is privacy-bounded by [CrashTelemetryStore]: only
 * timestamp/fingerprint/count are emitted, never the persisted stack trace.
 */
class TelemetryCollector(
    private val sync: SyncManager,
    private val connectivity: ConnectivityObserver,
    private val crashes: CrashTelemetryStore,
) {
    fun collect(): HeartbeatPayload {
        val online = connectivity.isOnline()
        val manifest = sync.activeManifest.value
        val item = sync.currentItem.value
        val (cacheSize, available, cachedCount) = sync.cacheStats()
        val crash = crashes.snapshot()

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
            manifestVersion = manifest?.syncVersion,
            networkStatus = if (online) "ONLINE" else "OFFLINE",
            cacheSizeBytes = cacheSize,
            availableStorageBytes = available,
            cachedAssets = cachedCount,
            lastCrashAtMillis = crash.lastCrashAtMillis,
            lastCrashFingerprint = crash.lastCrashFingerprint,
            crashCount = crash.crashCount,
            capabilities = mapOf(
                "screenshot" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O),
                "reboot" to false,
                "powerControl" to false,
                "kiosk" to false,
                "autoStart" to false,
            ),
        )
    }

    /** Clear the previous-run crash only after the server accepted a heartbeat. */
    fun acknowledgeCrashIfPending() {
        crashes.acknowledgeIfPending()
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