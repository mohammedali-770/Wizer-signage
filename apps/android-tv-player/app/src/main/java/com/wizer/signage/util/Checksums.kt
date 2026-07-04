package com.wizer.signage.util

import java.io.File
import java.security.MessageDigest

/** SHA-256 helpers matching the backend's lowercase-hex content checksums. */
object Checksums {

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var read = input.read(buffer)
            while (read >= 0) {
                digest.update(buffer, 0, read)
                read = input.read(buffer)
            }
        }
        return digest.digest().toHex()
    }

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

    /** Verify a downloaded file against an optional expected size + checksum. */
    fun verify(file: File, expectedSize: Long?, expectedChecksum: String?): Boolean {
        if (!file.exists()) return false
        if (expectedSize != null && expectedSize > 0 && file.length() != expectedSize) return false
        if (expectedChecksum != null && !sha256(file).equals(expectedChecksum, ignoreCase = true)) return false
        return true
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
