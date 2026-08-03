package com.wizer.signage.util

import kotlin.random.Random

/**
 * Randomised delays for every repeating network loop.
 *
 * A whole site of screens powers up together after a mains cut and, with fixed
 * intervals, stays in lockstep for weeks — a thousand devices hitting
 * /manifest, /heartbeat and /commands within the same second, then all retrying
 * together the moment the API wobbles. Pure, with an injectable [Random], so the
 * bounds are covered by plain JUnit tests.
 */
object Jitter {

    /** Default spread applied to a periodic interval (±20%). */
    const val DEFAULT_SPREAD = 0.2

    /** Upper bound of the one-off delay applied before a loop's first request. */
    const val MAX_STARTUP_DELAY_MS = 10_000L

    /** Ceiling for jittered retry backoff. */
    const val MAX_BACKOFF_MS = 60_000L

    /**
     * A periodic interval spread uniformly over ±[spread]. Full jitter (`0..interval`)
     * is deliberately NOT used for periodic work: it would let a 60s heartbeat fire
     * again almost immediately, multiplying fleet load instead of spreading it.
     */
    fun periodic(intervalMs: Long, spread: Double = DEFAULT_SPREAD, random: Random = Random.Default): Long {
        if (intervalMs <= 0L) return 0L
        val delta = (intervalMs * spread.coerceIn(0.0, 1.0)).toLong()
        if (delta <= 0L) return intervalMs
        return (intervalMs - delta) + random.nextLong(2 * delta + 1)
    }

    /**
     * Full jitter for retries: sleep uniformly in `[0, cap]`, where the cap doubles
     * per attempt up to [maxMs]. Screens that fail the same request never retry in
     * step, so an API coming back up is not immediately re-flooded by the fleet.
     */
    fun backoff(attempt: Int, baseMs: Long, maxMs: Long = MAX_BACKOFF_MS, random: Random = Random.Default): Long {
        if (baseMs <= 0L || maxMs <= 0L) return 0L
        // Shift-compare instead of shifting first: `baseMs shl attempt` overflows.
        val shift = attempt.coerceIn(0, 30)
        val cap = if (baseMs >= maxMs shr shift) maxMs else minOf(baseMs shl shift, maxMs)
        return random.nextLong(cap + 1)
    }

    /** One-off offset before a loop's first request, uniform in `[0, maxMs]`. */
    fun startupDelay(maxMs: Long = MAX_STARTUP_DELAY_MS, random: Random = Random.Default): Long =
        if (maxMs <= 0L) 0L else random.nextLong(maxMs + 1)
}
