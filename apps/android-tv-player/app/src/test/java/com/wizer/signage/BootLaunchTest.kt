package com.wizer.signage

import android.content.Intent
import com.wizer.signage.system.BootLaunch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Boot auto-start policy ([BootLaunch]). Only compile-time Android constants
 * are touched, so this runs as a plain JVM unit test like the rest of the
 * suite (no Robolectric / instrumentation).
 */
class BootLaunchTest {

    // --- action validation ----------------------------------------------------

    @Test
    fun `boot completed is a supported action`() {
        assertTrue(BootLaunch.isSupportedAction(Intent.ACTION_BOOT_COMPLETED))
    }

    @Test
    fun `quickboot poweron is a supported action`() {
        assertTrue(BootLaunch.isSupportedAction(BootLaunch.ACTION_QUICKBOOT_POWERON))
        assertEquals("android.intent.action.QUICKBOOT_POWERON", BootLaunch.ACTION_QUICKBOOT_POWERON)
    }

    @Test
    fun `unknown null and locked-boot actions are ignored`() {
        assertFalse(BootLaunch.isSupportedAction(null))
        assertFalse(BootLaunch.isSupportedAction(""))
        assertFalse(BootLaunch.isSupportedAction("android.intent.action.MY_PACKAGE_REPLACED"))
        assertFalse(BootLaunch.isSupportedAction("android.intent.action.LOCKED_BOOT_COMPLETED"))
        assertFalse(BootLaunch.isSupportedAction("com.evil.FAKE_BOOT"))
    }

    // --- launch decision --------------------------------------------------------

    @Test
    fun `supported action with auto-start enabled launches`() {
        assertTrue(BootLaunch.shouldLaunch(Intent.ACTION_BOOT_COMPLETED, autoStartEnabled = true))
        assertTrue(BootLaunch.shouldLaunch(BootLaunch.ACTION_QUICKBOOT_POWERON, autoStartEnabled = true))
    }

    @Test
    fun `disabled auto-start never launches even for supported actions`() {
        assertFalse(BootLaunch.shouldLaunch(Intent.ACTION_BOOT_COMPLETED, autoStartEnabled = false))
        assertFalse(BootLaunch.shouldLaunch(BootLaunch.ACTION_QUICKBOOT_POWERON, autoStartEnabled = false))
    }

    @Test
    fun `unsupported action never launches even with auto-start enabled`() {
        assertFalse(BootLaunch.shouldLaunch("android.intent.action.USER_PRESENT", autoStartEnabled = true))
        assertFalse(BootLaunch.shouldLaunch(null, autoStartEnabled = true))
    }

    // --- launch target + flags ---------------------------------------------------

    @Test
    fun `launch targets the existing main activity`() {
        assertEquals(MainActivity::class.java, BootLaunch.TARGET_ACTIVITY)
        assertEquals("com.wizer.signage.MainActivity", BootLaunch.TARGET_ACTIVITY.name)
    }

    @Test
    fun `launch flags start a new task without clearing or multiplying tasks`() {
        // NEW_TASK is required from a receiver context; singleTask launchMode on
        // MainActivity guarantees an existing task is fronted, not duplicated.
        assertTrue(BootLaunch.LAUNCH_FLAGS and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(0, BootLaunch.LAUNCH_FLAGS and Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
        assertEquals(0, BootLaunch.LAUNCH_FLAGS and Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }

    // --- attemptLaunch orchestration ---------------------------------------------

    @Test
    fun `attemptLaunch launches exactly once for a supported enabled boot`() {
        var launches = 0
        val result = BootLaunch.attemptLaunch(Intent.ACTION_BOOT_COMPLETED, autoStartEnabled = true) {
            launches += 1
        }
        assertEquals(BootLaunch.Result.LAUNCHED, result)
        assertEquals(1, launches)
    }

    @Test
    fun `attemptLaunch skips unsupported action without invoking the launcher`() {
        var launches = 0
        val result = BootLaunch.attemptLaunch("com.evil.FAKE_BOOT", autoStartEnabled = true) {
            launches += 1
        }
        assertEquals(BootLaunch.Result.SKIPPED_UNSUPPORTED_ACTION, result)
        assertEquals(0, launches)
    }

    @Test
    fun `attemptLaunch skips when auto-start is disabled`() {
        var launches = 0
        val result = BootLaunch.attemptLaunch(Intent.ACTION_BOOT_COMPLETED, autoStartEnabled = false) {
            launches += 1
        }
        assertEquals(BootLaunch.Result.SKIPPED_DISABLED, result)
        assertEquals(0, launches)
    }

    @Test
    fun `attemptLaunch contains launcher exceptions and reports failure`() {
        var reported: Exception? = null
        val result = BootLaunch.attemptLaunch(
            Intent.ACTION_BOOT_COMPLETED,
            autoStartEnabled = true,
            onFailure = { reported = it },
        ) {
            throw IllegalStateException("background launch blocked by OEM")
        }
        assertEquals(BootLaunch.Result.FAILED, result)
        assertNotNull(reported)
        assertTrue(reported is IllegalStateException)
    }
}
