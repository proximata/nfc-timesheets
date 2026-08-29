package io.github.qwadratic.nfctimesheets.checks

/**
 * A TYPE 2 TAG'S MEMORY, FAKED, so nfc/RawTagIo.kt can be driven off-device.
 *
 * [dataArea] is everything from page 4 onwards — the same bytes RawTagIo believes it is
 * collecting. Pages 0-3 (UID, lock bytes, CC) are not modelled because RawTagIo never
 * reads them.
 *
 * END-OF-MEMORY IS A PARAMETER, NOT AN ASSUMPTION. NFC Forum Type 2 Tag Operation has READ
 * roll over to page 0 when it runs past the last page; plenty of real cards answer NAK
 * instead, and Android surfaces that as an IOException. Which one a card does decides how
 * many bytes RawTagIo ends up holding, so both are here.
 */
class RawCard(
    val dataArea: ByteArray,
    val hasMifare: Boolean = true,
    val hasNfcA: Boolean = true,
    /** false = READ past the end throws, as a NAKing card does. true = roll over to page 0. */
    val wrapsPastEnd: Boolean = true,
    val connectThrows: Boolean = false,
    /** Page index (absolute) at and after which a read throws — a card leaving the field. */
    val goesAwayAtPage: Int = Int.MAX_VALUE,
) {
    /** 16 bytes at [page], where page 4 is [dataArea] offset 0. */
    fun read(page: Int): ByteArray {
        if (page >= goesAwayAtPage) throw java.io.IOException("tag lost")
        val start = (page - 4) * 4
        if (start >= dataArea.size) {
            if (!wrapsPastEnd) throw java.io.IOException("NAK: past the end of memory")
            return ByteArray(16) { dataArea[(start + it) % dataArea.size] }
        }
        if (start + 16 > dataArea.size) {
            if (!wrapsPastEnd) throw java.io.IOException("NAK: past the end of memory")
            return ByteArray(16) { dataArea[(start + it) % dataArea.size] }
        }
        return dataArea.copyOfRange(start, start + 16)
    }
}

/** The one raw card currently presented, and every call made to it, in order. */
object RawBus {
    var card: RawCard = RawCard(ByteArray(0))
    val calls: MutableList<String> = mutableListOf()

    fun present(c: RawCard) {
        card = c
        calls.clear()
    }

    fun log(call: String) {
        calls.add(call)
    }

    fun trace(): String = calls.joinToString(" -> ")
}
