package io.github.qwadratic.nfctimesheets.nfc

import android.nfc.Tag
import android.nfc.tech.MifareUltralight
import android.nfc.tech.NfcA
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagTlv
import java.io.ByteArrayOutputStream

/**
 * THE FALLBACK READ (decision-58 §2): the raw pages of a Type 2 Tag, when the platform's own
 * `Ndef`/`NdefMessage`/`NdefRecord.toUri()` route answered nothing.
 *
 * SECOND, NEVER FIRST. The platform helper is the read path and stays it; this runs only
 * after it has already produced null, so no card that reads normally today reads through
 * different code tomorrow. What it buys is the case decision-58 was written for: a card
 * written by another platform that is a valid Type 2 Tag which Android's convenience API
 * still declines to parse, leaving an operator holding a dead end.
 *
 * ONE DECODER, NOT TWO. The bytes it extracts go through [TagTlv] and then through the
 * EXISTING [NdefTag.uriFrom] — the same decoder core/NdefTag round-trips every written card
 * through, and the same one android/checks exercises on a laptop. Nothing here decides what a
 * URI means; [io.github.qwadratic.nfctimesheets.core.TagLink] still does that, unchanged.
 *
 * EVERYTHING IS WRAPPED. This talks to a card an operator is holding against a phone, which
 * moves: `TagLostException`, `IOException` and a technology the card does not implement are
 * ordinary events here, not crashes. A partial read is kept and parsed — a terminator TLV
 * usually arrives long before the end of memory, so the read that throws is often the read
 * past the end of a card whose message we already have.
 */
object RawTagIo {

    /** Type 2 Tag data area starts at page 4; pages 0-3 are UID, lock bytes and the CC. */
    private const val FIRST_DATA_PAGE = 4

    /**
     * Stop after this much. Our message is ~64 bytes and the biggest tag in the field holds
     * 137; a card that keeps answering past this is answering wrapped-around garbage.
     */
    private const val MAX_BYTES = 256

    private const val PAGE_BYTES = 4

    /** READ command, Type 2 Tag: returns 4 pages (16 bytes) starting at the given page. */
    private const val CMD_READ: Byte = 0x30

    /** The URI on the card, read the hard way, or null. */
    fun uri(tag: Tag): String? = NdefTag.uriFrom(TagTlv.ndefMessage(dataArea(tag)))

    private fun dataArea(tag: Tag): ByteArray? = mifare(tag) ?: nfcA(tag)

    private fun mifare(tag: Tag): ByteArray? {
        val mu = MifareUltralight.get(tag) ?: return null
        return runCatching {
            mu.connect()
            try {
                collect { page -> mu.readPages(page) }
            } finally {
                runCatching { mu.close() }
            }
        }.getOrNull()
    }

    private fun nfcA(tag: Tag): ByteArray? {
        val a = NfcA.get(tag) ?: return null
        return runCatching {
            a.connect()
            try {
                collect { page -> a.transceive(byteArrayOf(CMD_READ, page.toByte())) }
            } finally {
                runCatching { a.close() }
            }
        }.getOrNull()
    }

    /**
     * Pages from [FIRST_DATA_PAGE] until the ceiling or the first refusal. A read that throws
     * ENDS the collection and keeps what came before it, rather than discarding a message that
     * is already complete.
     *
     * WHERE THE DATA ENDS IS [TagTlv]'S QUESTION, NOT THIS LOOP'S (TASK-311). This used to stop
     * at the first 16-byte chunk containing a 0xFE byte anywhere in it, as a cheap "we have
     * passed the terminator" test. 0xFE is only a terminator AT A TLV BOUNDARY; inside another
     * TLV's value it is ordinary data. So a card carrying, say, a Proprietary TLV with a 0xFE
     * in it ahead of the NDEF TLV had its collection cut off mid-message, [TagTlv] correctly
     * refused the truncated buffer, and the operator was told the card was unreadable — on
     * exactly the foreign-written card this whole fallback exists to rescue. Reproduced in
     * checks/raw-tag-io-check.kt § 2.
     *
     * The cost of dropping it is reads, not correctness: [MAX_BYTES] caps this at 16 page reads
     * instead of the 5 our own message needs, and a card that rolls over past its last page
     * simply appends repeats of bytes [TagTlv] has already walked past. It stops at the first
     * refusal either way, which is what a NAKing card gives us at the end of memory.
     */
    private fun collect(read: (Int) -> ByteArray): ByteArray? {
        val out = ByteArrayOutputStream()
        var page = FIRST_DATA_PAGE
        while (out.size() < MAX_BYTES) {
            val chunk = try {
                read(page)
            } catch (_: Exception) {
                break
            }
            if (chunk.size < PAGE_BYTES) break
            out.write(chunk, 0, chunk.size)
            page += chunk.size / PAGE_BYTES
        }
        return if (out.size() == 0) null else out.toByteArray()
    }
}
