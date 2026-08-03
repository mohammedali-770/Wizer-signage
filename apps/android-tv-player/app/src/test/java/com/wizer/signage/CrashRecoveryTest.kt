package com.wizer.signage

import com.wizer.signage.system.CrashRecovery
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure part of the crash handler ([CrashRecovery.formatReport]). The report
 * is written from inside an already-failing process, so its only hard
 * requirements are that it never throws and never grows without bound.
 */
class CrashRecoveryTest {

    @Test
    fun reportCarriesTheThreadTimeAndStackTrace() {
        val report = CrashRecovery.formatReport(
            IllegalStateException("decoder gone"),
            "playback-thread",
            1_772_000_000_000L,
        )
        assertTrue(report.contains("1772000000000"))
        assertTrue(report.contains("playback-thread"))
        assertTrue(report.contains("IllegalStateException"))
        assertTrue(report.contains("decoder gone"))
    }

    @Test
    fun reportIncludesTheCause() {
        val cause = java.io.IOException("cache write failed")
        val report = CrashRecovery.formatReport(RuntimeException("wrapped", cause), "main", 0L)
        assertTrue(report.contains("cache write failed"))
    }

    @Test
    fun reportIsBounded() {
        // A StackOverflowError trace is tens of thousands of frames; persisting it
        // unbounded could itself fail on a nearly-full signage box.
        val deep = buildDeepThrowable(2_000)
        val report = CrashRecovery.formatReport(deep, "main", 0L)
        assertTrue("length=${report.length}", report.length <= CrashRecovery.MAX_REPORT_CHARS)
    }

    @Test
    fun reportSurvivesAThrowableWithNoMessage() {
        val report = CrashRecovery.formatReport(OutOfMemoryError(), "render", 1L)
        assertTrue(report.contains("OutOfMemoryError"))
    }

    @Test
    fun relaunchDelayIsShortEnoughToBeUseful() {
        // Long enough for the process to be gone, short enough that the screen is
        // not visibly dead (and stays inside the platform's activity-start grace).
        assertTrue(CrashRecovery.RELAUNCH_DELAY_MS in 1_000L..10_000L)
    }

    private fun buildDeepThrowable(depth: Int): Throwable {
        var t: Throwable = IllegalStateException("root")
        repeat(depth) { t = RuntimeException("level $it", t) }
        return t
    }
}
