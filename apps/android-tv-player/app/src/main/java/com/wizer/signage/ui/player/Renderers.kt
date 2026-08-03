package com.wizer.signage.ui.player

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.util.PdfRendering
import com.wizer.signage.util.Playback
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File

/** Full-screen image (Coil). Prefers the cached local file; else streams online. */
@Composable
fun ImageItem(item: ManifestItem, localFile: File? = null) {
    AsyncImage(
        model = localFile ?: Playback.mediaUrl(item),
        contentDescription = item.title,
        contentScale = ContentScale.Fit,
        modifier = Modifier.fillMaxSize().background(Color.Black),
    )
}

/** Full-screen text announcement (always offline-safe). */
@Composable
fun TextItem(item: ManifestItem) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(64.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = item.textBody?.takeIf { it.isNotBlank() } ?: item.title,
            color = Color.White,
            fontSize = 48.sp,
            textAlign = TextAlign.Center,
        )
    }
}

/** Full-screen URL content in a WebView (online only). */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebItem(item: ManifestItem) {
    val url = item.url ?: "about:blank"
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                webViewClient = WebViewClient()
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                setBackgroundColor(android.graphics.Color.BLACK)
            }
        },
        update = { webView -> webView.loadUrl(url) },
        // Screens run for weeks without a restart: a WebView that is never
        // destroyed keeps its renderer process, JS timers and DOM storage alive
        // for every URL item ever played until the box runs out of memory.
        onRelease = { webView ->
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        },
    )
}

/**
 * Full-screen video via Media3. Prefers the cached local file; else streams online.
 *
 * [playCount] is part of every key here: on a single-item playlist the loop
 * returns to the same [ManifestItem], so keying on `contentId` alone means the
 * media is never re-prepared and the screen stays on the last frame forever.
 */
@Composable
fun VideoItem(
    item: ManifestItem,
    localFile: File?,
    playCount: Int,
    onFinished: () -> Unit,
    onFailed: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val exo = remember { ExoPlayer.Builder(context).build() }
    // The listener below outlives recompositions; without this it would keep
    // calling the FIRST play's advance callback, whose one-shot guard is already
    // spent — advancing would silently stop after one loop.
    val finish by rememberUpdatedState(onFinished)
    val fail by rememberUpdatedState(onFailed)
    val playKey = Playback.playKey(item.contentId, playCount)

    LaunchedEffect(playKey, localFile?.path) {
        val uri: Uri? = when {
            localFile != null -> Uri.fromFile(localFile)
            else -> Playback.mediaUrl(item)?.let { Uri.parse(it) }
        }
        if (uri == null) {
            fail("No playable source for ${item.contentId}")
            finish()
            return@LaunchedEffect
        }
        exo.setMediaItem(MediaItem.fromUri(uri))
        exo.repeatMode = Player.REPEAT_MODE_OFF
        exo.prepare()
        exo.playWhenReady = true
        Playback.displayMillis(item)?.let { ms ->
            delay(ms)
            finish()
        }
    }

    // Unconditional stall watchdog. A decoder that neither ends nor errors emits
    // no callback at all, and a full-length video has no display timer, so this
    // is the only thing that can free the playlist. Deliberately later than the
    // fixed-duration timer above, which wins for a healthy play.
    LaunchedEffect(playKey, localFile?.path) {
        delay(Playback.videoWatchdogMillis(item))
        fail("Playback watchdog timeout for ${item.contentId}")
        finish()
    }

    DisposableEffect(Unit) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) finish()
            }

            // Cheap Android TV boxes vary wildly in HEVC/VP9/AV1 support, so one
            // undecodable asset is normal. Report it and move on — never let it
            // stall the loop for the rest of the playlist.
            override fun onPlayerError(error: PlaybackException) {
                fail("${error.errorCodeName}: ${error.message ?: "playback error"}")
                finish()
            }
        }
        exo.addListener(listener)
        onDispose {
            exo.removeListener(listener)
            exo.release()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            PlayerView(ctx).apply {
                player = exo
                useController = false
                setBackgroundColor(android.graphics.Color.BLACK)
            }
        },
    )
}

/** Full-screen PDF first page. Renders from the cached file when available. */
@Composable
fun PdfItem(item: ManifestItem, localFile: File? = null) {
    val context = LocalContext.current
    var bitmap by remember(item.contentId) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(item.contentId) { mutableStateOf(false) }

    LaunchedEffect(item.contentId, localFile?.path) {
        // Size the render to this panel: the page geometry comes from whatever
        // was uploaded, and an A0 poster rendered at a fixed scale is a heap-sized
        // allocation.
        val metrics = context.resources.displayMetrics
        val bmp = withContext(Dispatchers.IO) {
            if (localFile != null) {
                PdfRendering.renderFirstPageFromFile(localFile, metrics.widthPixels, metrics.heightPixels)
            } else {
                item.signedUrl?.let {
                    PdfRendering.renderFirstPage(context, it, metrics.widthPixels, metrics.heightPixels)
                }
            }
        }
        if (bmp == null) failed = true else bitmap = bmp
    }

    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = bitmap
        when {
            bmp != null -> Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = item.title,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
            failed -> Text(
                text = "PDF: ${item.title}\n(preview unavailable)",
                color = Color.White,
                fontSize = 36.sp,
                textAlign = TextAlign.Center,
            )
            else -> CircularProgressIndicator(color = Color.White)
        }
    }
}

/** Neutral placeholder for an item that can't be shown right now (e.g. URL offline). */
@Composable
fun UnavailablePlaceholder(message: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(48.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(message, color = Color.White, fontSize = 32.sp, textAlign = TextAlign.Center)
    }
}
