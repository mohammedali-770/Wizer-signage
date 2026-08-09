package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

/**
 * Authenticated server decision. Public release metadata alone never authorizes
 * installation. `targetVersionName` + `targetVersionCode` identify one immutable
 * per-version manifest. `policyRevision` changes whenever an operator saves the
 * rollout policy, allowing one controlled retry after a terminal BLOCKED/FAILED
 * state without retrying the same bad update forever.
 */
@Serializable
data class AndroidUpdatePolicy(
    val enabled: Boolean = false,
    val eligible: Boolean = false,
    val rolloutPercent: Int = 0,
    val cohort: Int = 0,
    val policyRevision: String? = null,
    val targetVersionName: String? = null,
    val targetVersionCode: Int? = null,
    val checkIntervalSeconds: Int = 21_600,
)

/** Every result is bound to the exact policy revision that authorized it. */
@Serializable
data class AndroidUpdateResult(
    val state: String,
    val policyRevision: String? = null,
    val targetVersionCode: Int? = null,
    val installedVersionCode: Int? = null,
    val error: String? = null,
)
