package com.wizer.signage.proofofplay

import com.wizer.signage.data.model.ProofOfPlayEvent
import com.wizer.signage.data.model.ReportProofOfPlayRequest
import com.wizer.signage.util.Jitter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.coroutineContext

/**
 * Buffers proof-of-play events and flushes them to the backend (Phase 9).
 *
 * Contract: [report] is non-blocking and never throws — playback must never be
 * affected by reporting. Events are enqueued locally (survives offline) and a
 * best-effort flush is kicked off; a periodic loop also drains the queue. The
 * flush is guarded by a mutex so the periodic loop and report-triggered flush
 * can never double-send (and thus never double-drop) a batch.
 */
class ProofOfPlayReporter(
    private val tokenProvider: () -> String?,
    private val send: suspend (String, ReportProofOfPlayRequest) -> Boolean,
    private val queue: ProofOfPlayQueue,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val flushMutex = Mutex()
    private var loop: Job? = null

    /** Enqueue an event and trigger an opportunistic flush. Fast + exception-safe. */
    fun report(event: ProofOfPlayEvent) {
        try {
            queue.add(event)
        } catch (e: Exception) {
            return // never propagate to the player
        }
        scope.launch { runCatching { flush() } }
    }

    /** Enqueue several events (e.g. an interrupted-then-started pair). */
    fun report(events: List<ProofOfPlayEvent>) {
        for (e in events) report(e)
    }

    fun start() {
        loop?.cancel()
        loop = scope.launch {
            // Staggered + jittered: proof-of-play batches from a whole site would
            // otherwise land on the API in one 30s-periodic spike forever.
            delay(Jitter.startupDelay())
            while (coroutineContext.isActive) {
                runCatching { flush() }
                delay(Jitter.periodic(FLUSH_INTERVAL_MS))
            }
        }
    }

    fun stop() {
        loop?.cancel()
    }

    /** Drain the queue in batches while online; stops on the first failed batch. */
    suspend fun flush() {
        val token = tokenProvider() ?: return
        flushMutex.withLock {
            while (true) {
                val batch = queue.peek(BATCH_SIZE)
                if (batch.isEmpty()) return
                val ok = try {
                    send(token, ReportProofOfPlayRequest(batch))
                } catch (e: Exception) {
                    false
                }
                if (!ok) return // keep events buffered; retry on the next tick
                queue.removeFirst(batch.size)
            }
        }
    }

    companion object {
        const val BATCH_SIZE = 100
        const val FLUSH_INTERVAL_MS = 30_000L
    }
}
