package com.wizer.signage.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.net.URL
import kotlin.math.sqrt

/**
 * Renders the FIRST page of a PDF to a bitmap using the framework PdfRenderer
 * (API 21+).
 *
 * On-disk caching SHIPS: `renderFirstPageFromFile` reads straight from the
 * offline cache, so a PDF plays without network like any other cached item.
 * What is still outstanding is multi-page rotation using
 * `pdfPageDurationSeconds` — the player shows the first page for the item's
 * whole duration, or a placeholder if rendering fails.
 */
object PdfRendering {

    /**
     * Hard ceiling on the rendered bitmap. The page size is attacker-supplied in
     * practice (anyone uploading content picks it): an A0 poster at the old fixed
     * 2x ARGB_8888 scale allocates ~128 MB and throws OutOfMemoryError, which is
     * an Error — not caught by `catch (Exception)` — so it killed the process and
     * every screen playing that PDF. 4 MP is already well above a 4K panel.
     */
    const val MAX_RENDER_PIXELS = 4_000_000L

    /** Never upscale a small page beyond this — there is no detail to recover. */
    const val MAX_RENDER_SCALE = 2.0f

    /** Assumed panel size when the caller cannot supply one (1080p). */
    const val DEFAULT_TARGET_WIDTH = 1920
    const val DEFAULT_TARGET_HEIGHT = 1080

    /**
     * Render scale that fits the page to the panel, capped by [MAX_RENDER_SCALE]
     * and then by [MAX_RENDER_PIXELS] so no page geometry can blow the heap.
     */
    fun renderScale(pageWidth: Int, pageHeight: Int, targetWidth: Int, targetHeight: Int): Float {
        if (pageWidth <= 0 || pageHeight <= 0) return 1f
        val tw = if (targetWidth > 0) targetWidth else DEFAULT_TARGET_WIDTH
        val th = if (targetHeight > 0) targetHeight else DEFAULT_TARGET_HEIGHT
        val fit = minOf(tw.toFloat() / pageWidth, th.toFloat() / pageHeight)
        val scale = minOf(fit, MAX_RENDER_SCALE)
        val pixels = pageWidth.toDouble() * pageHeight.toDouble() * scale * scale
        return if (pixels > MAX_RENDER_PIXELS) scale * sqrt(MAX_RENDER_PIXELS / pixels).toFloat() else scale
    }

    /**
     * Bitmap dimensions for a page on a given panel (never below 1x1). Truncates
     * rather than rounds so the result can never edge back over the pixel cap.
     */
    fun renderSize(pageWidth: Int, pageHeight: Int, targetWidth: Int, targetHeight: Int): Pair<Int, Int> {
        val scale = renderScale(pageWidth, pageHeight, targetWidth, targetHeight)
        return Pair(
            (pageWidth * scale).toInt().coerceAtLeast(1),
            (pageHeight * scale).toInt().coerceAtLeast(1),
        )
    }

    /**
     * Render the first page of a PDF already on disk (e.g. a cached asset), sized
     * for the panel it will be shown on. Returns null on ANY failure so a bad
     * asset degrades to a skipped item instead of taking the screen down.
     */
    fun renderFirstPageFromFile(
        file: File,
        targetWidth: Int = DEFAULT_TARGET_WIDTH,
        targetHeight: Int = DEFAULT_TARGET_HEIGHT,
    ): Bitmap? =
        try {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                PdfRenderer(pfd).use { renderer ->
                    if (renderer.pageCount < 1) null
                    else renderer.openPage(0).use { page ->
                        val (width, height) = renderSize(page.width, page.height, targetWidth, targetHeight)
                        renderPage(page, width, height)
                    }
                }
            }
        } catch (t: Throwable) {
            // Throwable, not Exception: an oversized page throws OutOfMemoryError.
            // Cancellation still has to propagate — the caller renders on Dispatchers.IO.
            if (t is kotlinx.coroutines.CancellationException) throw t
            null
        }

    /** Download a PDF (online only) to a temp file and render its first page. */
    fun renderFirstPage(
        context: Context,
        url: String,
        targetWidth: Int = DEFAULT_TARGET_WIDTH,
        targetHeight: Int = DEFAULT_TARGET_HEIGHT,
    ): Bitmap? {
        var file: File? = null
        return try {
            file = File.createTempFile("ms_pdf", ".pdf", context.cacheDir)
            URL(url).openStream().use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            renderFirstPageFromFile(file, targetWidth, targetHeight)
        } catch (t: Throwable) {
            if (t is kotlinx.coroutines.CancellationException) throw t
            null
        } finally {
            file?.delete()
        }
    }

    /**
     * RGB_565 halves the bitmap footprint and signage pages are opaque, but
     * PdfRenderer.render() rejects every config other than ARGB_8888 on most
     * platform builds — fall back rather than lose PDF playback entirely.
     */
    private fun renderPage(page: PdfRenderer.Page, width: Int, height: Int): Bitmap {
        val cheap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        try {
            cheap.eraseColor(Color.WHITE)
            page.render(cheap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            return cheap
        } catch (e: IllegalArgumentException) {
            cheap.recycle()
        }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        return bitmap
    }
}
