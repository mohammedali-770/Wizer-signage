package com.wizer.signage.update

import com.wizer.signage.data.model.AndroidUpdatePolicy

/** Pure decision layer for terminal OTA retry suppression. */
internal object AndroidUpdateRetryPolicy {
    fun shouldRelease(
        snapshot: AndroidUpdateStateStore.Snapshot,
        policy: AndroidUpdatePolicy,
    ): Boolean {
        val terminal = snapshot.state == "FAILED" || snapshot.state == "BLOCKED"
        if (!terminal || !snapshot.reported) return false

        val sameRevision =
            snapshot.policyRevision != null && snapshot.policyRevision == policy.policyRevision
        val sameTarget = snapshot.pendingVersionCode == policy.targetVersionCode
        return !sameRevision || !sameTarget || !policy.enabled
    }
}
