package io.github.qwadratic.nfctimesheets.core

/**
 * THE BYTES THAT GO ONTO A PHYSICAL CARD, and the three refusals that must happen before
 * they do.
 *
 * WHY THIS IS PURE KOTLIN AND NOT `NdefRecord.createUri()`. The platform encoder is fine.
 * It is also invisible: it runs on a device, in a stairwell, against a card that is glued
 * to a wall, and if it ever produced something other than what we believe it produces
 * there is no way to find out except by ruining a card. Encoding the record here means
 * android/checks can decode the EXACT byte array that `Ndef.writeNdefMessage` is handed and
 * assert it, on a laptop, with no tag, no phone and no site visit. nfc/TagWriter.kt still
 * hands those bytes to `NdefMessage(byte[])` before writing, so the platform parser gets
 * the last word on validity — it just does not get to choose the bytes.
 *
 * THE SHAPE, fixed by NFC Forum RTD-URI and by what already works on the wall:
 *
 *     D1 01 3C 55 04 <"<ts.tagHost>/t?l=<uuid>" as UTF-8>
 *     ^  ^  ^  ^  ^
 *     |  |  |  |  +-- payload[0]: URI abbreviation 0x04 = "https://"
 *     |  |  |  +----- type: 'U' (0x55). NEVER 'T' (0x54, a Text record): a Text record
 *     |  |  |         carries no URL, so the OS has nothing to match an App Link against
 *     |  |  |         and the tag can never wake a closed app. That is the entire product.
 *     |  |  +-------- payload length, short form
 *     |  +----------- type length (1)
 *     +-------------- MB|ME|SR|TNF=1: first record, last record, short record, Well Known.
 *
 * ONE RECORD, AND NOTHING AFTER IT. MB and ME are both set on the same header byte, so the
 * message is complete at the end of that record. [uriFrom] refuses trailing bytes rather
 * than ignoring them, because "the reader ignored it" is how a tag reads as valid to us and
 * as something else to the next reader.
 *
 * CAPACITY IS A REFUSAL, NOT A WARNING. A tag too small to hold the message must be refused
 * BEFORE `writeNdefMessage` is called — see [plan]. There is no half-write to recover from
 * if the check happens first, and there is no recovering at all if it does not: a write that
 * runs out of room mid-message leaves a card that is neither the old tag nor the new one.
 * The first adopted tag in the field holds 46 bytes and our message needs 64, so this is a
 * case that HAS occurred, not a hypothetical.
 */
object NdefTag {

    /** URI abbreviation code 0x04 — "https://". The only prefix we ever WRITE. */
    private const val PREFIX_HTTPS: Int = 0x04

    /** RTD type byte 'U'. */
    private const val TYPE_URI: Byte = 0x55

    /** Record header bits. */
    private const val FLAG_MB = 0x80
    private const val FLAG_ME = 0x40
    private const val FLAG_CF = 0x20
    private const val FLAG_SR = 0x10
    private const val FLAG_IL = 0x08
    private const val TNF_MASK = 0x07
    private const val TNF_WELL_KNOWN = 0x01

    /**
     * The abbreviations we are willing to DECODE. Deliberately not the full 36-entry table:
     * every entry is a way for two readers to disagree about what a card says, and we only
     * ever write one of them. An unknown code is refused, not guessed.
     */
    private val PREFIXES: Map<Int, String> = mapOf(
        0x00 to "",
        0x01 to "http://www.",
        0x02 to "https://www.",
        0x03 to "http://",
        0x04 to "https://",
    )

    /** Short-record payload ceiling. Our message is ~64 bytes; this can only fire on a bug. */
    private const val MAX_SHORT_PAYLOAD = 255

    // ---- encode ------------------------------------------------------------------

