package com.mastersignage.player

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mastersignage.player.data.DeviceStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented tests for the (now encrypted) DeviceStore. Runs on a device /
 * emulator. On API 23+ the store is Keystore-encrypted; the legacy-migration
 * test also asserts the plaintext file is wiped after migration.
 */
@RunWith(AndroidJUnit4::class)
class DeviceStoreInstrumentedTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        // Clean both backing files for a deterministic start.
        context.getSharedPreferences("ms_player", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("ms_player_secure", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun savesAndClearsPairing() {
        val store = DeviceStore(context)
        assertFalse(store.isPaired)

        store.savePairing(token = "tok-123", screenId = "s1", screenName = "Lobby")
        assertTrue(store.isPaired)
        assertEquals("tok-123", store.deviceToken)
        assertEquals("s1", store.screenId)
        assertEquals("Lobby", store.screenName)

        store.clearPairing()
        assertFalse(store.isPaired)
        assertNull(store.deviceToken)
        assertNull(store.screenId)
    }

    @Test
    fun deviceIdIsStableAcrossInstances() {
        val first = DeviceStore(context).deviceId
        val second = DeviceStore(context).deviceId
        assertEquals(first, second)
    }

    @Test
    fun migratesLegacyPlaintextThenWipesIt() {
        // Seed legacy Phase-6 plaintext values.
        context.getSharedPreferences("ms_player", Context.MODE_PRIVATE).edit()
            .putString("device_token", "legacy-tok")
            .putString("screen_id", "s9")
            .putString("device_id", "dev-1")
            .commit()

        val store = DeviceStore(context)
        assertEquals("legacy-tok", store.deviceToken)
        assertEquals("s9", store.screenId)
        assertEquals("dev-1", store.deviceId)

        if (store.isSecureStorage) {
            // After migration the plaintext file must be empty.
            assertTrue(context.getSharedPreferences("ms_player", Context.MODE_PRIVATE).all.isEmpty())
        }
    }
}
