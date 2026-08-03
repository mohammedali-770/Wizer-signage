package com.wizer.signage

import com.wizer.signage.util.Jitter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * Bounds + spread of the fleet anti-lockstep delays ([Jitter]). Random is
 * injected so these stay deterministic; the statistical checks use a fixed seed.
 */
class JitterTest {

    private fun seeded() = Random(20260803)

    // --- periodic ---------------------------------------------------------------

    @Test
    fun periodicStaysWithinTheSpreadWindow() {
        val random = seeded()
        val interval = 60_000L
        val low = (interval * (1 - Jitter.DEFAULT_SPREAD)).toLong()
        val high = (interval * (1 + Jitter.DEFAULT_SPREAD)).toLong()
        repeat(2_000) {
            val delay = Jitter.periodic(interval, random = random)
            assertTrue("$delay < $low", delay >= low)
            assertTrue("$delay > $high", delay <= high)
        }
    }

    @Test
    fun periodicNeverCollapsesToZero() {
        // Full jitter would allow 0 here and turn a 60s heartbeat into a hot loop.
        val random = seeded()
        repeat(2_000) { assertTrue(Jitter.periodic(60_000L, random = random) > 0L) }
    }

    @Test
    fun periodicActuallySpreadsTheFleet() {
        val random = seeded()
        val delays = (0 until 1_000).map { Jitter.periodic(60_000L, random = random) }
        assertTrue("expected a wide spread, got ${delays.distinct().size}", delays.distinct().size > 500)
    }

    @Test
    fun periodicHandlesDegenerateIntervals() {
        assertEquals(0L, Jitter.periodic(0L))
        assertEquals(0L, Jitter.periodic(-5L))
        assertEquals(1_000L, Jitter.periodic(1_000L, spread = 0.0))
        // Too small for any delta at this spread → returned unchanged, not zero.
        assertEquals(3L, Jitter.periodic(3L, spread = 0.2))
    }

    // --- retry backoff -----------------------------------------------------------

    @Test
    fun backoffIsFullJitterUnderADoublingCap() {
        val random = seeded()
        for (attempt in 0..4) {
            val cap = minOf(1_000L shl attempt, Jitter.MAX_BACKOFF_MS)
            repeat(500) {
                val delay = Jitter.backoff(attempt, 1_000L, random = random)
                assertTrue(delay >= 0L)
                assertTrue("$delay > $cap at attempt $attempt", delay <= cap)
            }
        }
    }

    @Test
    fun backoffNeverExceedsTheCapOrOverflows() {
        val random = seeded()
        for (attempt in listOf(0, 10, 31, 1_000, Int.MAX_VALUE)) {
            val delay = Jitter.backoff(attempt, 1_000L, 30_000L, random)
            assertTrue("attempt $attempt gave $delay", delay in 0L..30_000L)
        }
    }

    @Test
    fun backoffHandlesDegenerateBounds() {
        assertEquals(0L, Jitter.backoff(3, 0L))
        assertEquals(0L, Jitter.backoff(3, 1_000L, 0L))
    }

    @Test
    fun backoffDoesNotRetryInLockstep() {
        val random = seeded()
        val delays = (0 until 1_000).map { Jitter.backoff(3, 1_000L, random = random) }
        assertTrue(delays.distinct().size > 500)
    }

    // --- startup offset -----------------------------------------------------------

    @Test
    fun startupDelayIsWithinItsBound() {
        val random = seeded()
        repeat(2_000) {
            val delay = Jitter.startupDelay(random = random)
            assertTrue(delay in 0L..Jitter.MAX_STARTUP_DELAY_MS)
        }
    }

    @Test
    fun startupDelayHandlesDegenerateBounds() {
        assertEquals(0L, Jitter.startupDelay(0L))
        assertEquals(0L, Jitter.startupDelay(-1L))
    }
}
