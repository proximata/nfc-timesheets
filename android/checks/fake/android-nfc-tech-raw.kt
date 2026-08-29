package android.nfc.tech

import android.nfc.Tag
import io.github.qwadratic.nfctimesheets.checks.RawBus

/**
 * STUB. `MifareUltralight` and `NfcA` as far as nfc/RawTagIo.kt uses them.
 *
 * WHY THIS EXISTS. RawTagIo is the decision-58 §2 fallback — the code that runs precisely
 * when the platform's own reader has already given up, i.e. the code an operator reaches
 * only on the card that is already going wrong. It imports `android.nfc.tech`, so no JVM
 * check could compile it, and it needs a physical Type 2 Tag, so no emulator could drive
 * it: it shipped as the one half of the read path nothing had ever loaded. Same argument,
 * same shape and same package trick as checks/fake/android-nfc-tech.kt does for TagWriter.
 *
 * THE MEMORY MODEL IS THE POINT, not the class surface. A Type 2 Tag READ returns FOUR
 * pages, and what it does at the end of memory is not one behaviour: the spec has it roll
 * over to page 0, and real cards in the field NAK instead. Both are modelled ([RawBus]),
 * because the difference decides whether a message that reaches the last page comes back
 * whole or comes back truncated — which is exactly the class of bug this harness is for.
 */
class MifareUltralight private constructor() {

    fun connect() {
        RawBus.log("mu.connect")
        if (RawBus.card.connectThrows) throw java.io.IOException("tag lost")
    }

    fun close() {
        RawBus.log("mu.close")
    }

    /** `readPages(page)` — 16 bytes (four pages) starting at [page]. */
    fun readPages(page: Int): ByteArray {
        RawBus.log("mu.readPages($page)")
        return RawBus.card.read(page)
    }

    companion object {
        @JvmStatic
        fun get(tag: Tag): MifareUltralight? {
            RawBus.log("MifareUltralight.get")
            return if (RawBus.card.hasMifare) MifareUltralight() else null
        }
    }
}

class NfcA private constructor() {

    fun connect() {
        RawBus.log("a.connect")
        if (RawBus.card.connectThrows) throw java.io.IOException("tag lost")
    }

    fun close() {
        RawBus.log("a.close")
    }

    /** Only the Type 2 READ (0x30 page) is modelled; RawTagIo sends nothing else. */
    fun transceive(command: ByteArray): ByteArray {
        RawBus.log("a.transceive(${command.joinToString("") { "%02x".format(it) }})")
        require(command.size == 2 && command[0] == 0x30.toByte()) { "unexpected command" }
        return RawBus.card.read(command[1].toInt() and 0xFF)
    }

    companion object {
        @JvmStatic
        fun get(tag: Tag): NfcA? {
            RawBus.log("NfcA.get")
            return if (RawBus.card.hasNfcA) NfcA() else null
        }
    }
}
