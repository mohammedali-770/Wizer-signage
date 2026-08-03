package com.wizer.signage

import com.wizer.signage.util.PdfRendering
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PDF render sizing ([PdfRendering.renderScale] / [PdfRendering.renderSize]).
 * Pure arithmetic — no bitmap is allocated — so it runs as a plain JVM test.
 *
 * The invariant that matters: no page geometry, however absurd, may produce an
 * allocation big enough to OutOfMemoryError the process and take every screen
 * playing that item down with it.
 */
class PdfRenderScaleTest {

    private val panelW = 1920
    private val panelH = 1080

    /** Page sizes in PdfRenderer points (72 dpi). */
    private val a4 = 595 to 842
    private val a3 = 842 to 1191
    private val a0 = 2384 to 3370

    private fun pixels(size: Pair<Int, Int>): Long = size.first.toLong() * size.second.toLong()

    @Test
    fun aPageIsFittedToThePanel() {
        val (w, h) = PdfRendering.renderSize(a4.first, a4.second, panelW, panelH)
        assertTrue(w <= panelW)
        assertTrue(h <= panelH)
        // Fit, not stretch: the page aspect ratio survives.
        val pageRatio = a4.first.toDouble() / a4.second
        assertEquals(pageRatio, w.toDouble() / h, 0.01)
    }

    @Test
    fun everyRealisticPageStaysUnderThePixelCap() {
        for (page in listOf(a4, a3, a0, 200 to 200, 5_000 to 5_000, 20_000 to 20_000)) {
            val size = PdfRendering.renderSize(page.first, page.second, panelW, panelH)
            assertTrue(
                "page $page produced ${pixels(size)} px",
                pixels(size) <= PdfRendering.MAX_RENDER_PIXELS,
            )
        }
    }

    @Test
    fun anA0PageIsNoLongerA128MbAllocation() {
        // The old code rendered page.width*2 x page.height*2 as ARGB_8888.
        val old = pixels((a0.first * 2) to (a0.second * 2)) * 4
        val now = pixels(PdfRendering.renderSize(a0.first, a0.second, panelW, panelH)) * 2
        assertTrue("old=$old now=$now", old > 100L * 1024 * 1024)
        assertTrue("now=$now", now <= 8L * 1024 * 1024)
    }

    @Test
    fun anAbsurdPageOnAnAbsurdPanelIsStillCapped() {
        // Belt and braces: even if a device reports a nonsense display size, the
        // pixel cap — not the panel — is the binding constraint.
        val size = PdfRendering.renderSize(30_000, 30_000, 100_000, 100_000)
        assertTrue(pixels(size) <= PdfRendering.MAX_RENDER_PIXELS)
    }

    @Test
    fun smallPagesAreNotUpscaledBeyondTheLimit() {
        val scale = PdfRendering.renderScale(10, 10, panelW, panelH)
        assertEquals(PdfRendering.MAX_RENDER_SCALE, scale, 0.0001f)
    }

    @Test
    fun aMissingPanelSizeFallsBackTo1080p() {
        assertEquals(
            PdfRendering.renderSize(a4.first, a4.second, PdfRendering.DEFAULT_TARGET_WIDTH, PdfRendering.DEFAULT_TARGET_HEIGHT),
            PdfRendering.renderSize(a4.first, a4.second, 0, 0),
        )
        assertEquals(
            PdfRendering.renderSize(a4.first, a4.second, PdfRendering.DEFAULT_TARGET_WIDTH, PdfRendering.DEFAULT_TARGET_HEIGHT),
            PdfRendering.renderSize(a4.first, a4.second, -1, -1),
        )
    }

    @Test
    fun degeneratePageDimensionsNeverProduceAnEmptyBitmap() {
        for (page in listOf(0 to 0, -1 to 100, 100 to 0, 1 to 1)) {
            val (w, h) = PdfRendering.renderSize(page.first, page.second, panelW, panelH)
            assertTrue("page $page -> ${w}x$h", w >= 1 && h >= 1)
        }
    }
}
