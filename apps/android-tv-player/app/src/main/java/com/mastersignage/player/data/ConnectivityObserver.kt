package com.mastersignage.player.data

import android.content.Context
import android.net.ConnectivityManager

/** Minimal network-availability check (Phase 7). Uses the legacy API for broad
 * Android TV compatibility (minSdk 21). Requires ACCESS_NETWORK_STATE. */
class ConnectivityObserver(context: Context) {

    private val cm =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    @Suppress("DEPRECATION")
    fun isOnline(): Boolean {
        val info = cm.activeNetworkInfo ?: return false
        return info.isConnected
    }
}
