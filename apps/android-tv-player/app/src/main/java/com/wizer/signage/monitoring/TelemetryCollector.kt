package com.wizer.signage.monitoring

import android.os.Build
import android.os.SystemClock
import com.wizer.signage.BuildConfig
import com.wizer.signage.data.ConnectivityObserver
import com.wizer.signage.data.SyncManager
import com.wizer.signage.data.model.CrashReportPayload
import com.wizer.signage.data.model.HeartbeatPayload

/**
 * Builds the ordinary heartbeat telemetry payload from current player + cache
 * state (Phase 8). Previous-run crash metadata uses a separate authenticated
 * report so a recovered crash does not masquerade as a playback/sync warning.
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
            capabilities = mapOf(
                "screenshot" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O),
                "reboot" to false,
                "powerControl" to false,
                "kiosk" to false,
                "autoStart" to false,
            ),
        )
    }

    fun pendingCrashReport(): CrashReportPayload? {
        val crash = crashes.snapshot()
        val fingerprint = crash.lastCrashFingerprint ?: return null
        val at = crash.lastCrashAtMillis ?: return null
        return CrashReportPayload(
            crashedAtMillis = at,
            fingerprint = fingerprint,
            crashCount = crash.crashCount.coerceAtLeast(1),
            appVersion = BuildConfig.VERSION_NAME,
        )
    }

    /** Clear the previous-run crash only after the dedicated report is accepted. */
    fun acknowledgeCrashReport() {
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