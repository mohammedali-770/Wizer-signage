package com.wizer.signage.data.cache

import com.wizer.signage.data.ApiClient
import com.wizer.signage.data.model.SyncPlanItem
import com.wizer.signage.util.Checksums
import com.wizer.signage.util.Jitter
import kotlinx.coroutines.delay
import java.io.File

/**
 * Downloads an entitled asset to a temp file, verifies it (size + checksum),
 * then commits it atomically into the cache. Retries with exponential backoff;
 * a failed download leaves any existing cached copy untouched.
 *
 * Prefers the pre-signed storage URL from the sync plan, falling back to the
 * device-authenticated API path. Every cached byte used to be proxied through
 * the API, which made one container the bandwidth bottleneck for the whole
 * fleet and put it on the critical path for traffic it only relayed.
 *
 * Two rules govern which path is taken, and both are deliberate:
 *
 *  - The direct URL is used ONLY when the plan also carries a checksum.
 *    Checksums.verify returns true when the expected hash is null, so an
 *    unverifiable direct download could put unchecked bytes into the cache.
 *    The proxied path stays authenticated end to end, so it is the safe
 *    default when there is nothing to verify against.
 *  - A failed direct attempt falls back to the proxied path within the SAME
 *    attempt, so a storage hiccup or an expired URL costs one extra request
 *    rather than a whole retry cycle -- and a screen is never left uncached
 *    because object storage was briefly unreachable.
 */
class AssetDownloader(
    private val api: ApiClient,
    private val cache: CacheManager,
) {
    suspend fun download(token: String, item: SyncPlanItem, maxAttempts: Int = 3): Boolean {
        val proxiedPath = item.downloadPath
        // Only trust a direct fetch we can actually verify -- see the class doc.
        val directUrl = if (item.checksum != null) item.signedUrl else null
        if (proxiedPath == null && directUrl == null) return false
        for (attempt in 1..maxAttempts) {
            val temp = File(cache.tmpDir, "dl_${item.contentId}_${System.nanoTime()}.part")
            var downloaded = directUrl != null && api.downloadFromUrl(directUrl, temp)
            if (!downloaded && proxiedPath != null) {
                downloaded = api.downloadToFile(token, proxiedPath, temp)
            }
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
            // Full jitter: a new playlist pushes the same asset to every screen at
            // once, so a failing download must not be retried by the whole fleet
            // on the same tick.
            if (attempt < maxAttempts) delay(Jitter.backoff(attempt - 1, RETRY_BASE_MS))
        }
        return false
    }

    companion object {
        /** First-retry cap; doubles per attempt inside [Jitter.backoff]. */
        const val RETRY_BASE_MS = 1_000L
    }
}
