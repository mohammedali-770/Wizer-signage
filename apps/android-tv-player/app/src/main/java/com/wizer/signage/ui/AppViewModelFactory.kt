package com.wizer.signage.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.wizer.signage.PlayerContainer
import com.wizer.signage.ui.pairing.PairingViewModel
import com.wizer.signage.ui.player.PlayerViewModel

/** Builds the pairing/player ViewModels from the shared container. */
class AppViewModelFactory(private val container: PlayerContainer) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(PairingViewModel::class.java) -> PairingViewModel(container.repository) as T
        modelClass.isAssignableFrom(PlayerViewModel::class.java) ->
            PlayerViewModel(
                container.syncManager,
                container.monitoringController,
                container.playbackEventTracker,
                container.proofOfPlayReporter,
            ) as T
        else -> throw IllegalArgumentException("Unknown ViewModel: ${modelClass.name}")
    }
}
