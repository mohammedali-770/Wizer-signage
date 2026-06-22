package com.mastersignage.player.monitoring

import com.mastersignage.player.data.ApiClient
import com.mastersignage.player.data.DeviceStore
import com.mastersignage.player.data.SyncManager
import com.mastersignage.player.data.model.PendingCommand
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** The side-effects a remote command can trigger (interface → JVM-testable executor). */
interface CommandActions {
    fun forceSync()
    fun refreshManifest()
    fun restartPlayback()
    fun reloadConfig()
    fun clearCache(full: Boolean)
    fun unpair()
    suspend fun captureAndUploadScreenshot(commandId: String): Boolean
}

/** Wires the command actions to the real SyncManager / store / capture + upload. */
class DefaultCommandActions(
    private val sync: SyncManager,
    private val store: DeviceStore,
    private val api: ApiClient,
) : CommandActions {
    override fun forceSync() = sync.refreshNow()
    override fun refreshManifest() = sync.refreshNow()
    override fun restartPlayback() = sync.requestRestart()
    override fun reloadConfig() = sync.refreshNow() // config is fetched at the start of each sync
    override fun clearCache(full: Boolean) = sync.clearCache(full)
    override fun unpair() = store.clearPairing()

    override suspend fun captureAndUploadScreenshot(commandId: String): Boolean {
        val token = store.deviceToken ?: return false
        val jpeg = ScreenCaptureController.captureJpeg() ?: return false
        return api.uploadScreenshot(token, jpeg, commandId)
    }
}

/**
 * Maps a remote command to its action and reports an outcome (Phase 8). Pure
 * dispatch (no networking) so it is unit-testable with a fake [CommandActions].
 * Unsupported actions (e.g. REBOOT on normal Android TV) fail gracefully.
 */
class CommandExecutor(private val actions: CommandActions) {

    data class Outcome(val success: Boolean, val result: Map<String, String> = emptyMap(), val error: String? = null)

    suspend fun run(command: PendingCommand): Outcome = when (command.commandType) {
        "FORCE_SYNC" -> { actions.forceSync(); Outcome(true) }
        "REFRESH_MANIFEST" -> { actions.refreshManifest(); Outcome(true) }
        "RESTART_PLAYBACK" -> { actions.restartPlayback(); Outcome(true) }
        "RELOAD_CONFIG" -> { actions.reloadConfig(); Outcome(true) }
        "CLEAR_CACHE" -> {
            val full = (command.payload?.get("full") as? JsonPrimitive)?.booleanOrNull ?: false
            actions.clearCache(full)
            Outcome(true, mapOf("full" to full.toString()))
        }
        "TAKE_SCREENSHOT" ->
            if (actions.captureAndUploadScreenshot(command.id)) Outcome(true)
            else Outcome(false, error = "Screenshot capture is not supported on this device.")
        "UNPAIR_DEVICE" -> { actions.unpair(); Outcome(true) }
        "REBOOT_DEVICE" -> Outcome(false, error = "Reboot is not supported on this device.")
        else -> Outcome(false, error = "Unknown command: ${command.commandType}")
    }
}
