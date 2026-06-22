package com.mastersignage.player.ui.pairing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mastersignage.player.ui.AppViewModelFactory

/**
 * First-run pairing surface. TV-friendly: large type, high contrast, the code
 * front-and-center, and a single focusable Retry control on error.
 */
@Composable
fun PairingScreen(
    factory: AppViewModelFactory,
    sessionKey: Int = 0,
    onPaired: () -> Unit,
) {
    val vm: PairingViewModel = viewModel(key = "pairing-$sessionKey", factory = factory)
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(state) {
        if (state is PairingUiState.Paired) onPaired()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(56.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                text = "MasterSignage",
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "TV Player",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )

            when (val s = state) {
                is PairingUiState.Connecting -> {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    Text(
                        "Connecting…",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                is PairingUiState.WaitingForPairing -> {
                    Text(
                        "Enter this code in the MasterSignage dashboard to pair this screen.",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(20.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .padding(horizontal = 48.dp, vertical = 24.dp),
                    ) {
                        Text(
                            text = s.code,
                            fontSize = 88.sp,
                            color = MaterialTheme.colorScheme.secondary,
                            style = MaterialTheme.typography.displayLarge,
                        )
                    }
                    Text(
                        "Waiting for pairing… the code refreshes automatically when it expires.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }

                is PairingUiState.Paired -> {
                    Text(
                        "Paired! Starting playback…",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                    )
                }

                is PairingUiState.Error -> {
                    Text(
                        "Can't reach MasterSignage",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        s.message,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Button(onClick = vm::retry) {
                        Text("Retry", fontSize = 22.sp)
                    }
                }
            }
        }
    }
}
