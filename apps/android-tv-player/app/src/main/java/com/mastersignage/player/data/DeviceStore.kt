package com.mastersignage.player.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * Local persistent state for the player: a stable device id, the in-flight
 * pairing secret/code, and (after pairing) the device token + bound screen.
 *
 * Storage is **encrypted at rest** via Jetpack Security's
 * [EncryptedSharedPreferences] (AES-256, key held in the Android Keystore) on
 * API 23+. On API 21–22 — where Keystore-backed EncryptedSharedPreferences is
 * unavailable — or if Keystore initialisation fails, it transparently falls back
 * to plain SharedPreferences (logged once). Sensitive values: device token,
 * pairing secret, paired screen id, device id.
 *
 * A one-time migration moves any legacy Phase-6 plaintext values into the
 * encrypted store and then wipes the plaintext file. All storage goes through
 * this single abstraction so the backing store is an implementation detail.
 */
class DeviceStore(context: Context) {

    private val prefs: SharedPreferences
    /** True when the active store is Keystore-encrypted (false on the plain fallback). */
    val isSecureStorage: Boolean

    init {
        val appContext = context.applicationContext
        val encrypted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                buildEncryptedPrefs(appContext)
            } catch (e: Exception) {
                Log.w(TAG, "EncryptedSharedPreferences unavailable; using plain storage.", e)
                null
            }
        } else {
            null
        }

        if (encrypted != null) {
            prefs = encrypted
            isSecureStorage = true
            migrateLegacyPlaintext(appContext, encrypted)
        } else {
            prefs = appContext.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
            isSecureStorage = false
        }
    }

    /** Stable, self-generated device id (created once, reused across re-pairs). */
    val deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_DEVICE_ID, it).apply()
        }

    var deviceToken: String?
        get() = prefs.getString(KEY_DEVICE_TOKEN, null)
        set(value) = prefs.edit().putStringOrRemove(KEY_DEVICE_TOKEN, value).apply()

    var pairingSecret: String?
        get() = prefs.getString(KEY_PAIRING_SECRET, null)
        set(value) = prefs.edit().putStringOrRemove(KEY_PAIRING_SECRET, value).apply()

    var pairingCode: String?
        get() = prefs.getString(KEY_PAIRING_CODE, null)
        set(value) = prefs.edit().putStringOrRemove(KEY_PAIRING_CODE, value).apply()

    var screenId: String?
        get() = prefs.getString(KEY_SCREEN_ID, null)
        set(value) = prefs.edit().putStringOrRemove(KEY_SCREEN_ID, value).apply()

    var screenName: String?
        get() = prefs.getString(KEY_SCREEN_NAME, null)
        set(value) = prefs.edit().putStringOrRemove(KEY_SCREEN_NAME, value).apply()

    val isPaired: Boolean
        get() = !deviceToken.isNullOrBlank() && !screenId.isNullOrBlank()

    /** Persist a completed pairing (token + bound screen) and clear in-flight pairing data. */
    fun savePairing(token: String, screenId: String, screenName: String?) {
        prefs.edit()
            .putString(KEY_DEVICE_TOKEN, token)
            .putString(KEY_SCREEN_ID, screenId)
            .putStringOrRemove(KEY_SCREEN_NAME, screenName)
            .remove(KEY_PAIRING_SECRET)
            .remove(KEY_PAIRING_CODE)
            .apply()
    }

    /** Forget the pairing (token revoked / unpaired). Keeps the stable device id. */
    fun clearPairing() {
        prefs.edit()
            .remove(KEY_DEVICE_TOKEN)
            .remove(KEY_SCREEN_ID)
            .remove(KEY_SCREEN_NAME)
            .remove(KEY_PAIRING_SECRET)
            .remove(KEY_PAIRING_CODE)
            .apply()
    }

    @RequiresApi(Build.VERSION_CODES.M)
    private fun buildEncryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            SECURE_PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** Copy any legacy plaintext values into the encrypted store, then wipe the plaintext file. */
    private fun migrateLegacyPlaintext(context: Context, target: SharedPreferences) {
        val legacy = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
        if (legacy.all.isEmpty()) return
        val editor = target.edit()
        for (key in ALL_KEYS) {
            val value = legacy.getString(key, null)
            if (value != null && target.getString(key, null) == null) {
                editor.putString(key, value)
            }
        }
        editor.apply()
        legacy.edit().clear().apply()
        Log.i(TAG, "Migrated legacy plaintext player state into encrypted storage.")
    }

    private fun SharedPreferences.Editor.putStringOrRemove(key: String, value: String?) =
        if (value == null) remove(key) else putString(key, value)

    private companion object {
        const val TAG = "DeviceStore"
        const val LEGACY_PREFS = "ms_player" // Phase 6 plaintext file (pre-hardening)
        const val SECURE_PREFS = "ms_player_secure"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_TOKEN = "device_token"
        const val KEY_PAIRING_SECRET = "pairing_secret"
        const val KEY_PAIRING_CODE = "pairing_code"
        const val KEY_SCREEN_ID = "screen_id"
        const val KEY_SCREEN_NAME = "screen_name"
        val ALL_KEYS = listOf(
            KEY_DEVICE_ID, KEY_DEVICE_TOKEN, KEY_PAIRING_SECRET, KEY_PAIRING_CODE, KEY_SCREEN_ID, KEY_SCREEN_NAME,
        )
    }
}
