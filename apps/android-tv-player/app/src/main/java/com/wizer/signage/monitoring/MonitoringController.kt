package com.wizer.signage.monitoring

import com.wizer.signage.data.ApiClient
import com.wizer.signage.data.DeviceStore
import com.wizer.signage.data.model.CommandResultPayload
import com.wizer.signage.util.Jitter
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
        // Independent stagger per loop so a fleet coming back from a power cut
        // spreads its heartbeats instead of arriving as one spike.
        delay(Jitter.startupDelay())
        while (coroutineContext.isActive) {
            store.deviceToken?.let { token ->
                try {
                    val accepted = api.sendHeartbeat(token, telemetry.collect())
                    // Previous-run crash evidence is retained locally across
                    // restarts/network failures until the server has accepted a
                    // heartbeat containing it. Never clear on a failed send.
                    if (accepted) telemetry.acknowledgeCrashIfPending()
                } catch (e: Exception) {
                    // Heartbeat is best-effort; never break playback.
                }
            }
            delay(Jitter.periodic(heartbeatMs))
        }
    }

    private suspend fun pollLoop() {
        delay(Jitter.startupDelay())
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
                        var attempt = 0
                        while (!reported && attempt < 3) {
                            reported = api.reportCommandResult(token, command.id, payload)
                            attempt++
                            // Full jitter: every screen that got the same broadcast
                            // command would otherwise retry in lockstep.
                            if (!reported && attempt < 3) delay(Jitter.backoff(attempt - 1, 1_000L))
                        }
                    }
                } catch (e: Exception) {
                    // Polling is best-effort.
                }
            }
            delay(Jitter.periodic(pollMs))
        }
    }

    private fun Map<String, String>.toJsonObject(): JsonObject? =
        if (isEmpty()) null else JsonObject(mapValues { JsonPrimitive(it.value) })
}