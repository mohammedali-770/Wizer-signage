package com.wizer.signage.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import com.wizer.signage.ui.AppViewModelFactory
import com.wizer.signage.util.Playback
import kotlinx.coroutines.delay
import java.io.File

/**
 * Full-screen player surface (Phase 7). Prefers cached local files; while online,
 * uncached file items stream via signed URL; while offline, only cache-playable
 * items are looped and a neutral "no cached content" screen shows if none exist.
 */
@Composable
fun PlayerScreen(
    factory: AppViewModelFactory,
    sessionKey: Int = 0,
    onUnpaired: () -> Unit,
) {
    val vm: PlayerViewModel = viewModel(key = "player-$sessionKey", factory = factory)
    val manifest by vm.manifest.collectAsStateWithLifecycle()
    val online by vm.online.collectAsStateWithLifecycle()
    val unpaired by vm.unpaired.collectAsStateWithLifecycle()
    val restartEpoch by vm.restartEpoch.collectAsStateWithLifecycle()

    LaunchedEffect(unpaired) {
        if (unpaired) onUnpaired()
    }

    val current = manifest
    when {
        current == null -> {
            // No manifest → close any in-flight proof-of-play session.
            LaunchedEffect(Unit) {
                vm.reportCurrentItem(null)
                vm.onItemInterrupted()
            }
            if (online) CenterMessage("Loading…") else NoCachedContentScreen(online = false)
        }
        else -> ManifestPlayer(
            manifest = current,
            online = online,
            resolveLocal = vm::localFile,
            restartEpoch = restartEpoch,
            onItem = vm::reportCurrentItem,
            onStart = vm::onItemStarted,
            onComplete = vm::onItemCompleted,
            onFailed = vm::onItemFailed,
            onInterrupted = vm::onItemInterrupted,
            onSkipped = vm::onItemSkipped,
        )
    }
}

/** True when an item can be shown from cache (or is inherently offline-safe). */
/**
 * Identity of a playlist for recomposition purposes: changes whenever the set of
 * items, their order, or any item's version changes.
 *
 * Deliberately NOT inlined into the `remember(items) { ... }` call site. Written
 * there as a `joinToString` with a trailing lambda, lint's Kotlin analysis (AGP
 * 8.5.2) fails to resolve the nested lambda's return type, infers Unit, and fails
 * the build with RememberReturnType — a false positive: the compiler types this as
 * String and the build otherwise succeeds. Naming the function gives lint a
 * declared return type to read instead of one to infer.
 */
private fun playlistSignature(items: List<ManifestItem>): String =
    items.joinToString("|") { "${it.contentId}:${it.version}" }

private fun isOfflinePlayable(item: ManifestItem, resolveLocal: (ManifestItem) -> File?): Boolean =
    when (item.type) {
        ManifestItem.TYPE_TEXT -> true
        ManifestItem.TYPE_IMAGE, ManifestItem.TYPE_VIDEO, ManifestItem.TYPE_PDF -> resolveLocal(item) != null
        else -> false // URL is not reliably cacheable in Phase 7
    }

/** Loops the playable items continuously, respecting per-item duration. */
@Composable
fun ManifestPlayer(
    manifest: PlaybackManifest,
    online: Boolean,
    resolveLocal: (ManifestItem) -> File?,
    restartEpoch: Int = 0,
    onItem: (ManifestItem?) -> Unit = {},
    onStart: (ManifestItem, Int) -> Unit = { _, _ -> },
    onComplete: () -> Unit = {},
    onFailed: (String?) -> Unit = {},
    onInterrupted: () -> Unit = {},
    onSkipped: (ManifestItem, Int) -> Unit = { _, _ -> },
) {
    // Online: play everything (stream uncached). Offline: only cache-playable items.
    val items = if (online) manifest.items else manifest.items.filter { isOfflinePlayable(it, resolveLocal) }

    // Offline, report each item that cannot be shown (uncached) as SKIPPED — once
    // per manifest version, not per loop.
    val skipped = remember(manifest, online) {
        if (online) emptyList()
        else manifest.items.withIndex().filter { !isOfflinePlayable(it.value, resolveLocal) }
    }
    LaunchedEffect(skipped) { skipped.forEach { onSkipped(it.value, it.index) } }

    if (items.isEmpty()) {
        // Nothing to show → close any running session.
        LaunchedEffect(Unit) {
            onItem(null)
            onInterrupted()
        }
        if (online) NoContentScreen(manifest) else NoCachedContentScreen(online = false)
        return
    }

    val signature = remember(items) { playlistSignature(items) }
    // restartEpoch in the key makes a remote RESTART_PLAYBACK reset to the first item.
    var index by remember(signature, restartEpoch) { mutableStateOf(0) }
    // Increments on every advance. A single-item playlist loops back to the very
    // same ManifestItem, so this counter is the ONLY thing that distinguishes one
    // play from the next — it keys the proof-of-play session, the advance guard
    // and the renderers' effects alike.
    var playCount by remember(signature, restartEpoch) { mutableStateOf(0) }
    val safeIndex = index.coerceIn(0, items.lastIndex)
    val item = items[safeIndex]

    LaunchedEffect(item) { onItem(item) } // telemetry: current on-screen item

    // ITEM_STARTED for each individual play (index OR loop changed). A new start
    // while a previous session is still open (manifest replaced mid-item, e.g. an
    // emergency) is auto-closed as ITEM_INTERRUPTED by the tracker.
    LaunchedEffect(safeIndex, playCount, signature) { onStart(item, safeIndex) }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        PlaybackItem(
            item = item,
            localFile = resolveLocal(item),
            online = online,
            playCount = playCount,
            onFinished = {
                onComplete() // natural ITEM_COMPLETED for the item that just ended
                index = Playback.nextIndex(safeIndex, items.size)
                playCount++
            },
            // Closes the session as ITEM_FAILED before onFinished's onComplete()
            // runs, so a codec failure is not booked as a clean play.
            onFailed = onFailed,
        )
    }
}

