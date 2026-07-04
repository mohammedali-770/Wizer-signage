package com.wizer.signage.ui.player

import androidx.lifecycle.ViewModel
import com.wizer.signage.data.SyncManager
import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import com.wizer.signage.monitoring.MonitoringController
import com.wizer.signage.proofofplay.PlaybackEventTracker
import com.wizer.signage.proofofplay.ProofOfPlayReporter
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/**
 * Thin ViewModel over the {@link SyncManager} (offline cache), the
 * {@link MonitoringController} (heartbeat + remote commands), and proof-of-play
 * reporting (Phase 9). The player drives the proof-of-play hooks from its actual
 * advancement loop; reporting is best-effort and never blocks playback.
 */
class PlayerViewModel(
    private val sync: SyncManager,
    private val monitoring: MonitoringController,
    private val tracker: PlaybackEventTracker,
    private val reporter: ProofOfPlayReporter,
) : ViewModel() {

    val manifest: StateFlow<PlaybackManifest?> = sync.activeManifest
    val online: StateFlow<Boolean> = sync.online
    val manifestSource: StateFlow<String> = sync.manifestSource
    val unpaired: StateFlow<Boolean> = sync.unauthorized
    val restartEpoch: StateFlow<Int> = sync.restartEpoch

    init {
        sync.start()
        monitoring.start()
        reporter.start()
    }

    /** Ready local cached file for an item, or null (stream online / skip offline). */
    fun localFile(item: ManifestItem): File? = sync.localFile(item)

    /** Report the item currently on screen (used in heartbeat telemetry). */
    fun reportCurrentItem(item: ManifestItem?) = sync.reportCurrentItem(item)

    // --- Proof-of-play hooks (Phase 9) -------------------------------------

    fun onItemStarted(item: ManifestItem, index: Int) {
        reporter.report(tracker.started(item, index, contextFor(item)))
    }

    fun onItemCompleted() {
        tracker.completed()?.let { reporter.report(it) }
    }

    fun onItemFailed(reason: String?) {
        tracker.failed(reason)?.let { reporter.report(it) }
    }

    /** Close the running item when it is pre-empted (emergency / manifest gone). */
    fun onItemInterrupted() {
        tracker.interrupted()?.let { reporter.report(it) }
    }

    fun onItemSkipped(item: ManifestItem, index: Int) {
        reporter.report(tracker.skipped(item, index, contextFor(item)))
    }

    private fun contextFor(item: ManifestItem): PlaybackEventTracker.Context {
        val m = sync.activeManifest.value
        val online = sync.online.value
        val localPresent = sync.localFile(item) != null
        return if (m != null) {
            PlaybackEventTracker.contextFrom(m, online, localPresent)
        } else {
            PlaybackEventTracker.Context("NONE", null, null, null, null, online, localPresent)
        }
    }

    override fun onCleared() {
        // Close any in-flight item, then stop the loops.
        onItemInterrupted()
        sync.stop()
        monitoring.stop()
        reporter.stop()
    }
}
