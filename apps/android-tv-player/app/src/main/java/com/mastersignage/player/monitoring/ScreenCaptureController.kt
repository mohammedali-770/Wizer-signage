package com.mastersignage.player.monitoring

import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.Window
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import kotlin.coroutines.resume

/**
 * Best-effort screenshot capture of the app's OWN window via PixelCopy (Phase 8).
 *
 * LIMITATION: this captures the player's own window content (image/text/web).
 * Capturing arbitrary system screens, or video on a secure surface, is NOT
 * possible for a normal Android TV app without MediaProjection consent or system
 * privileges — those return null (the command reports FAILED with a reason).
 * PixelCopy.request(Window, …) requires API 26+; older devices return null.
 */
object ScreenCaptureController {

    private var windowRef: WeakReference<Window>? = null

    fun attach(window: Window) {
        windowRef = WeakReference(window)
    }

    fun detach() {
        windowRef = null
    }

    /** Capture the current window as a JPEG, or null if unsupported/unavailable. */
    suspend fun captureJpeg(quality: Int = 80): ByteArray? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        val window = windowRef?.get() ?: return null
        val view = window.decorView
        val width = view.width
        val height = view.height
        if (width <= 0 || height <= 0) return null

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        try {
            return suspendCancellableCoroutine { cont ->
                try {
                    PixelCopy.request(
                        window,
                        bitmap,
                        { result ->
                            if (result == PixelCopy.SUCCESS) {
                                val out = ByteArrayOutputStream()
                                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
                                cont.resume(out.toByteArray())
                            } else {
                                cont.resume(null)
                            }
                        },
                        Handler(Looper.getMainLooper()),
                    )
                } catch (e: Exception) {
                    cont.resume(null)
                }
            }
        } finally {
            // Bitmaps hold native memory — always release, even on cancellation/error.
            bitmap.recycle()
        }
    }
}
