package com.wizer.signage.proofofplay

import com.wizer.signage.data.model.ProofOfPlayEvent
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File

/**
 * A bounded, file-backed FIFO buffer of proof-of-play events (Phase 9). Events
 * are buffered locally so an offline device loses nothing; they flush when it
 * reconnects. Bounded so storage can never grow without limit — when full, the
 * OLDEST events are dropped (recent playback is the most valuable). File-injectable
 * (no Android Context) so it is JVM-unit-testable.
 */
class ProofOfPlayQueue(private val file: File, private val maxEvents: Int = 1000) {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val serializer = ListSerializer(ProofOfPlayEvent.serializer())
    private val lock = Any()
    private val buffer = ArrayDeque<ProofOfPlayEvent>()

    init {
        load()
    }

    fun add(event: ProofOfPlayEvent) {
        synchronized(lock) {
            buffer.addLast(event)
            while (buffer.size > maxEvents) buffer.removeFirst() // drop oldest
            persist()
        }
    }

    /** The first [max] events (FIFO), without removing them. */
    fun peek(max: Int): List<ProofOfPlayEvent> = synchronized(lock) {
        if (buffer.isEmpty()) emptyList() else buffer.take(max)
    }

    /** Remove the first [count] events after a successful send. */
    fun removeFirst(count: Int) {
        synchronized(lock) {
            repeat(count.coerceAtMost(buffer.size)) { buffer.removeFirst() }
            persist()
        }
    }

    fun size(): Int = synchronized(lock) { buffer.size }

    private fun load() {
        try {
            if (file.exists()) {
                json.decodeFromString(serializer, file.readText()).forEach { buffer.addLast(it) }
                while (buffer.size > maxEvents) buffer.removeFirst()
            }
        } catch (e: Exception) {
            // A corrupt buffer must never block reporting/playback — start clean.
            buffer.clear()
        }
    }

    private fun persist() {
        try {
            file.writeText(json.encodeToString(serializer, buffer.toList()))
        } catch (e: Exception) {
            // Best-effort persistence.
        }
    }
}
