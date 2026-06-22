package com.mastersignage.player

import com.mastersignage.player.data.model.PendingCommand
import com.mastersignage.player.monitoring.CommandActions
import com.mastersignage.player.monitoring.CommandExecutor
import com.mastersignage.player.monitoring.TelemetryCollector
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeActions(var screenshotResult: Boolean = true) : CommandActions {
    var forceSyncCalled = false
    var refreshCalled = false
    var restartCalled = false
    var reloadCalled = false
    var clearFull: Boolean? = null
    var unpairCalled = false

    override fun forceSync() { forceSyncCalled = true }
    override fun refreshManifest() { refreshCalled = true }
    override fun restartPlayback() { restartCalled = true }
    override fun reloadConfig() { reloadCalled = true }
    override fun clearCache(full: Boolean) { clearFull = full }
    override fun unpair() { unpairCalled = true }
    override suspend fun captureAndUploadScreenshot(commandId: String): Boolean = screenshotResult
}

class CommandExecutorTest {

    private fun cmd(type: String, payload: JsonObject? = null) = PendingCommand(id = "c1", commandType = type, payload = payload)

    @Test
    fun forceSyncAndRefreshAndRestartDispatch() = runTest {
        val a = FakeActions()
        val ex = CommandExecutor(a)
        assertTrue(ex.run(cmd("FORCE_SYNC")).success)
        assertTrue(a.forceSyncCalled)
        assertTrue(ex.run(cmd("REFRESH_MANIFEST")).success)
        assertTrue(a.refreshCalled)
        assertTrue(ex.run(cmd("RESTART_PLAYBACK")).success)
        assertTrue(a.restartCalled)
    }

    @Test
    fun clearCacheReadsTheFullFlag() = runTest {
        val a = FakeActions()
        val ex = CommandExecutor(a)
        ex.run(cmd("CLEAR_CACHE", buildJsonObject { put("full", true) }))
        assertEquals(true, a.clearFull)
        ex.run(cmd("CLEAR_CACHE")) // no payload → defaults false
        assertEquals(false, a.clearFull)
    }

    @Test
    fun screenshotFailsCleanlyWhenUnsupported() = runTest {
        val ex = CommandExecutor(FakeActions(screenshotResult = false))
        val outcome = ex.run(cmd("TAKE_SCREENSHOT"))
        assertFalse(outcome.success)
        assertNotNull(outcome.error)
    }

    @Test
    fun rebootIsReportedUnsupported() = runTest {
        val outcome = CommandExecutor(FakeActions()).run(cmd("REBOOT_DEVICE"))
        assertFalse(outcome.success)
        assertTrue(outcome.error!!.contains("not supported", ignoreCase = true))
    }

    @Test
    fun unknownCommandFails() = runTest {
        val outcome = CommandExecutor(FakeActions()).run(cmd("WAT"))
        assertFalse(outcome.success)
        assertNotNull(outcome.error)
    }

    @Test
    fun playbackStateDerivation() {
        assertEquals("IDLE", TelemetryCollector.derivePlaybackState(false, "REMOTE"))
        assertEquals("OFFLINE_PLAYBACK", TelemetryCollector.derivePlaybackState(true, "LOCAL_CACHE"))
        assertEquals("PLAYING", TelemetryCollector.derivePlaybackState(true, "REMOTE"))
    }
}
