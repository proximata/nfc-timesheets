package io.github.qwadratic.nfctimesheets.checks

/**
 * A PHYSICAL CARD, FAKED, SO THE WRITE ORDER CAN BE ASSERTED OFF-DEVICE.
 *
 * nfc/TagWriter.kt was committed with nothing exercising it. It could not be: it imports
 * `android.nfc`, so it does not compile on a JVM, and NFC hardware does not exist on an
 * emulator — which left the ONE class in this repo that modifies a physical object as the
 * one class no check had ever loaded. `core/NdefTag` was covered, but NdefTag only decides;
 * whether TagWriter asks it BEFORE writing, or after, or at all, was a claim in a comment.
 *
 * So the Android surface TagWriter touches is stubbed (checks/fake/android-nfc*.kt), the
 * real TagWriter.kt is compiled against the stub, and checks/tag-writer-check.kt drives it.
 * What that buys, and it is the whole reason this file exists:
 *
 *   - THE ORDER IS OBSERVED, not read. Every call TagWriter makes lands in [TagBus.calls]
 *     in sequence, so "capacity is checked before any write" is an assertion about a list,
 *     not about the shape of the source.
 *   - A REFUSAL CAN BE PROVEN TO TOUCH NOTHING. `writeNdefMessage` absent from the log is
 *     the only honest form of "the 46-byte card was not written to".
 *   - `makeReadOnly` THROWS. Tags stay unlocked (decision-15); the stub makes calling it a
 *     crash on every path the harness drives, which is a stronger statement than grep.
 *   - `cachedNdefMessage` THROWS TOO. It is the dispatch-time cache — reading it back
 *     through that would compare our bytes against what the card said BEFORE the write, and
 *     a card that already held our URI would "verify" with no write having happened.
 *
 * WHAT THIS IS NOT: a phone. It cannot prove the platform's own NDEF encoder agrees with
 * ours, that a real NTAG213 reports maxSize 137, or that anything survives the tag leaving
 * the field mid-write. See android/README.md § what is unproven.
 */
class FakeCard(
    /** `Ndef.getMaxSize()` — the NDEF MESSAGE capacity, not the raw memory size. */
    val capacity: Int,
    val writable: Boolean = true,
    /** false = `Ndef.get()` returns null: not NDEF-formatted. */
    val ndefCapable: Boolean = true,
    /** Only consulted when [ndefCapable] is false, to make the refusal honest. */
    val formattable: Boolean = false,
    /** What the card held BEFORE this write. The `cachedNdefMessage` trap needs this. */
    val initial: ByteArray? = null,
    /** Non-null = `connect()` throws this exception class name. */
    val connectThrows: String? = null,
    /** Non-null = `writeNdefMessage()` throws it. The card is then left holding [initial]. */
    val writeThrows: String? = null,
    /**
     * Non-null = the read-back itself throws, rather than returning bytes.
     *
     * The read-back ONLY. There are two reads of the card now — the overwrite guard reads
     * what the card already says BEFORE writing (TASK-220), and the verify reads it after —
     * and they must be able to fail independently, or a single flag would silently move the
     * failure to whichever read happens to come first. See [preReadThrows].
     */
    val readThrows: String? = null,
    /** Non-null = the read BEFORE the write throws. The card is untouched either way. */
    val preReadThrows: String? = null,
    /**
     * What the card holds AFTER a successful write. `null` = the read comes back empty.
     * The default is an honest card: it holds what it was given.
     */
    val onWrite: (ByteArray) -> ByteArray? = { it },
) {
    /** Mutated by the stub when a write lands. */
    var content: ByteArray? = initial

    /** Set by the stub the moment a write lands, so a read knows which read it is. */
    var written: Boolean = false
}

/** The one card currently presented, and every call made to it, in order. */
object TagBus {
    var card: FakeCard = FakeCard(capacity = 137)
    val calls: MutableList<String> = mutableListOf()

    fun present(c: FakeCard) {
        card = c
        calls.clear()
    }

    fun log(call: String) {
        calls.add(call)
    }

    /** True if the card was written to at all — the question every refusal has to answer. */
    fun wroteAnything(): Boolean = calls.any { it.startsWith("writeNdefMessage") }

    fun trace(): String = calls.joinToString(" -> ")
}

/** Thrown by the stubs for the calls that must never happen. Not an app exception. */
class ForbiddenCall(message: String) : Error(message)
