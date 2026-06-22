package com.mastersignage.player.ui.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mastersignage.player.data.PairingRepository
import com.mastersignage.player.data.model.PairingStatusResponse
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

sealed interface PairingUiState {
    /** Reaching the server / requesting a code. */
    object Connecting : PairingUiState

    /** A code is displayed; we are polling for the admin to pair it. */
    data class WaitingForPairing(val code: String, val expiresAt: String?) : PairingUiState

    /** Pairing completed — the device token has been stored. */
    object Paired : PairingUiState

    /** The server was unreachable; offer a retry. */
    data class Error(val message: String) : PairingUiState
}

/**
 * Drives the first-run pairing flow: request a code, display it, and poll until
 * an admin binds it to a screen (then store the device token). Expired codes are
 * automatically re-minted. Polling stops when the ViewModel is cleared.
 */
class PairingViewModel(private val repository: PairingRepository) : ViewModel() {

    private val _state = MutableStateFlow<PairingUiState>(PairingUiState.Connecting)
    val state: StateFlow<PairingUiState> = _state.asStateFlow()

    private var loop: Job? = null

    init {
        begin()
    }

    /** (Re)start the pairing loop from scratch. */
    fun begin() {
        loop?.cancel()
        loop = viewModelScope.launch { runPairingLoop() }
    }

    fun retry() = begin()

    private suspend fun runPairingLoop() {
        while (coroutineContext.isActive) {
            _state.value = PairingUiState.Connecting
            val started = try {
                repository.startPairing()
            } catch (e: Exception) {
                _state.value = PairingUiState.Error(e.message ?: "Could not reach the server.")
                return
            }
            _state.value = PairingUiState.WaitingForPairing(started.code, started.expiresAt)

            var needNewCode = false
            while (!needNewCode && coroutineContext.isActive) {
                delay(POLL_INTERVAL_MS)
                val resp = try {
                    repository.pollStatus()
                } catch (e: Exception) {
                    null // transient network error — keep polling
                }
                when (resp?.status) {
                    PairingStatusResponse.PAIRED -> {
                        _state.value = PairingUiState.Paired
                        return
                    }
                    PairingStatusResponse.EXPIRED, PairingStatusResponse.REVOKED -> needNewCode = true
                    else -> Unit // pending
                }
            }
        }
    }

    override fun onCleared() {
        loop?.cancel()
    }

    private companion object {
        const val POLL_INTERVAL_MS = 3_000L
    }
}
