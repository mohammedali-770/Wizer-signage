package com.wizer.signage.data.model

import kotlinx.serialization.Serializable

/** Authenticated server decision. Public release metadata alone never authorizes installation. */
@Serializable
data class AndroidUpdatePolicy(
    val enabled: Boolean = false,
    val eligible: Boolean = false,
    val rolloutPercent: Int = 0,
    val cohort: Int = 0,
    val targetVersionCode: Int? = null,
    val checkIntervalSeconds: Int = 21_600,
)

@Serializable
data class AndroidUpdateResult(
    val state: String,
    val targetVersionCode: Int? = null,
    val installedVersionCode: Int? = null,
    val error: String? = null,
)
