package com.wizer.signage

import com.wizer.signage.data.ManifestStore
import com.wizer.signage.data.model.ManifestItem
import com.wizer.signage.data.model.PlaybackManifest
import com.wizer.signage.util.Checksums
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ManifestStoreTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun savesAndLoadsTheLastGoodManifest() {
        val store = ManifestStore(tmp.root)
        assertNull(store.loadLastGood())

        val manifest = PlaybackManifest(
            screenId = "s1",
            sourceType = PlaybackManifest.SOURCE_SCHEDULE,
            items = listOf(ManifestItem(contentId = "c1", type = ManifestItem.TYPE_IMAGE, version = "v1", title = "Banner")),
        )
        store.saveLastGood(manifest)

        val loaded = store.loadLastGood()
        assertEquals("s1", loaded?.screenId)
        assertEquals(1, loaded?.items?.size)
        assertEquals("c1", loaded?.items?.get(0)?.contentId)
        assertEquals("v1", loaded?.items?.get(0)?.version)
    }
}

class ChecksumsTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun sha256MatchesAKnownVector() {
        // sha256("abc")
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            Checksums.sha256("abc".toByteArray()),
        )
    }

    @Test
    fun verifyChecksBothSizeAndChecksum() {
        val file = File(tmp.root, "x")
        file.writeBytes("abc".toByteArray())
        val good = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

        assertTrue(Checksums.verify(file, 3L, good))
        assertFalse("wrong size fails", Checksums.verify(file, 99L, good))
        assertFalse("wrong checksum fails", Checksums.verify(file, null, "deadbeef"))
        assertTrue("no expectations passes", Checksums.verify(file, null, null))
    }
}
