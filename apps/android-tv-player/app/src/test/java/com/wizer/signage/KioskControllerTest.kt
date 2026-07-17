package com.wizer.signage

import com.wizer.signage.system.KioskController
import com.wizer.signage.system.KioskEnvironment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [KioskController] behaviour against a fake [KioskEnvironment] — no Android, so
 * it runs as a plain JVM unit test. Covers duplicate-lock-task prevention,
 * lifecycle idempotency, keep-awake tracking, and failure-safety.
 */
class KioskControllerTest {

    private class FakeEnv(
        var permitted: Boolean = false,
        var inLock: Boolean = false,
        var throwOnEverything: Boolean = false,
    ) : KioskEnvironment {
        var startCount = 0
        var stopCount = 0
        var immersiveCount = 0
        var keepScreenOn: Boolean? = null

        private fun maybeThrow() { if (throwOnEverything) throw RuntimeException("OEM quirk") }
        override fun isLockTaskPermitted(): Boolean { maybeThrow(); return permitted }
        override fun isInLockTask(): Boolean { maybeThrow(); return inLock }
        override fun startLockTask() { maybeThrow(); startCount++; inLock = true }
        override fun stopLockTask() { maybeThrow(); stopCount++; inLock = false }
        override fun setKeepScreenOn(on: Boolean) { maybeThrow(); keepScreenOn = on }
        override fun applyImmersive() { maybeThrow(); immersiveCount++ }
    }

    private fun controller(env: KioskEnvironment, enabled: () -> Boolean = { true }) =
        KioskController(env, enabled)

    @Test
    fun `paired permitted playback starts lock task exactly once across repeated lifecycle events`() {
        val env = FakeEnv(permitted = true)
        val c = controller(env)
        c.onPairedChanged(true)
        c.onResume(true)
        c.onWindowFocusGained(true)
        c.apply(true)
        assertEquals(1, env.startCount) // not restarted every lifecycle callback
        assertTrue(env.inLock)
    }

    @Test
    fun `not permitted means no lock task but soft kiosk still applies`() {
        val env = FakeEnv(permitted = false)
        val c = controller(env)
        c.apply(true)
        assertEquals(0, env.startCount)
        assertEquals(true, env.keepScreenOn)
        assertTrue(env.immersiveCount > 0)
    }

    @Test
    fun `unpaired never starts lock task`() {
        val env = FakeEnv(permitted = true)
        controller(env).apply(false)
        assertEquals(0, env.startCount)
        assertEquals(false, env.keepScreenOn)
    }

    @Test
    fun `leaving the signage experience stops lock task (not on ordinary resume)`() {
        val env = FakeEnv(permitted = true)
        val c = controller(env)
        c.apply(true)                       // enter lock task
        assertEquals(1, env.startCount)
        c.onResume(true)                    // ordinary resume — must NOT stop
        assertEquals(0, env.stopCount)
        c.onPairedChanged(false)            // unpaired — leave lock task
        assertEquals(1, env.stopCount)
        assertFalse(env.inLock)
    }

    @Test
    fun `disabled kiosk keeps screen awake but no lock task and no back consumption`() {
        val env = FakeEnv(permitted = true)
        val c = controller(env, enabled = { false })
        c.apply(true)
        assertEquals(0, env.startCount)
        assertEquals(true, env.keepScreenOn) // playback still keeps awake
        assertFalse(c.shouldConsumeBack(true))
    }

    @Test
    fun `back consumed only during active soft-kiosk playback`() {
        val env = FakeEnv()
        assertTrue(controller(env).shouldConsumeBack(true))
        assertFalse(controller(env).shouldConsumeBack(false))
        assertFalse(controller(env, enabled = { false }).shouldConsumeBack(true))
    }

    @Test
    fun `keep-screen-on follows paired across transitions`() {
        val env = FakeEnv()
        val c = controller(env)
        c.apply(true); assertEquals(true, env.keepScreenOn)
        c.apply(false); assertEquals(false, env.keepScreenOn)
    }

    @Test
    fun `environment failures fall back without throwing`() {
        val env = FakeEnv(throwOnEverything = true)
        val c = controller(env)
        // Must not throw despite every framework call throwing.
        c.onPairedChanged(true)
        c.onResume(true)
        c.onWindowFocusGained(true)
        assertEquals(0, env.startCount) // nothing pinned; no crash
    }

    @Test
    fun `preference read failure defaults to enabled without throwing`() {
        val env = FakeEnv(permitted = false)
        val c = controller(env, enabled = { throw IllegalStateException("prefs unavailable") })
        c.apply(true) // must not throw
        assertTrue(c.shouldConsumeBack(true)) // defaults to enabled → soft kiosk on
    }
}
