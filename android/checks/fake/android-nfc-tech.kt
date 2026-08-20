package android.nfc.tech

import android.nfc.NdefMessage
import android.nfc.Tag
import io.github.qwadratic.nfctimesheets.checks.ForbiddenCall
import io.github.qwadratic.nfctimesheets.checks.TagBus

/**
 * STUB. `android.nfc.tech.Ndef` as far as nfc/TagWriter.kt uses it — plus the two members
 * it must NEVER use, which are present so that using them is a crash and not a review note.
 *
 * Every call is recorded in [TagBus.calls] before it does anything, so the harness asserts
 * the ORDER TagWriter actually performed, not the order the source reads in.
 */
class Ndef private constructor() {

    /**
     * `getMaxSize()` — the NDEF message capacity. Recorded, because "capacity was read
     * before the write" is half of what the harness is proving.
     */
    val maxSize: Int
        get() {
            TagBus.log("getMaxSize")
            return TagBus.card.capacity
        }

    val isWritable: Boolean
        get() {
            TagBus.log("isWritable")
            return TagBus.card.writable
        }

    fun connect() {
        TagBus.log("connect")
        TagBus.card.connectThrows?.let { throw java.io.IOException(it) }
    }

    fun close() {
        TagBus.log("close")
    }

    fun writeNdefMessage(message: NdefMessage) {
        // The BYTES are logged, not just the fact of a write: the harness asserts that what
        // reached the card is the exact array core/NdefTag planned, with nothing recomputed
        // in between.
        val bytes = message.toByteArray()
        TagBus.log("writeNdefMessage[${bytes.joinToString("") { "%02x".format(it) }}]")
        TagBus.card.writeThrows?.let { throw java.io.IOException(it) }
        TagBus.card.content = TagBus.card.onWrite(bytes)
    }

    /** `getNdefMessage()` — RE-READS the card. This is the one the read-back must use. */
    val ndefMessage: NdefMessage?
        get() {
            TagBus.log("getNdefMessage")
            TagBus.card.readThrows?.let { throw java.io.IOException(it) }
            val content = TagBus.card.content ?: return null
            return NdefMessage(content)
        }

    /**
     * THE DISPATCH-TIME CACHE. What the tag said when Android handed it over, which for a
     * card that already held our URI is our URI — so verifying against this passes without
     * a write having happened. Calling it is a crash here, on every path the harness drives.
     */
    val cachedNdefMessage: NdefMessage?
        get() = throw ForbiddenCall("cachedNdefMessage: the read-back must RE-READ the card")

    /**
     * IRREVERSIBLE. Tags stay UNLOCKED (decision-15) as migration insurance, and locking
     * buys nothing anyway: a serial and a URL are both public and neither authenticates
     * anybody — the worker comes from the session. A grep proves this file does not contain
     * the call; this proves no path the harness drives reaches it.
     */
    fun makeReadOnly(): Boolean =
        throw ForbiddenCall("makeReadOnly: tags stay unlocked (decision-15) and locking cannot be undone")

    fun canMakeReadOnly(): Boolean =
        throw ForbiddenCall("canMakeReadOnly: nothing may even ASK about locking a tag")

    companion object {
        @JvmStatic
        fun get(tag: Tag): Ndef? {
            TagBus.log("Ndef.get")
            return if (TagBus.card.ndefCapable) Ndef() else null
        }
    }
}

/** Stub. Looked up only so a not-NDEF refusal can say which kind of not-NDEF it is. */
class NdefFormatable private constructor() {
    companion object {
        @JvmStatic
        fun get(tag: Tag): NdefFormatable? {
            TagBus.log("NdefFormatable.get")
            return if (TagBus.card.formattable) NdefFormatable() else null
        }
    }
}