    /**
     * The complete NDEF message for an `https://` URI, or null if it cannot be encoded in
     * the one shape this app writes.
     *
     * Null, never a partial or a fallback encoding: the caller's only correct response to
     * "I cannot encode this" is to refuse the write, and a second encoding path would be a
     * second thing to keep byte-compatible with the cards already on the walls.
     */
    fun message(uri: String?): ByteArray? {
        if (uri.isNullOrEmpty()) return null
        // Lowercase only the scheme for the test: the host is case-insensitive but the
        // path and query are NOT, and normalising them would silently rewrite the uuid.
        if (!uri.regionMatches(0, "https://", 0, 8, ignoreCase = true)) return null
        val rest = uri.substring(8)
        if (rest.isEmpty()) return null
        // A non-ASCII byte is not wrong per RTD-URI, but it is not something we mint, and a
        // card is the wrong place to discover an encoding disagreement.
        if (rest.any { it.code !in 0x21..0x7E }) return null

        val restBytes = rest.toByteArray(Charsets.UTF_8)
        val payloadLength = 1 + restBytes.size
        if (payloadLength > MAX_SHORT_PAYLOAD) return null

        val out = ByteArray(4 + payloadLength)
        out[0] = (FLAG_MB or FLAG_ME or FLAG_SR or TNF_WELL_KNOWN).toByte()
        out[1] = 1 // type length
        out[2] = payloadLength.toByte()
        out[3] = TYPE_URI
        out[4] = PREFIX_HTTPS.toByte()
        restBytes.copyInto(out, 5)
        return out
    }

    // ---- decode ------------------------------------------------------------------

    /**
     * The URI in a single-record NDEF URI message, or null.
     *
     * STRICT ON PURPOSE. This is what the read-back is compared through, and what the check
     * decodes to prove the bytes. Anything it accepts is something it has stopped being able
     * to catch, so it accepts exactly one shape: one Well Known 'U' record, short form, no
     * ID field, no chunking, nothing before it and nothing after it.
     */
    fun uriFrom(message: ByteArray?): String? {
        if (message == null || message.size < 5) return null

        val header = message[0].toInt() and 0xFF
        if (header and FLAG_MB == 0) return null            // not the first record
        if (header and FLAG_ME == 0) return null            // more records follow
        if (header and FLAG_CF != 0) return null            // chunked
        if (header and FLAG_SR == 0) return null            // long form: not what we write
        if (header and FLAG_IL != 0) return null            // has an ID field
        if (header and TNF_MASK != TNF_WELL_KNOWN) return null

        val typeLength = message[1].toInt() and 0xFF
        if (typeLength != 1) return null
        val payloadLength = message[2].toInt() and 0xFF
        if (payloadLength < 1) return null
        if (message[3] != TYPE_URI) return null             // 'T' (Text) lands here

        // EXACT: 4 header bytes + payload and not one byte more. A tag that is longer than
        // its own message is a tag someone else has also written to.
        if (message.size != 4 + payloadLength) return null

        val prefix = PREFIXES[message[4].toInt() and 0xFF] ?: return null
        val rest = message.copyOfRange(5, message.size).toString(Charsets.UTF_8)
        return prefix + rest
    }

    // ---- the write decision -------------------------------------------------------

    /**
     * What a tag presented to the writer is: bytes to write, or a named refusal.
     *
     * Every refusal is a separate case because the operator's next physical action differs:
     * a too-small tag means "peel this one off and use an NTAG213", a read-only tag means
     * "this one is locked, it cannot be used at all", not-NDEF means "hold the phone still
     * and try again, then try formatting".
     */
    sealed interface Plan {
        /** [bytes] is exactly what goes on the card. Nothing recomputes it downstream. */
        data class Write(val bytes: ByteArray, val uri: String, val locationId: String) : Plan {
            // ByteArray in a data class: equals/hashCode would be identity. Nothing compares
            // Plans, but a future caller that did would get a silent wrong answer.
            override fun equals(other: Any?): Boolean = this === other
            override fun hashCode(): Int = System.identityHashCode(this)
        }

