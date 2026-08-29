package io.github.qwadratic.nfctimesheets.checks

import android.nfc.Tag
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.nfc.RawTagIo
import java.io.File
import kotlin.system.exitProcess

/**
 * THE FALLBACK READ, DRIVEN — the other half of decision-58 §2.
 *
 *     cd android && ./checks/run.sh
 *
 * `core-check.kt` § TagTlv proves the TLV walk decides correctly about a byte array handed
 * to it. This proves nfc/RawTagIo.kt PRODUCES the right byte array off a card's pages, which
 * is a different claim and was the untested one: RawTagIo imports `android.nfc.tech`, so no
 * JVM check could compile it, and NFC hardware does not exist on an emulator, so no emulator
 * run could reach it. It is the code that runs only once the platform reader has already
 * failed — i.e. only on the card that is already going wrong — so "nothing has ever executed
 * it" and "an operator reports a card it cannot read" are the same sentence.
 *
 * The real RawTagIo.kt is compiled here unmodified against checks/fake/ stubs which model a
 * Type 2 Tag's memory, including what a READ does past the last page: roll over (the spec) or
 * NAK (plenty of real cards). That difference is not decoration — it decides whether a message
 * sitting at the end of the data area comes back whole or comes back truncated.
 *
 * WHAT IT STILL CANNOT PROVE: that a real NTAG213 answers `readPages` the way this stub does,
 * that `MifareUltralight.get()` is non-null on any particular handset, or anything about the
 * platform's own `Ndef` reader that runs BEFORE this. See android/README.md § what is unproven.
 */

private var failed = false

private fun check(ok: Boolean, what: String) {
    if (!ok) {
        System.err.println("FAIL: $what")
        failed = true
    }
    println("  ${if (ok) "ok  " else "FAIL"}  $what")
}

// The host under test is read from branding, never typed here — same rule as every other check.
private val branding = java.util.Properties().apply {
    File("branding.properties").inputStream().use { load(it) }
}
private val host = branding.getProperty("ts.tagHost").trim()
private val tagLink = TagLink(host)

/** The building actually in production, as core-check and tag-writer-check both use. */
private const val HOIV_LOCATION = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"

private fun tag(vararg techs: String = arrayOf("android.nfc.tech.NfcA")) =
    Tag(byteArrayOf(0x04, 0xA2.toByte(), 0xB3.toByte()), arrayOf(*techs))

/**
 * THE MESSAGE THIS APP WRITES, from the app's own encoder — never a hand-typed byte array.
 * A fixture with its own copy of the encoding stops testing the encoding the day it changes.
 */
private val message: ByteArray = NdefTag.message(tagLink.uriFor(HOIV_LOCATION)!!.toString())!!

private const val TERMINATOR: Byte = 0xFE.toByte()

/** `03 LL <message>` — the NDEF TLV a Type 2 Tag carries, 1-byte length form. */
private fun ndefTlv(msg: ByteArray = message) = byteArrayOf(0x03, msg.size.toByte()) + msg

/** A data area of [size] bytes holding [content] from offset 0, zero-padded — a formatted card. */
private fun dataArea(content: ByteArray, size: Int): ByteArray {
    require(content.size <= size) { "fixture does not fit the card it claims" }
    return content + ByteArray(size - content.size)
}

/** NTAG213: pages 4..39, 144 bytes of data area. The card actually bought for this job. */
private const val NTAG213 = 144

private fun read(card: RawCard): String? {
    RawBus.present(card)
    return RawTagIo.uri(tag())
}

private val expected: String = tagLink.uriFor(HOIV_LOCATION)!!.toString()

/** The full round trip an operator's tap makes: pages -> TLV -> NDEF -> a location id. */
private fun resolves(card: RawCard): Boolean = tagLink.locationId(read(card)) == HOIV_LOCATION

