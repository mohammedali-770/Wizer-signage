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
    )
}

/** Full-screen video via Media3. Prefers the cached local file; else streams online. */
@Composable
fun VideoItem(item: ManifestItem, localFile: File?, onFinished: () -> Unit) {
    val context = LocalContext.current
    val exo = remember { ExoPlayer.Builder(context).build() }

    LaunchedEffect(item.contentId, localFile?.path) {
        val uri: Uri? = when {
            localFile != null -> Uri.fromFile(localFile)
            else -> Playback.mediaUrl(item)?.let { Uri.parse(it) }
        }
        if (uri == null) {
            onFinished()
            return@LaunchedEffect
        }
        exo.setMediaItem(MediaItem.fromUri(uri))
        exo.repeatMode = Player.REPEAT_MODE_OFF
        exo.prepare()
        exo.playWhenReady = true
        Playback.displayMillis(item)?.let { ms ->
            delay(ms)
            onFinished()
        }
    }

    DisposableEffect(Unit) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) onFinished()
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
        val bmp = withContext(Dispatchers.IO) {
            if (localFile != null) {
                PdfRendering.renderFirstPageFromFile(localFile)
            } else {
                item.signedUrl?.let { PdfRendering.renderFirstPage(context, it) }
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