/**
 * Renders one item (cache-first) and advances exactly once per play.
 *
 * The one-shot guard is keyed on [playCount] as well as the content id: with a
 * one-item playlist `nextIndex(0, 1)` returns 0 and the item never changes, so a
 * contentId-only key left the guard latched after the first play and froze the
 * screen permanently.
 */
@Composable
fun PlaybackItem(
    item: ManifestItem,
    localFile: File?,
    online: Boolean,
    playCount: Int,
    onFinished: () -> Unit,
    onFailed: (String?) -> Unit = {},
) {
    val playKey = Playback.playKey(item.contentId, playCount)
    var advanced by remember(playKey) { mutableStateOf(false) }
    val advance: () -> Unit = {
        if (!advanced) {
            advanced = true
            onFinished()
        }
    }

    when (item.type) {
        ManifestItem.TYPE_VIDEO -> VideoItem(
            item = item,
            localFile = localFile,
            playCount = playCount,
            onFinished = advance,
            // Only report a failure that actually ends this play; a late error
            // after the guard latched belongs to the previous item.
            onFailed = { reason -> if (!advanced) onFailed(reason) },
        )
        else -> {
            when (item.type) {
                ManifestItem.TYPE_IMAGE -> ImageItem(item, localFile)
                ManifestItem.TYPE_PDF -> PdfItem(item, localFile)
                ManifestItem.TYPE_URL -> if (online) WebItem(item) else UnavailablePlaceholder("Web content is unavailable offline")
                else -> TextItem(item)
            }
            val ms = Playback.displayMillis(item) ?: (Playback.DEFAULT_DURATION_SECONDS * 1000L)
            LaunchedEffect(playKey) {
                delay(ms)
                advance()
            }
        }
    }
}

/**
 * Outside-hours behaviours that render nothing at all.
 *
 * BLACK_SCREEN is the only current spelling. SLEEP and BLANK_SCREEN are retired
 * names for the same behaviour and the API normalises both away before emitting
 * a manifest, so neither should ever arrive.
 *
 * They are listed anyway, for version skew: a player updates independently of
 * the server and may for a while be talking to an API released before either
 * rename. Getting this wrong fails silently and visibly — the screen would show
 * the neutral "no content" panel in a dark venue instead of going black.
 *
 * Note that none of these power the panel down — this composable only draws
 * black, and the app holds FLAG_KEEP_SCREEN_ON while soft kiosk is active.
 */
// Typed Set<String?> deliberately: outsideHoursBehavior is nullable, and leaving
// the element type as String would make `in` depend on Kotlin picking the
// covariant Iterable.contains extension over the member. Being explicit costs
// nothing and cannot be resolved the wrong way.
private val BLANKING_BEHAVIORS: Set<String?> = setOf("BLANK_SCREEN", "BLACK_SCREEN", "SLEEP")

/** Neutral screen when nothing is scheduled (sourceType NONE / empty), online. */
@Composable
fun NoContentScreen(manifest: PlaybackManifest) {
    val customMessage = manifest.message?.takeIf {
        manifest.outsideHours && manifest.outsideHoursBehavior == "CUSTOM_MESSAGE" && it.isNotBlank()
    }
    val blank = manifest.outsideHours &&
        manifest.outsideHoursBehavior in BLANKING_BEHAVIORS

    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(48.dp),
        contentAlignment = Alignment.Center,
    ) {
        when {
            blank -> Unit
            else -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "Wizer Signage",
                    style = MaterialTheme.typography.displaySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    customMessage ?: "No scheduled content",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** Neutral local fallback shown when offline with no cached content yet. */
@Composable
fun NoCachedContentScreen(online: Boolean) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(48.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Wizer Signage",
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                "No cached content available",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                if (online) "Syncing…" else "Offline — will resume when reconnected.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
fun CenterMessage(text: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
    }
}