fun main() {
    println("raw-tag-io-check: the decision-58 fallback read, driven off faked Type 2 pages")
    println("  message is ${message.size} bytes: ${NdefTag.hex(message)}")

    theControlCase()
    theOtherPlatformsBytes()
    theEndOfMemory()
    theCardMoves()
    theTechFallback()
    theRefusals()

    if (failed) {
        System.err.println("raw-tag-io-check: FAILED")
        exitProcess(1)
    }
    println("raw-tag-io-check: ok")
}

// ---------------------------------------------------------------------------------
// 1. THE CONTROL. A card this app wrote, read back through the fallback. If this ever
//    fails nothing below it means anything.
// ---------------------------------------------------------------------------------
private fun theControlCase() {
    println("\n1. an NTAG213 this app wrote")
    check(
        resolves(RawCard(dataArea(ndefTlv() + TERMINATOR, NTAG213))),
        "an Android-written NTAG213 resolves through the fallback",
    )
    check(
        read(RawCard(dataArea(ndefTlv() + TERMINATOR, NTAG213))) == expected,
        "and to the exact URI the writer minted, not merely to something parseable",
    )
    // The URL this app writes is a fixed shape, so "the longest one" is the only one.
    check(message.size == 64, "the message this app writes is 64 bytes, every time: ${message.size}")
}

// ---------------------------------------------------------------------------------
// 2. THE SAME BYTES, OTHER FRAMINGS. The NDEF message is byte-identical across platforms
//    (core-check § 16 proves the encoder); what differs is what a writer puts AROUND it in
//    the data area. Each of these is a legal Type 2 Tag carrying our message.
// ---------------------------------------------------------------------------------
private fun theOtherPlatformsBytes() {
    println("\n2. the same message, framed as other writers frame it")

    // NULL TLVs as padding before the message — legal, and what some formatters emit.
    check(
        resolves(RawCard(dataArea(byteArrayOf(0, 0, 0) + ndefTlv() + TERMINATOR, NTAG213))),
        "NULL TLV padding before the message is skipped",
    )
    // A Lock Control TLV ahead of it, which is what a formatted NTAG's data area can carry.
    val lock = byteArrayOf(0x01, 0x03, 0xA0.toByte(), 0x10, 0x44)
    check(
        resolves(RawCard(dataArea(lock + ndefTlv() + TERMINATOR, NTAG213))),
        "a Lock Control TLV ahead of the message is stepped over",
    )
    // No terminator at all. Legal when the message ends the data area, and harmless here.
    check(
        resolves(RawCard(dataArea(ndefTlv(), NTAG213))),
        "a message with no terminator TLV still reads",
    )
    // A Proprietary TLV whose VALUE happens to contain 0xFE. That byte is a terminator only
    // at a TLV boundary; inside somebody else's value it is just data.
    val proprietary = byteArrayOf(0xFD.toByte(), 0x04, 0x11, TERMINATOR, 0x22, 0x33)
    check(
        resolves(RawCard(dataArea(proprietary + ndefTlv() + TERMINATOR, NTAG213))),
        "a 0xFE inside a Proprietary TLV's value does not end the read early",
    )
}

// ---------------------------------------------------------------------------------
// 3. THE END OF MEMORY, both ways. A card that rolls over and a card that NAKs must reach
//    the same answer about the same message — the operator is holding one card, not two.
// ---------------------------------------------------------------------------------
private fun theEndOfMemory() {
    println("\n3. what a READ does past the last page")

    // A message that ENDS the data area, so the read that would complete it is the read past
    // the end. 66 bytes = TLV header + 64, rounded up to whole pages.
    val pages = (ndefTlv().size + 3) / 4 * 4        // 68
    check(
        resolves(RawCard(dataArea(ndefTlv(), pages), wrapsPastEnd = true)),
        "a message filling the data area reads on a card that rolls over",
    )
    // KNOWN CEILING, NOT A BUG WE CARRY INTO THE FIELD. A card that NAKs rather than rolling
    // over cannot serve a 4-page-aligned read that straddles its last page, so a message whose
    // final bytes sit in that straddle is unreachable without overlapping re-reads. It is
    // asserted rather than fixed because it cannot occur here: our message is 64 bytes and
    // NdefTag.plan refuses any card that cannot hold it, so every card this app has ever
    // written has a data area of at least 144 bytes (NTAG213) and the message ends 78 bytes
    // clear of the end. Pinned so that a future, longer URL fails HERE and not at a door.
    check(
        read(RawCard(dataArea(ndefTlv(), pages), wrapsPastEnd = false)) == null,
        "a NAKing card whose message ends inside its last straddled read is a known dead end",
    )
    check(
        resolves(RawCard(dataArea(ndefTlv() + TERMINATOR, NTAG213), wrapsPastEnd = false)),
        "...which no real card reaches: an ordinary NTAG213 reads fine on a NAKing card",
    )
}

