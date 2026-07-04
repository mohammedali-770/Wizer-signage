package com.wizer.signage.data.cache

import com.wizer.signage.data.ApiClient
import com.wizer.signage.data.model.SyncPlanItem
import com.wizer.signage.util.Checksums
import kotlinx.coroutines.delay
import java.io.File

/**
 * Downloads an entitled asset to a temp file, verifies it (size + checksum),
 * then commits it atomically into the cache. Retries with exponential backoff;
 * a failed download leaves any existing cached copy untouched.
 */
class AssetDownloader(
    private val api: ApiClient,
    private val cache: CacheManager,
) {
    suspend fun download(token: String, item: SyncPlanItem, maxAttempts: Int = 3): Boolean {
        val path = item.downloadPath ?: return false
        var backoff = 1_000L
        for (attempt in 1..maxAttempts) {
            val temp = File(cache.tmpDir, "dl_${item.contentId}_${System.nanoTime()}.part")
            val downloaded = api.downloadToFile(token, path, temp)
            if (downloaded && Checksums.verify(temp, item.fileSizeBytes?.toLongOrNull(), item.checksum)) {
                val now = System.currentTimeMillis()
                cache.commit(
                    CachedAsset(
                        contentId = item.contentId,
                        version = item.version,
                        checksum = item.checksum,
                        type = item.type,
                        mimeType = item.mimeType,
                        fileName = cache.fileNameFor(item.contentId, item.version),
                        fileSize = temp.length(),
                        downloadedAt = now,
                        lastUsedAt = now,
                    ),
                    temp,
                )
                return true
            }
            temp.delete()
            if (attempt < maxAttempts) {
                delay(backoff)
                backoff *= 2
            }
        }
        return false
    }
}
