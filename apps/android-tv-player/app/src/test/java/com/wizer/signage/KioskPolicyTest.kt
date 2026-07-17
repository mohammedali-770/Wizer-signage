package com.wizer.signage

import com.wizer.signage.system.KioskPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure kiosk-policy decisions ([KioskPolicy]). Framework-free, so it runs as a
 * plain JVM unit test like the rest of the suite (no Robolectric).
 */
class KioskPolicyTest {

    private fun decide(
        paired: Boolean,
        kioskEnabled: Boolean = true,
        lockTaskPermitted: Boolean = false,
        inLockTask: Boolean = false,
    ) = KioskPolicy.decide(
        KioskPolicy.Inputs(paired, kioskEnabled, lockTaskPermitted, inLockTask),
    )

    // --- activation gating -----------------------------------------------------

    @Test
    fun `unpaired state does not activate kiosk`() {
        val d = decide(paired = false)
        assertFalse(d.softKioskActive)
        assertFalse(d.consumeBack)
        assertFalse(d.startLockTask)
        assertFalse(d.keepScreenOn) // not playing → no keep-awake
    }

    @Test
    fun `pairing setup state (unpaired) never requests lock task even if permitted`() {
        val d = decide(paired = false, lockTaskPermitted = true)
        assertFalse(d.softKioskActive)
        assertFalse(d.startLockTask)
    }

    @Test
    fun `paired playback activates soft kiosk`() {
        val d = decide(paired = true, kioskEnabled = true)
        assertTrue(d.softKioskActive)
        assertTrue(d.consumeBack)
        assertTrue(d.keepScreenOn)
    }

    @Test
    fun `disabled kiosk does not activate soft kiosk but still keeps screen awake`() {
        val d = decide(paired = true, kioskEnabled = false)
        assertFalse(d.softKioskActive)
        assertFalse(d.consumeBack)
        assertFalse(d.startLockTask)
        assertTrue(d.keepScreenOn) // playback is active regardless of the toggle
    }

    // --- managed lock task -----------------------------------------------------

    @Test
    fun `lock-task-permitted playback requests managed lock task`() {
        val d = decide(paired = true, kioskEnabled = true, lockTaskPermitted = true, inLockTask = false)
        assertTrue(d.startLockTask)
    }

    @Test
    fun `lock-task-not-permitted playback stays in soft kiosk without lock task`() {
        val d = decide(paired = true, kioskEnabled = true, lockTaskPermitted = false)
        assertTrue(d.softKioskActive)
        assertFalse(d.startLockTask)
    }

    @Test
    fun `does not re-request lock task when already pinned`() {
        val d = decide(paired = true, kioskEnabled = true, lockTaskPermitted = true, inLockTask = true)
        assertFalse(d.startLockTask)
    }

    @Test
    fun `leaves lock task when leaving the signage experience`() {
        // unpaired while pinned → stop; paired+active while pinned → do NOT stop.
        assertTrue(decide(paired = false, inLockTask = true).stopLockTask)
        assertTrue(decide(paired = true, kioskEnabled = false, inLockTask = true).stopLockTask)
        assertFalse(decide(paired = true, kioskEnabled = true, lockTaskPermitted = true, inLockTask = true).stopLockTask)
    }

    // --- back + keep-awake -----------------------------------------------------

    @Test
    fun `back is consumed only during active soft-kiosk playback`() {
        assertTrue(decide(paired = true, kioskEnabled = true).consumeBack)
        assertFalse(decide(paired = true, kioskEnabled = false).consumeBack)
        assertFalse(decide(paired = false).consumeBack)
    }

    @Test
    fun `keep-screen-on follows active playback (paired), not the kiosk toggle`() {
        assertTrue(KioskPolicy.keepScreenOn(paired = true))
        assertFalse(KioskPolicy.keepScreenOn(paired = false))
    }
}
