package com.wizer.signage

import com.wizer.signage.monitoring.CrashTelemetryStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CrashTelemetryStoreTest {
    @Test
    fun parsesCrashRecoveryTimestampWithoutExposingTheStack() {
        val report = """
            at=1786000000000 thread=main
            java.lang.IllegalStateException: diagnostic text
                at com.wizer.signage.Player.run(Player.kt:42)
        """.trimIndent()
        assertEquals(1_786_000_000_000L, CrashTelemetryStore.parseAtMillis(report))
    }

    @Test
    fun missingTimestampStaysAbsent() {
        assertNull(CrashTelemetryStore.parseAtMillis("java.lang.RuntimeException: boom"))
    }

    @Test
    fun fingerprintIsDeterministicBoundedHex() {
        val first = CrashTelemetryStore.fingerprint("at=1 thread=main\nboom-a")
        val same = CrashTelemetryStore.fingerprint("at=1 thread=main\nboom-a")
        val second = CrashTelemetryStore.fingerprint("at=1 thread=main\nboom-b")
        assertEquals(first, same)
        assertEquals(24, first.length)
        assertTrue(first.matches(Regex("^[a-f0-9]{24}$")))
        assertTrue(first != second)
    }
}
