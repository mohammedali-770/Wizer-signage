package com.wizer.signage.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.net.URL

/**
 * Minimal PDF rendering for the Phase 6 foundation: download the file and render
 * its FIRST page to a bitmap using the framework PdfRenderer (API 21+).
 *
 * Multi-page rotation (using `pdfPageDurationSeconds`) and on-disk caching are
 * deferred to Phase 7/8; today the player shows the first page for the item's
 * duration, or a placeholder if rendering fails.
 */
object PdfRendering {

    private const val RENDER_SCALE = 2

    /** Render the first page of a PDF already on disk (e.g. a cached asset). */
    fun renderFirstPageFromFile(file: File): Bitmap? =
        try {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                PdfRenderer(pfd).use { renderer ->
                    if (renderer.pageCount < 1) null
                    else renderer.openPage(0).use { page ->
                        val bitmap = Bitmap.createBitmap(
                            page.width * RENDER_SCALE,
                            page.height * RENDER_SCALE,
                            Bitmap.Config.ARGB_8888,
                        )
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bitmap
                    }
                }
            }
        } catch (e: Exception) {
            null
        }

    /** Download a PDF (online only) to a temp file and render its first page. */
    fun renderFirstPage(context: Context, url: String): Bitmap? {
        var file: File? = null
        return try {
            file = File.createTempFile("ms_pdf", ".pdf", context.cacheDir)
            URL(url).openStream().use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            renderFirstPageFromFile(file)
        } catch (e: Exception) {
            null
        } finally {
            file?.delete()
        }
    }
}
