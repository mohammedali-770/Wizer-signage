package com.wizer.signage

import com.wizer.signage.data.model.AndroidUpdatePolicy
import com.wizer.signage.update.AndroidUpdateRetryPolicy
import com.wizer.signage.update.AndroidUpdateStateStore
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidUpdateRetryPolicyTest {
    private val sticky = AndroidUpdateStateStore.Snapshot(
        pendingVersionCode = 42,
        policyRevision = "2026-08-09T08:00:00.000Z",
        attemptedAtMs = 1L,
        state = "BLOCKED",
        error = "platform_requires_user_action",
        reported = true,
    )

    private fun policy(
        enabled: Boolean = true,
        revision: String = "2026-08-09T08:00:00.000Z",
        target: Int = 42,
    ) = AndroidUpdatePolicy(
        enabled = enabled,
        eligible = true,
        policyRevision = revision,
        targetVersionName = "1.4.2",
        targetVersionCode = target,
    )

    @Test
    fun `same reported terminal revision stays sticky`() {
        assertFalse(AndroidUpdateRetryPolicy.shouldRelease(sticky, policy()))
    }

    @Test
    fun `new policy revision authorizes one fresh attempt`() {
        assertTrue(
            AndroidUpdateRetryPolicy.shouldRelease(
                sticky,
                policy(revision = "2026-08-09T09:00:00.000Z"),
            ),
        )
    }

    @Test
    fun `changed target releases old terminal state`() {
        assertTrue(AndroidUpdateRetryPolicy.shouldRelease(sticky, policy(target = 43)))
    }

    @Test
    fun `explicit disable releases the terminal attempt`() {
        assertTrue(AndroidUpdateRetryPolicy.shouldRelease(sticky, policy(enabled = false)))
    }

    @Test
    fun `unreported terminal result is retained until telemetry is accepted`() {
        val unreported = sticky.copy(reported = false)
        assertFalse(
            AndroidUpdateRetryPolicy.shouldRelease(
                unreported,
                policy(revision = "2026-08-09T09:00:00.000Z"),
            ),
        )
    }
}
