package com.mastersignage.player.monitoring

import com.mastersignage.player.data.ApiClient
import com.mastersignage.player.data.DeviceStore
import com.mastersignage.player.data.model.CommandResultPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlin.coroutines.coroutineContext

/**
 * Phase 8 orchestrator: a heartbeat loop and a command-poll loop. Failures never
 * crash playback — offline playback (Phase 7) continues regardless. The intervals
 * come from device config (defaults 60s heartbeat / 12s poll).
 */
class MonitoringController(
    private val api: ApiClient,
    private val store: DeviceStore,
    private val telemetry: TelemetryCollector,
    private val executor: CommandExecutor,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private var heartbeatJob: Job? = null
    private var pollJob: Job? = null
    private var heartbeatMs = 60_000L
    private var pollMs = 12_000L

    fun start() {
        stop()
        scope.launch { loadIntervals() }
        heartbeatJob = scope.launch { heartbeatLoop() }
        pollJob = scope.launch { pollLoop() }
    }

    fun stop() {
        heartbeatJob?.cancel()
        pollJob?.cancel()
    }

    private suspend fun loadIntervals() {
        val token = store.deviceToken ?: return
        api.getConfig(token)?.let {
            heartbeatMs = it.heartbeatIntervalSeconds.coerceAtLeast(15).toLong() * 1000L
            pollMs = it.commandPollIntervalSeconds.coerceAtLeast(5).toLong() * 1000L
        }
    }

    private suspend fun heartbeatLoop() {
        while (coroutineContext.isActive) {
            store.deviceToken?.let { token ->
                try {
                    api.sendHeartbeat(token, telemetry.collect())
                } catch (e: Exception) {
                    // Heartbeat is best-effort; never break playback.
                }
            }
            delay(heartbeatMs)
        }
    }

    private suspend fun pollLoop() {
        while (coroutineContext.isActive) {
            val token = store.deviceToken
            if (token != null) {
                try {
                    val pending = api.getPendingCommands(token)?.commands ?: emptyList()
                    for (command in pending) {
                        api.ackCommand(token, command.id)
                        val outcome = try {
                            executor.run(command)
                        } catch (e: Exception) {
                            CommandExecutor.Outcome(false, error = e.message ?: "execution error")
                        }
                        // Retry the result report so a transient network blip doesn't
                        // leave the command stuck in RUNNING on the backend.
                        val payload = CommandResultPayload(
                            status = if (outcome.success) "SUCCEEDED" else "FAILED",
                            result = outcome.result.toJsonObject(),
                            error = outcome.error,
                        )
                        var reported = false
                        var backoff = 1_000L
                        var attempt = 0
                        while (!reported && attempt < 3) {
                            reported = api.reportCommandResult(token, command.id, payload)
                            attempt++
                            if (!reported && attempt < 3) {
                                delay(backoff)
                                backoff *= 2
                            }
                        }
                    }
                } catch (e: Exception) {
                    // Polling is best-effort.
                }
            }
            delay(pollMs)
        }
    }

    private fun Map<String, String>.toJsonObject(): JsonObject? =
        if (isEmpty()) null else JsonObject(mapValues { JsonPrimitive(it.value) })
}