        /** The tag holds fewer bytes than the message needs. The 46-byte case. */
        data class TooSmall(val needed: Int, val capacity: Int) : Plan

        /** Locked by a previous owner. Unlocked is our own policy (decision-15), not theirs. */
        data object ReadOnly : Plan

        /** No NDEF at all, and not formattable, or a capacity the platform would not report. */
        data object NotWritable : Plan

        /** We could not encode a message for this id at all — a bug, surfaced not swallowed. */
        data object BadId : Plan
    }

    /**
     * Decide, from facts read off the tag and BEFORE any write.
     *
     * THERE IS NO `uri` PARAMETER, AND THAT IS THE DESIGN. An earlier version took the URI
     * and the id side by side and checked that the id appeared in the URI. That check passes
     * for `https://<host>/t?l=+<uuid>` — the uuid IS in that string — which is a card burnt
     * with a URI this app's own parser then refuses, i.e. exactly the '+' trap that has
     * already bitten this project once, moved onto a wall where it costs a site visit. So
     * the URI is not an argument: it is MINTED here from [tagLink], which always uses the
     * current tag host and never a legacy one, and the caller has nothing left to get wrong.
     *
     * AND THE BYTES GO BACK THROUGH THE PARSER BEFORE THEY GO ONTO THE CARD. [uriFrom] of
     * the exact array we are about to write, fed to the same [TagLink.locationId] a tap
     * uses, must return the same id. A card this app would not accept is not a card this
     * app writes — host, scheme, path, encoding and uuid, all of it, checked as one thing
     * against the bytes rather than against the intention.
     *
     * @param capacity `Ndef.getMaxSize()` — the maximum NDEF MESSAGE size in bytes, which is
     *        the same unit as [Plan.Write.bytes].size. Do not pass the raw memory size: on
     *        NTAG213 that is 180 and the usable message is 137, and the difference is
     *        exactly the size of the mistake this class exists to prevent.
     * @param writable `Ndef.isWritable()`.
     */
    fun plan(tagLink: TagLink, locationId: String?, capacity: Int, writable: Boolean): Plan {
        val id = TagLink.normalizedUuid(locationId) ?: return Plan.BadId
        val uri = tagLink.uriFor(id)?.toString() ?: return Plan.BadId
        val bytes = message(uri) ?: return Plan.BadId
        // The round trip, on the bytes themselves. Not on the string they came from.
        if (tagLink.locationId(uriFrom(bytes)) != id) return Plan.BadId
        // Order matters: a locked tag reports LOCKED even when it is also too small, so the
        // operator is not sent to fetch a bigger tag that would hit the same wall.
        if (!writable) return Plan.ReadOnly
        if (capacity <= 0) return Plan.NotWritable
        if (capacity < bytes.size) return Plan.TooSmall(needed = bytes.size, capacity = capacity)
        return Plan.Write(bytes = bytes, uri = uri, locationId = id)
    }

    // ---- the read-back ------------------------------------------------------------

    /**
     * Did the card come back holding EXACTLY what we wrote?
     *
     * Byte equality, not "does it parse" and not "does it contain the uuid". A tag whose
     * message is our message plus one byte parses fine in most readers and is not our tag;
     * a tag that was truncated mid-write may still contain the uuid. The only question worth
     * asking of a card that is about to be screwed to a wall is whether it is byte-identical
     * to the thing we believe we put there.
     *
     * `null` readBack (the tag moved, the field dropped, the read failed) is a FAILURE. The
     * write may well have succeeded — but we cannot say so, and "probably fine" is how an
     * unverified card gets mounted.
     */
    fun verified(written: ByteArray, readBack: ByteArray?): Boolean {
        if (readBack == null) return false
        return written.contentEquals(readBack)
    }

    /** Lowercase hex, for the check output and for the diagnostic line in the app. */
    fun hex(bytes: ByteArray): String = bytes.joinToString(" ") { "%02x".format(it) }
}
