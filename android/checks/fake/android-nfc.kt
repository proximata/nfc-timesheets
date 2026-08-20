package android.nfc

/**
 * STUB. Enough of `android.nfc` for nfc/TagWriter.kt to compile and run on a plain JVM.
 * Never shipped, never on the app's compile path — only checks/run.sh compiles this.
 *
 * The package name is the real one on purpose: TagWriter's imports are NOT edited to make
 * it testable. The class under test is the byte-identical file that ships.
 */
class Tag(val id: ByteArray, val techList: Array<String>)

/** What the platform throws for bytes that are not a well-formed NDEF message. */
class FormatException(message: String) : Exception(message)

/**
 * A single NDEF record, and THE TAP-SIDE DECODER.
 *
 * This is not decoration on the stub. NfcTapActivity does not use core/NdefTag to read a
 * tapped tag — on Android <= 15 it pulls the URI out with the PLATFORM's
 * `NdefRecord.toUri()`, and on Android 16+ the NFC service does the same expansion before
 * it ever fires ACTION_VIEW. So the bytes we burn are written by one decoder and read back
 * in the field by a different one, and "a tag we write parses like a tag on the wall" is a
 * claim about those two AGREEING.
 *
 * [toUri] therefore implements the NFC Forum RTD-URI abbreviation table IN FULL, all 36
 * entries, exactly as the platform does — and deliberately unlike core/NdefTag, which
 * accepts only the five https/http forms and refuses the rest rather than guessing. Two
 * implementations that disagree about `0x23` and agree about `0x04` is the point: the
 * agreement on our card is then a real result and not the same code checked twice.
 */
class NdefRecord(
    val tnf: Int,
    val type: ByteArray,
    val id: ByteArray?,
    val payload: ByteArray,
) {
    /** The URI this record carries, or null if it is not a Well Known 'U' record. */
    fun toUri(): String? {
        if (tnf != 0x01) return null
        if (!type.contentEquals(byteArrayOf(0x55))) return null
        if (payload.isEmpty()) return null
        val prefix = URI_PREFIXES.getOrNull(payload[0].toInt() and 0xFF) ?: return null
        return prefix + payload.copyOfRange(1, payload.size).toString(Charsets.UTF_8)
    }

    private companion object {
        /** NFC Forum RTD-URI 1.0 § 3.2.2, in full. Index = abbreviation code. */
        val URI_PREFIXES = listOf(
            "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
            "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://",
            "nfs://", "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:",
            "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
            "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
            "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
        )
    }
}

/**
 * An NDEF message, parsed and re-serialised INDEPENDENTLY of core/NdefTag.
 *
 * This is the second opinion in TagWriter's `NdefMessage(bytes).toByteArray() == bytes`
 * gate, and it is deliberately LOOSER than NdefTag: it accepts long-form records, ID
 * fields and multiple records, exactly as the platform does. A stub that shared NdefTag's
 * strictness would turn that gate into a tautology.
 *
 * [toByteArray] re-serialises CANONICALLY — short form whenever the payload fits in a byte,
 * an ID field only when there is an id — which is what the platform encoder does. So a
 * long-form encoding of a 60-byte payload round-trips to short form and does NOT compare
 * equal, and TagWriter refuses. That is the real behaviour that gate is buying.
 *
 * NOT MODELLED: chunked records (CF). The platform reassembles them; this throws. Nothing
 * this app writes is chunked, and a chunked record read off a foreign tag is refused by
 * NdefTag anyway, so the difference cannot reach a write.
 */
class NdefMessage(bytes: ByteArray) {

    val records: List<NdefRecord> = parse(bytes)

    fun toByteArray(): ByteArray {
        val out = ArrayList<Byte>()
        for ((i, r) in records.withIndex()) {
            val short = r.payload.size < 256
            var header = r.tnf and 0x07
            if (i == 0) header = header or 0x80          // MB
            if (i == records.size - 1) header = header or 0x40 // ME
            if (short) header = header or 0x10           // SR
            if (r.id != null) header = header or 0x08    // IL
            out.add(header.toByte())
            out.add(r.type.size.toByte())
            if (short) {
                out.add(r.payload.size.toByte())
            } else {
                val n = r.payload.size
                out.add((n ushr 24).toByte()); out.add((n ushr 16).toByte())
                out.add((n ushr 8).toByte()); out.add(n.toByte())
            }
            if (r.id != null) out.add(r.id.size.toByte())
            r.type.forEach { out.add(it) }
            r.id?.forEach { out.add(it) }
            r.payload.forEach { out.add(it) }
        }
        return out.toByteArray()
    }

    private fun parse(bytes: ByteArray): List<NdefRecord> {
        if (bytes.isEmpty()) throw FormatException("empty message")
        val out = ArrayList<NdefRecord>()
        var i = 0
        var seenEnd = false
        while (i < bytes.size) {
            if (seenEnd) throw FormatException("trailing bytes after the last record")
            if (i + 3 > bytes.size) throw FormatException("truncated header")
            val h = bytes[i].toInt() and 0xFF
            val mb = h and 0x80 != 0
            val me = h and 0x40 != 0
            val cf = h and 0x20 != 0
            val sr = h and 0x10 != 0
            val il = h and 0x08 != 0
            val tnf = h and 0x07
            if (out.isEmpty() && !mb) throw FormatException("first record has no MB")
            if (out.isNotEmpty() && mb) throw FormatException("MB on a later record")
            if (cf) throw FormatException("chunked records are not modelled by this stub")
            i++
            val typeLength = bytes[i].toInt() and 0xFF
            i++
            val payloadLength: Int
            if (sr) {
                payloadLength = bytes[i].toInt() and 0xFF
                i++
            } else {
                if (i + 4 > bytes.size) throw FormatException("truncated long payload length")
                payloadLength = ((bytes[i].toInt() and 0xFF) shl 24) or
                    ((bytes[i + 1].toInt() and 0xFF) shl 16) or
                    ((bytes[i + 2].toInt() and 0xFF) shl 8) or
                    (bytes[i + 3].toInt() and 0xFF)
                i += 4
            }
            var idLength = 0
            if (il) {
                if (i >= bytes.size) throw FormatException("truncated id length")
                idLength = bytes[i].toInt() and 0xFF
                i++
            }
            if (i + typeLength + idLength + payloadLength > bytes.size) {
                throw FormatException("record runs past the end of the message")
            }
            val type = bytes.copyOfRange(i, i + typeLength); i += typeLength
            val id = if (il) bytes.copyOfRange(i, i + idLength).also { i += idLength } else null
            val payload = bytes.copyOfRange(i, i + payloadLength); i += payloadLength
            out.add(NdefRecord(tnf, type, id, payload))
            if (me) seenEnd = true
        }
        if (!seenEnd) throw FormatException("no record carried ME")
        return out
    }
}
