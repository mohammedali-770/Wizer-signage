package com.wizer.signage

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import com.wizer.signage.monitoring.ScreenCaptureController
import com.wizer.signage.system.AndroidKioskEnvironment
import com.wizer.signage.system.KioskController
import com.wizer.signage.ui.AppViewModelFactory
import com.wizer.signage.ui.pairing.PairingScreen
import com.wizer.signage.ui.player.PlayerScreen
import com.wizer.signage.ui.theme.WizerSignageTheme

/**
 * Entry point for the Wizer Signage TV player.
 *
 * Renders full-screen and immersive, then routes between the pairing flow and
 * the signage player based on whether a device token is stored. Kiosk behaviour
 * (immersive reinforcement, keep-awake, accidental-Back suppression, and — on an
 * MDM-allowlisted device — Android lock task) is applied by [KioskController]
 * only while the device is **paired** (the active signage experience), never on
 * the pairing/setup screen. See docs/android-player.md (Kiosk mode).
 */
class MainActivity : ComponentActivity() {

    private lateinit var container: PlayerContainer
    private lateinit var kiosk: KioskController

    /** Hoisted so the Activity lifecycle can drive kiosk state. Player route is
     *  foreground exactly when paired (the paired route IS the player). */
    private var paired: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Expose this window for best-effort screenshot capture (Phase 8).
        ScreenCaptureController.attach(window)

        container = PlayerContainer(applicationContext)
        paired = container.isPaired
        kiosk = KioskController(
            env = AndroidKioskEnvironment(this),
            kioskEnabledProvider = { container.softKioskEnabled },
            onError = { msg, e -> android.util.Log.w("KioskController", msg, e) },
        )
        val factory = AppViewModelFactory(container)

        setContent {
            WizerSignageTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    PlayerApp(
                        container = container,
                        factory = factory,
                        softKioskEnabled = container.softKioskEnabled,
                        onPairedChanged = { p ->
                            paired = p
                            kiosk.onPairedChanged(p)
                        },
                    )
                }
            }
        }

        // Initial apply (keep-awake + immersive + lock task if allowlisted+playing).
        kiosk.onPairedChanged(paired)
    }

    override fun onResume() {
        super.onResume()
        kiosk.onResume(paired)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // Reapply immersive after a transient system-bar reveal / focus return.
            kiosk.onWindowFocusGained(paired)
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
 *
 * Reports paired transitions up to the Activity so [KioskController] can react.
 * The soft-kiosk Back suppression is a Compose [BackHandler] present ONLY on the
 * player route (paired), so the pairing/setup screen keeps normal Back/DPAD
 * navigation and an unpaired device is never trapped.
 */
@Composable
fun PlayerApp(
    container: PlayerContainer,
    factory: AppViewModelFactory,
    softKioskEnabled: Boolean,
    onPairedChanged: (Boolean) -> Unit,
) {
    var paired by remember { mutableStateOf(container.isPaired) }
    var sessionKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(paired) { onPairedChanged(paired) }

    if (paired) {
        // Consume accidental Back during active signage playback ONLY when soft
        // kiosk is enabled. Intercepts Back only — never Home, Volume, Power,
        // Input/Source, or DPAD. Disabling soft kiosk restores normal Back (a
        // supported technician exit on an unmanaged TV).
        BackHandler(enabled = softKioskEnabled) { /* swallow: keep the player open */ }
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
