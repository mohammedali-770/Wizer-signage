package com.wizer.signage

import com.wizer.signage.monitoring.CrashTelemetryStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CrashTelemetryStoreTest {
    @Test
    fun `parses CrashRecovery timestamp without exposing the stack`() {
        val report = """
            at=1786000000000 thread=main
            java.lang.IllegalStateException: secret-ish diagnostic text
                at com.wizer.signage.Player.run(Player.kt:42)
        """.trimIndent()

        assertEquals(1_786_000_000_000L, CrashTelemetryStore.parseAtMillis(report))
    }

    @Test
    fun `missing timestamp stays absent`() {
        assertNull(CrashTelemetryStore.parseAtMillis("java.lang.RuntimeException: boom"))
    }

    @Test
    fun `fingerprint is deterministic bounded hex and changes with the trace`() {
        val first = CrashTelemetryStore.fingerprint("at=1 thread=main\nboom-a")
        val same = CrashTelemetryStore.fingerprint("at=1 thread=main\nboom-a")
        val second = CrashTelemetryStore.fingerprint("at=1 thread=main\nboom-b")

        assertEquals(first, same)
        assertEquals(24, first.length)
        assert(first.matches(Regex("^[a-f0-9]{24}$")))
        assert(first != second)
    }
}
