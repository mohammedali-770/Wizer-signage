package com.mastersignage.player

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.mastersignage.player.monitoring.ScreenCaptureController
import com.mastersignage.player.ui.AppViewModelFactory
import com.mastersignage.player.ui.pairing.PairingScreen
import com.mastersignage.player.ui.player.PlayerScreen
import com.mastersignage.player.ui.theme.MasterSignageTheme

/**
 * Entry point for the MasterSignage TV player (Phase 6).
 *
 * Renders full-screen and immersive, then routes between the pairing flow and
 * the signage player based on whether a device token is stored. Offline cache,
 * heartbeat, screenshots, kiosk, and auto-start arrive in later phases.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersiveMode()

        // Expose this window for best-effort screenshot capture (Phase 8).
        ScreenCaptureController.attach(window)

        val container = PlayerContainer(applicationContext)
        val factory = AppViewModelFactory(container)

        setContent {
            MasterSignageTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    PlayerApp(container = container, factory = factory)
                }
            }
        }
    }

    private fun enterImmersiveMode() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            enterImmersiveMode()
        }
    }

    override fun onDestroy() {
        ScreenCaptureController.detach()
        super.onDestroy()
    }
}

/**
 * Top-level router. `sessionKey` bumps on unpair so a re-entered pairing/player
 * screen gets a fresh ViewModel rather than a stale Activity-scoped one.
 */
@Composable
fun PlayerApp(container: PlayerContainer, factory: AppViewModelFactory) {
    var paired by remember { mutableStateOf(container.isPaired) }
    var sessionKey by remember { mutableIntStateOf(0) }

    if (paired) {
        PlayerScreen(
            factory = factory,
            sessionKey = sessionKey,
            onUnpaired = {
                sessionKey += 1
                paired = false
            },
        )
    } else {
        PairingScreen(
            factory = factory,
            sessionKey = sessionKey,
            onPaired = { paired = true },
        )
    }
}