// ---------------------------------------------------------------------------------
// 4. THE CARD MOVES. An operator holds a phone against a wall; a read failing partway is an
//    ordinary event. Whatever was already collected must still be usable.
// ---------------------------------------------------------------------------------
private fun theCardMoves() {
    println("\n4. the card leaves the field partway through")

    // The message is complete by page 20; a card that dies at page 24 has already said
    // everything we needed.
    check(
        resolves(RawCard(dataArea(ndefTlv() + TERMINATOR, NTAG213), goesAwayAtPage = 24)),
        "a read that dies AFTER the message keeps the message",
    )
    // Dying mid-message is a genuine dead end and must be reported as one, never guessed at.
    check(
        read(RawCard(dataArea(ndefTlv() + TERMINATOR, NTAG213), goesAwayAtPage = 12)) == null,
        "a read that dies INSIDE the message answers null rather than a guess",
    )
    check(
        read(RawCard(dataArea(ndefTlv() + TERMINATOR, NTAG213), connectThrows = true)) == null,
        "a card that will not connect on either technology answers null",
    )
}

// ---------------------------------------------------------------------------------
// 5. WHICH TECHNOLOGY. MifareUltralight first, NfcA when it is absent or unusable.
// ---------------------------------------------------------------------------------
private fun theTechFallback() {
    println("\n5. MifareUltralight, then NfcA")

    val bytes = dataArea(ndefTlv() + TERMINATOR, NTAG213)
    check(
        resolves(RawCard(bytes, hasMifare = false, hasNfcA = true)),
        "a card exposing only NfcA is read with the raw READ command",
    )
    check(RawBus.calls.any { it.startsWith("a.transceive(30") }, "...via 0x30 READ: ${RawBus.trace()}")
    check(
        resolves(RawCard(bytes, hasMifare = true)),
        "a card exposing MifareUltralight is read through readPages",
    )
    check(RawBus.calls.any { it.startsWith("mu.readPages") }, "...and not through transceive: ${RawBus.trace()}")
    check(
        read(RawCard(bytes, hasMifare = false, hasNfcA = false)) == null,
        "a card exposing neither technology answers null",
    )
}

// ---------------------------------------------------------------------------------
// 6. WHAT MUST STAY REFUSED. The bytes come off an unlocked, attacker-writable card
//    (decision-15). A fallback that gets generous is a fallback that reads a stranger's tag
//    as ours.
// ---------------------------------------------------------------------------------
private fun theRefusals() {
    println("\n6. still refused")

    check(read(RawCard(dataArea(byteArrayOf(TERMINATOR), NTAG213))) == null, "an empty formatted card is null")
    check(read(RawCard(ByteArray(NTAG213))) == null, "an all-zero data area is null")

    // Somebody else's URL on our card is READ, and refused one layer up by TagLink — the
    // fallback finds bytes, it never decides whose they are.
    val foreign = NdefTag.message("https://evil.example.com/t?l=$HOIV_LOCATION")!!
    val card = RawCard(dataArea(ndefTlv(foreign) + TERMINATOR, NTAG213))
    check(read(card) == "https://evil.example.com/t?l=$HOIV_LOCATION", "a foreign URL is read out verbatim")
    check(tagLink.locationId(read(card)) == null, "...and TagLink, not RawTagIo, is what refuses it")
}
