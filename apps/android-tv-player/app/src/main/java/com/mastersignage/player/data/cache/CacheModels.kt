package com.mastersignage.player.data.cache

import kotlinx.serialization.Serializable

/** Metadata for one cached asset (persisted in the cache index). */
@Serializable
data class CachedAsset(
    val contentId: String,
    val version: String,
    val checksum: String? = null,
    val type: String = "",
    val mimeType: String? = null,
    /** File name within the cache assets directory. */
    val fileName: String,
    val fileSize: Long = 0,
    val downloadedAt: Long = 0,
    val lastUsedAt: Long = 0,
)

/** Persisted cache index — content id → cached asset. */
@Serializable
data class CacheIndex(
    val assets: Map<String, CachedAsset> = emptyMap(),
)
