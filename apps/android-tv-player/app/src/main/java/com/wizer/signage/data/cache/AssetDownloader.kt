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
 *  - A direct attempt that does not END IN A COMMITTED ASSET falls back to the
 *    proxied path within the SAME attempt. "Does not end in a committed asset"
 *    deliberately includes a 200 whose bytes fail verification, not just a
 *    transport failure: wrong-but-successful bytes are the failure mode the
 *    direct path uniquely introduces, because object storage is the one hop the
 *    API does not control. Keying the fallback on the transport result alone
 *    would skip the proxy exactly when it is most needed, and -- since the
 *    direct URL is the same on every attempt -- would then repeat the identical
 *    bad request until the retries ran out, leaving the screen uncached.
 *
 * Each attempt gets its OWN temp file, so bytes from a rejected direct download
 * can never be mistaken for the proxied download that follows it.
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
            if (directUrl != null) {
                if (fetchVerifyCommit(item) { temp -> api.downloadFromUrl(directUrl, temp) }) return true
            }
            // Reached when the direct fetch failed outright OR delivered bytes
            // that did not verify. Both are "storage did not give us the asset".
            if (proxiedPath != null) {
                if (fetchVerifyCommit(item) { temp -> api.downloadToFile(token, proxiedPath, temp) }) return true
            }
            // Full jitter: a new playlist pushes the same asset to every screen at
            // once, so a failing download must not be retried by the whole fleet
            // on the same tick.
            if (attempt < maxAttempts) delay(Jitter.backoff(attempt - 1, RETRY_BASE_MS))
        }
        return false
    }

    /**
     * One fetch into a private temp file: download, verify, commit. Returns true
     * only when the asset is in the cache. The temp file is always cleaned up --
     * [CacheManager.commit] renames it away, so the delete is a no-op on success.
     */
    private suspend fun fetchVerifyCommit(
        item: SyncPlanItem,
        fetch: suspend (File) -> Boolean,
    ): Boolean {
        val temp = File(cache.tmpDir, "dl_${item.contentId}_${System.nanoTime()}.part")
        try {
            if (!fetch(temp)) return false
            if (!Checksums.verify(temp, item.fileSizeBytes?.toLongOrNull(), item.checksum)) return false
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
        } finally {
            temp.delete()
        }
    }

    companion object {
        /** First-retry cap; doubles per attempt inside [Jitter.backoff]. */
        const val RETRY_BASE_MS = 1_000L
    }
}
