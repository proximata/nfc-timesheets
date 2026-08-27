package io.github.qwadratic.nfctimesheets.core

/**
 * THE TLV STREAM ON A TYPE 2 TAG, walked by hand (decision-58 §2).
 *
 * WHY THIS EXISTS AT ALL. `Ndef.getNdefMessage()` is the ordinary way to read a card and
 * stays the first thing tried. It is also a black box that answers null for reasons it does
 * not name, and a card written by another platform can be a technically valid Type 2 Tag
 * the platform helper still declines to parse. When that happens an operator is holding a
 * physical card with no way forward. This walks the raw data area itself and hands whatever
 * it finds to the SAME [NdefTag.uriFrom] decoder the write path already round-trips through
 * — a fallback, never a second source of truth.
 *
 * THE LAYOUT, from NFC Forum Type 2 Tag Operation §2.3: the data area starts at page 4 and
 * is a sequence of TLVs.
 *
 *     00              NULL, one byte, no length, no value — skip
 *     01 LL <value>   Lock Control     — not ours; skip over it
 *     02 LL <value>   Memory Control   — not ours; skip over it
 *     03 LL <value>   NDEF Message     — THE ONE WE WANT
 *     03 FF HH LL ..  NDEF Message, 3-byte length form (length >= 255)
 *     FD LL <value>   Proprietary      — not ours; skip over it
 *     FE              Terminator — nothing after this is data
 *
 * PURE KOTLIN, NO ANDROID IMPORT, on purpose: this is the half that can be wrong in a way
 * nobody notices, so it has to be runnable on a laptop by android/checks. The page reads
 * themselves live in nfc/RawTagIo.kt, where they cannot be checked off-device.
 *
 * REFUSES RATHER THAN GUESSES. An unknown TLV type, a length that runs past the buffer, or a
 * 3-byte length that could have been written in one byte all return null. The bytes come off
 * an unlocked, attacker-writable card (decision-15); the cost of stopping is one message an
 * operator can act on, the cost of guessing is a card that reads as ours and is not.
 */
object TagTlv {

    private const val T_NULL = 0x00
    private const val T_LOCK = 0x01
    private const val T_MEMORY = 0x02
    private const val T_NDEF = 0x03
    private const val T_PROPRIETARY = 0xFD
    private const val T_TERMINATOR = 0xFE

    /** Lengths at or above this are carried in the 3-byte form. */
    private const val LONG_FORM = 0xFF

    /**
     * The NDEF message bytes inside a Type 2 Tag data area, or null.
     *
     * @param data everything read from page 4 onwards, concatenated in page order.
     */
    fun ndefMessage(data: ByteArray?): ByteArray? {
        if (data == null) return null
        var i = 0
        while (i < data.size) {
            when (val type = data[i].toInt() and 0xFF) {
                T_NULL -> i++
                T_TERMINATOR -> return null
                T_NDEF, T_LOCK, T_MEMORY, T_PROPRIETARY -> {
                    if (i + 1 >= data.size) return null
                    var length = data[i + 1].toInt() and 0xFF
                    var valueAt = i + 2
                    if (length == LONG_FORM) {
                        if (i + 3 >= data.size) return null
                        length = ((data[i + 2].toInt() and 0xFF) shl 8) or (data[i + 3].toInt() and 0xFF)
                        // The 3-byte form is only legal for lengths the 1-byte form cannot
                        // carry. Anything shorter is a card written by something confused.
                        if (length < LONG_FORM) return null
                        valueAt = i + 4
                    }
                    if (length == 0 || valueAt + length > data.size) return null
                    if (type == T_NDEF) return data.copyOfRange(valueAt, valueAt + length)
                    i = valueAt + length
                }
                else -> return null
            }
        }
        return null
    }
}
