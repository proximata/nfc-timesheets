package io.github.qwadratic.nfctimesheets.checks

import android.nfc.NdefMessage
import android.nfc.Tag
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WriteGuard
import io.github.qwadratic.nfctimesheets.nfc.TagWriter
import java.io.File
import kotlin.system.exitProcess

/**
 * THE WRITE LOOP, DRIVEN. Not read — driven.
 *
 *     cd android && ./checks/run.sh
 *
 * `core-check.kt` § 16 proves core/NdefTag decides correctly. This proves nfc/TagWriter
 * ASKS it, in the right order, and does the right thing with every answer. Those are
 * different claims, and only the first one had ever been executed: TagWriter imports
 * android.nfc, so no check could load it, and NFC hardware does not work on an emulator,
 * so no emulator run could either. The one class in this repo that modifies a physical
 * object was the one class nothing had run.
 *
 * The real TagWriter.kt is compiled here unmodified, against checks/fake/ stubs of the
 * android.nfc surface. Every call it makes is recorded in order, so the assertions below
 * are about OBSERVED BEHAVIOUR:
 *
 *   - the 46-byte card produces NO writeNdefMessage in the log at all
 *   - a corrupted read-back produces Unverified, and a clean one produces Written
 *   - makeReadOnly() and cachedNdefMessage throw if reached, on every path driven
 *   - close() happens on the failure paths too, not only the happy one
 *
 * WHAT IT STILL CANNOT PROVE, and nothing off a phone can: that the platform's own NDEF
 * encoder agrees byte-for-byte with ours, that a real NTAG213 reports maxSize 137, that a
 * tag pulled out of the field mid-write behaves like the exception path modelled here, or
 * anything at all about Android versions. See android/README.md § what is unproven.
 */

private var failed = false

private fun check(ok: Boolean, what: String) {
    if (!ok) {
        System.err.println("FAIL: $what")
        failed = true
    }
}

// The host under test is read from branding, never typed here: a check with its own copy of
// the operator's tag host stops checking anything the day that host changes.
private val branding = java.util.Properties().apply {
    File("branding.properties").inputStream().use { load(it) }
}
private val host = branding.getProperty("ts.tagHost").trim()
private val legacyHosts = (branding.getProperty("ts.legacyTagHosts") ?: "")
    .split(",").map { it.trim() }.filter { it.isNotEmpty() }
private val tagLink = TagLink(host, legacyHosts)
private val writer = TagWriter(tagLink)

/** The building that is actually in production. Same constant as core-check § 1b. */
private const val HOIV_LOCATION = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"

/** A tag as Android hands it over: a UID and a tech list. */
private fun tag(uid: String = "04A2B3C4D5E680", vararg techs: String = arrayOf("android.nfc.tech.Ndef")) =
    Tag(uid.chunked(2).map { it.toInt(16).toByte() }.toByteArray(), arrayOf(*techs))

private fun run(
    card: FakeCard,
    locationId: String? = HOIV_LOCATION,
    confirmedOverwriteOf: String? = null,
): TagWriter.Outcome {
    TagBus.present(card)
    return writer.write(tag(), locationId, confirmedOverwriteOf)
}

fun main() {
    showTheBytes()
    theTapConverges()
    happyPath()
    aMountedCardIsNotOverwritten()
    capacityIsCheckedBeforeAnyWrite()
    theReadBackActuallyCompares()
    theCardIsNeverLocked()
    transportFailures()
    notFormatted()

    if (failed) exitProcess(1)
    println("tag-writer-check: OK")
}

// ---------------------------------------------------------------------------------
// 0. SHOW THE BYTES. Not an assertion — the thing the assertions are about, printed, so
//    a human can read what actually goes onto a card without owning a card.
//
//    Printed from what the STUB CARD RECEIVED, not from what the encoder returned. Those
//    are the same array only if TagWriter passes the planned bytes straight through, which
//    is exactly the thing worth showing rather than assuming.
// ---------------------------------------------------------------------------------
private fun showTheBytes() {
    val outcome = run(FakeCard(capacity = 137))
    // A check that DIES before its first assertion prints a stack trace and exits, and a
    // stack trace is not a verdict: whoever reads the output learns that Kotlin threw, not
    // that the app would refuse to write a card. Every mutation that breaks the encoder
    // lands here first, so this is the line that has to say what happened.
    val writeCall = TagBus.calls.firstOrNull { it.startsWith("writeNdefMessage") }
    if (writeCall == null) {
        check(false, "NOTHING WAS WRITTEN to a healthy 137-byte card. Outcome: $outcome; calls: ${TagBus.trace()}")
        return
    }
    val written = writeCall.substringAfter('[').substringBefore(']')
    val bytes = written.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    val payloadLength = bytes[2].toInt() and 0xFF
    val prefix = when (bytes[4].toInt() and 0xFF) {
        0x04 -> "https://"
        else -> "?? (0x%02x)".format(bytes[4])
    }
    val rest = bytes.copyOfRange(5, bytes.size).toString(Charsets.UTF_8)

    println(
        """
        |
        |  THE BYTES THAT REACH THE CARD  (captured at writeNdefMessage, ${bytes.size} bytes)
        |  ${NdefTag.hex(bytes)}
        |
        |    [0] %02x  MB=%s ME=%s CF=%s SR=%s IL=%s TNF=%d  (%s)
        |    [1] %02x  type length
        |    [2] %02x  payload length = %d
        |    [3] %02x  record type '%s'   %s
        |    [4] %02x  URI abbreviation -> "%s"
        |    [5..] %s
        |
        |  decodes to : ${NdefTag.uriFrom(bytes)}
        |  parses as  : ${tagLink.locationId(NdefTag.uriFrom(bytes))}
        |  outcome    : $outcome
        |  call order : ${TagBus.trace()}
        |
        """.trimMargin().format(
            bytes[0],
            bytes[0].toInt() and 0x80 != 0, bytes[0].toInt() and 0x40 != 0,
            bytes[0].toInt() and 0x20 != 0, bytes[0].toInt() and 0x10 != 0,
            bytes[0].toInt() and 0x08 != 0, bytes[0].toInt() and 0x07,
            if (bytes[0].toInt() and 0x07 == 1) "Well Known" else "NOT Well Known",
            bytes[1], bytes[2], payloadLength, bytes[3],
            (bytes[3].toInt() and 0xFF).toChar(),
            if (bytes[3] == 0x55.toByte()) "URI" else "NOT A URI RECORD",
            bytes[4], prefix, rest,
        ),
    )

    // Printing is not proving. The same bytes, asserted.
    check(bytes.size == 64, "the array handed to writeNdefMessage is 64 bytes: ${bytes.size}")
    check(bytes[3] == 0x55.toByte(), "the card receives a 'U' (URI) record, never 'T' (Text)")
    check(bytes[4] == 0x04.toByte(), "the card receives abbreviation 0x04 = https://")
    check(bytes.size == 4 + payloadLength, "no trailing rubbish reaches the card")
    check(NdefTag.uriFrom(bytes) == "https://$host/t?l=$HOIV_LOCATION", "the card's bytes decode to the tag URI")
    check(rest.startsWith("$host/"), "the bytes carry the TAG host, not the API host: $rest")
    // decision-40, as bytes. The API host has been renamed once already; a card carrying it
    // is scrap the day it is renamed again, and that day cost five days of a phone in the
    // field that could not clock in.
    val apiHost = branding.getProperty("ts.apiHost").trim()
    check(
        apiHost == host || !rest.contains(apiHost),
        "THE RENAMEABLE API HOST IS NEVER BURNT ONTO A CARD: $rest",
    )
    check(
        bytes.contentEquals(NdefTag.message("https://$host/t?l=$HOIV_LOCATION")!!),
        "the bytes on the card are the bytes NdefTag planned — nothing recomputes them downstream",
    )
}

// ---------------------------------------------------------------------------------
// 0b. CONVERGENCE: A TAG WE WRITE, TAPPED, IS A TAG ON THE WALL.
//
//     The bytes are burnt by core/NdefTag. They are read back in the field by something
//     else entirely: NfcTapActivity pulls the URI out of a tapped tag with the PLATFORM's
//     NdefRecord.toUri() on Android <= 15, and on Android 16+ the NFC service does the same
//     expansion itself before ACTION_VIEW ever fires. Two decoders, one card. "It round-
//     trips through NdefTag" says nothing about the one that runs in a stairwell.
//
//     checks/fake/android-nfc.kt implements toUri() over the FULL 36-entry RTD-URI table,
//     the way the platform does and deliberately unlike NdefTag, which accepts five codes
//     and refuses the rest. So the two agreeing on our card is a result rather than the
//     same code run twice.
//
//     WHAT IS STILL NOT PROVEN HERE: that Android's REAL toUri() behaves like this table.
//     Only a phone settles that. What this settles is that our bytes carry a shape both
//     independent implementations read identically, which is the part that can be got
//     wrong at a desk.
// ---------------------------------------------------------------------------------
private fun theTapConverges() {
    val outcome = run(FakeCard(capacity = 137))
    val onCard = TagBus.card.content
    if (outcome !is TagWriter.Outcome.Written || onCard == null) {
        check(false, "NOTHING WAS WRITTEN to a healthy 137-byte card, so convergence cannot be tested: $outcome")
        return
    }

    // The card's own bytes, through the PLATFORM parser, exactly as a tap does it.
    val records = NdefMessage(onCard).records
    check(records.size == 1, "a tapped card holds exactly one record: ${records.size}")
    val tapped = records.first().toUri()
    check(tapped == "https://$host/t?l=$HOIV_LOCATION", "the platform decoder reads the same URI: $tapped")
    check(
        tapped == NdefTag.uriFrom(onCard),
        "THE TWO DECODERS AGREE: platform '$tapped' vs NdefTag '${NdefTag.uriFrom(onCard)}'",
    )
    check(
        tagLink.locationId(tapped) == HOIV_LOCATION,
        "THE CONVERGENCE: tapped, the card we wrote parses to the production location",
    )

    // The tag physically mounted at the client's building was written months ago by NFC
    // Tools, not by this app. Byte-identical, or the two are not the same kind of tag.
    val wallHost = "timesheets" + ".exe" + ".xyz"
    val wall = NdefTag.message("https://$wallHost/t?l=$HOIV_LOCATION")
    check(
        wall?.contentEquals(onCard) == true,
        "a card we write is byte-identical to the one already on the wall",
    )

    // THE '+' TRAP, ON THE TAP SIDE. java.net.URLDecoder implements form encoding, where
    // '+' MEANS space, so "?l=+<uuid>" would decode to " <uuid>", trim clean and be
    // ACCEPTED on Android while iOS refuses the same card. TagLink escapes '+' to %2B
    // before decoding to stop that. Here it is re-tested where it actually bites: a card
    // carrying '+' , read by the platform decoder, tapped.
    val plusCard = NdefTag.message("https://$host/t?l=+$HOIV_LOCATION")!!
    val plusTapped = NdefMessage(plusCard).records.first().toUri()
    check(plusTapped == "https://$host/t?l=+$HOIV_LOCATION", "the platform decoder leaves '+' alone: $plusTapped")
    check(
        tagLink.locationId(plusTapped) == null,
        "THE TRAP: a '+' card is refused on the TAP path too, not just in the encoder",
    )
    // ...and such a card can never be produced by this writer in the first place.
    val plusOutcome = run(FakeCard(capacity = 137), locationId = "+$HOIV_LOCATION")
    check(plusOutcome is TagWriter.Outcome.Refused.BadId, "a '+' id never reaches a card: $plusOutcome")
    check(!TagBus.wroteAnything(), "a '+' id writes nothing")

    // A percent-encoded space is the same trap wearing a different hat.
    val encodedSpace = NdefTag.message("https://$host/t?l=%20$HOIV_LOCATION")!!
    val spaceTapped = NdefMessage(encodedSpace).records.first().toUri()
    check(
        tagLink.locationId(spaceTapped) == HOIV_LOCATION,
        "a %20-prefixed uuid IS accepted (URLDecoder unescapes it, then it trims) — pinned, " +
            "so a change to the decoder cannot alter it unnoticed: $spaceTapped",
    )
    // ...but this writer cannot mint one, which is what keeps it off a card.
    check(
        run(FakeCard(capacity = 137), locationId = "%20$HOIV_LOCATION") is TagWriter.Outcome.Refused.BadId,
        "a %20-prefixed id never reaches a card either",
    )
}

// ---------------------------------------------------------------------------------
// 1. THE HAPPY PATH, AND THE ORDER IT HAPPENS IN.
//
//    The order is the safety property. Reading capacity after writing would be a check
//    that reports on a card already ruined.
// ---------------------------------------------------------------------------------
private fun happyPath() {
    val outcome = run(FakeCard(capacity = 137))
    check(outcome is TagWriter.Outcome.Written, "an NTAG213 writes and verifies: $outcome")
    val written = outcome as? TagWriter.Outcome.Written
    check(written?.locationId == HOIV_LOCATION, "the reported location is the one asked for")
    check(written?.uri == "https://$host/t?l=$HOIV_LOCATION", "the reported URI is on the tag host")
    check(written?.bytes == 64 && written?.capacity == 137, "the report carries both numbers")
    check(written?.serial == "04:A2:B3:C4:D5:E6:80", "the serial is normalised for the office: ${written?.serial}")

    check(
        TagBus.calls == listOf(
            "Ndef.get", "connect", "getMaxSize", "isWritable",
            // The overwrite guard's read. It is HERE, before the write, or it is decoration:
            // "is this card already on a wall" answered after the card has been changed is
            // not an answer, it is a post-mortem.
            "getNdefMessage",
            TagBus.calls.first { it.startsWith("writeNdefMessage") },
            "getNdefMessage", "close",
        ),
        "EXACT call order — facts, decision, READ WHAT IS THERE, write, re-read: ${TagBus.trace()}",
    )
    check(
        TagBus.calls.indexOf("getMaxSize") < TagBus.calls.indexOfFirst { it.startsWith("writeNdefMessage") },
        "capacity is read BEFORE the write, on the happy path too",
    )
    // lastIndexOf, not indexOf: there are TWO reads now. The first is the overwrite guard's,
    // BEFORE the write; the read-back is the last one. Comparing against the first would
    // compare the write against the guard's read and go green while the read-back was
    // deleted — which is the failure this line exists to catch.
    check(
        TagBus.calls.indexOfFirst { it.startsWith("writeNdefMessage") } < TagBus.calls.lastIndexOf("getNdefMessage"),
        "the read-back happens AFTER the write, or it is reading the old card",
    )
    check(
        TagBus.calls.count { it == "getNdefMessage" } == 2,
        "exactly two reads: what the card said before, and what it says after: ${TagBus.trace()}",
    )

    // A card that already holds a DIFFERENT one of our ids is NOT overwritten — TASK-220,
    // driven in full below. Kept here because this is where the opposite used to be
    // asserted, and because the whole point is that the happy path stops at this card.
    val other = NdefTag.message("https://$host/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301")!!
    val over = run(FakeCard(capacity = 137, initial = other))
    check(over is TagWriter.Outcome.Refused.Occupied, "a card holding another building's id is REFUSED: $over")
    check(!TagBus.wroteAnything(), "...and nothing was written to it: ${TagBus.trace()}")

    // The card that already holds EXACTLY what we are about to write. Byte equality alone
    // cannot tell this apart from a no-op, so the only thing that makes the Written verdict
    // honest is that a write really happened. Assert it did.
    val same = NdefTag.message("https://$host/t?l=$HOIV_LOCATION")!!
    val again = run(FakeCard(capacity = 137, initial = same))
    check(again is TagWriter.Outcome.Written, "re-writing the same URI is fine: $again")
    check(TagBus.wroteAnything(), "...and it was a REAL write, not a read-back of what was already there")
}

// ---------------------------------------------------------------------------------
// 1b. A CARD THAT IS ALREADY ON A WALL IS NOT OVERWRITTEN.   (TASK-220)
//
//     THE DEFECT, driven at this exact harness before the fix: a card pre-loaded with the
//     live HOIV bytes, presented to a screen offering a fresh unbound id, came back
//     `Written` — "Geschrieben und geprueft" — and the card now held the new id. That door
//     then answers 422 for every cleaner until an admin claims the new id, and nothing on
//     the phone said a word. It is the only defect in this repo that destroys something
//     PHYSICAL: the fix cannot be verified against hardware here, so it is verified against
//     the observed call log instead — a refusal is only a refusal if `writeNdefMessage`
//     does not appear.
//
//     THE TABLE IS THE CHECK. Every kind of card an operator can be holding, run through
//     the real TagWriter, printed with what came back and whether the card was touched.
//     The three columns that matter are the outcome, the `wrote?` column, and the fact that
//     the same table contains cards that DO write — a guard that refuses everything would
//     satisfy half these rows and is caught by the other half.
// ---------------------------------------------------------------------------------

/** A different building. Anything but the id the screen is offering. */
private const val OTHER_LOCATION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

private class Case(
    val what: String,
    val card: () -> FakeCard,
    val offered: String? = HOIV_LOCATION,
    val confirmed: String? = null,
    val expect: String,
    val expectWrite: Boolean,
    val verdict: (TagWriter.Outcome) -> Boolean,
)

private fun aMountedCardIsNotOverwritten() {
    val ours = NdefTag.message("https://$host/t?l=$OTHER_LOCATION")!!
    val legacyHost = legacyHosts.firstOrNull { it != host }
    val oursOnLegacyHost = legacyHost?.let { NdefTag.message("https://$it/t?l=$OTHER_LOCATION")!! }
    val foreignUrl = NdefTag.message("https://example.com/loyalty-card")!!
    // A Text record: same length class, no URL at all. NFC Tools writes these by default.
    val foreignText = NdefTag.message("https://example.com/x")!!.copyOf().also { it[3] = 0x54 }
    // Bytes that are not a well-formed message at all. The platform parser throws on these;
    // a card we cannot read is not a card of ours, so it is foreign, not fatal.
    val rubbish = byteArrayOf(0x11, 0x22, 0x33, 0x44, 0x55)

    val cases = listOf(
        Case(
            what = "blank NTAG213",
            card = { FakeCard(capacity = 137) },
            expect = "Written, replaced=Blank",
            expectWrite = true,
        ) { it is TagWriter.Outcome.Written && it.replaced == WriteGuard.Existing.Blank },
        Case(
            what = "OUR id, the SAME one offered (failed-verify retry)",
            card = { FakeCard(capacity = 137, initial = NdefTag.message("https://$host/t?l=$HOIV_LOCATION")) },
            expect = "Written — the retry path must survive",
            expectWrite = true,
        ) { it is TagWriter.Outcome.Written && it.replaced == WriteGuard.Existing.Ours(HOIV_LOCATION) },
        Case(
            what = "OUR id, a DIFFERENT one — A MOUNTED CARD",
            card = { FakeCard(capacity = 137, initial = ours) },
            expect = "Refused.Occupied, card untouched",
            expectWrite = false,
        ) { it is TagWriter.Outcome.Refused.Occupied && it.onTag == OTHER_LOCATION },
        Case(
            what = "OUR id on a LEGACY host — still a mounted card",
            card = { FakeCard(capacity = 137, initial = oursOnLegacyHost ?: ours) },
            expect = "Refused.Occupied",
            expectWrite = false,
        ) { it is TagWriter.Outcome.Refused.Occupied && it.onTag == OTHER_LOCATION },
        Case(
            what = "mounted card + the WRONG id confirmed",
            card = { FakeCard(capacity = 137, initial = ours) },
            confirmed = HOIV_LOCATION,
            expect = "Refused.Occupied — a confirmation is bound to ONE card",
            expectWrite = false,
        ) { it is TagWriter.Outcome.Refused.Occupied },
        Case(
            what = "mounted card + THE RIGHT id confirmed",
            card = { FakeCard(capacity = 137, initial = ours) },
            confirmed = OTHER_LOCATION,
            expect = "Written, replaced=Ours",
            expectWrite = true,
        ) { it is TagWriter.Outcome.Written && it.replaced == WriteGuard.Existing.Ours(OTHER_LOCATION) },
        Case(
            what = "foreign card — somebody else's URL",
            card = { FakeCard(capacity = 137, initial = foreignUrl) },
            expect = "Written, replaced=Foreign",
            expectWrite = true,
        ) { it is TagWriter.Outcome.Written && it.replaced is WriteGuard.Existing.Foreign },
        Case(
            what = "foreign card — a Text record",
            card = { FakeCard(capacity = 137, initial = foreignText) },
            expect = "Written, replaced=Foreign",
            expectWrite = true,
        ) { it is TagWriter.Outcome.Written && it.replaced is WriteGuard.Existing.Foreign },
        Case(
            what = "foreign card — bytes that are not a message at all",
            card = { FakeCard(capacity = 137, initial = rubbish) },
            expect = "Written, replaced=Foreign(unlesbar)",
            expectWrite = true,
        ) {
            it is TagWriter.Outcome.Written &&
                it.replaced == WriteGuard.Existing.Foreign(WriteGuard.UNREADABLE)
        },
        Case(
            what = "UNREADABLE — card leaves the field before the read",
            card = { FakeCard(capacity = 137, initial = ours, preReadThrows = "tag lost before the guard read") },
            expect = "Lost, card untouched",
            expectWrite = false,
        ) { it is TagWriter.Outcome.Lost },
        Case(
            what = "TOO SMALL — the 46-byte foreign Ultralight",
            card = { FakeCard(capacity = 46, initial = ours) },
            expect = "Refused.TooSmall, card untouched",
            expectWrite = false,
        ) { it is TagWriter.Outcome.Refused.TooSmall },
    )

    val rows = StringBuilder()
    for (case in cases) {
        val outcome = run(case.card(), case.offered, case.confirmed)
        val wrote = TagBus.wroteAnything()
        rows.append(
            "  %-52s %-5s  %s\n".format(
                case.what,
                if (wrote) "WRITE" else "—",
                outcome.javaClass.simpleName + (
                    (outcome as? TagWriter.Outcome.Written)?.let { " replaced=${it.replaced}" }
                        ?: (outcome as? TagWriter.Outcome.Refused.Occupied)
                            ?.let { " onTag=${it.onTag} token=${it.token}" }
                        ?: ""
                    ),
            ),
        )
        check(case.verdict(outcome), "${case.what}: expected ${case.expect}, got $outcome")
        check(
            wrote == case.expectWrite,
            "${case.what}: the card was ${if (wrote) "WRITTEN TO" else "not touched"} " +
                "and should ${if (case.expectWrite) "have been" else "NOT have been"}: ${TagBus.trace()}",
        )
        check(TagBus.calls.lastOrNull() == "close", "${case.what}: the tag is released: ${TagBus.trace()}")
    }

    check(legacyHost != null, "no legacy host in branding.properties — the legacy-host row degenerates")

    println(
        "\n  WHAT THE OPERATOR MAY BE HOLDING  (real TagWriter, observed call log)\n\n" +
            "  %-52s %-5s  %s\n".format("card presented", "wrote", "outcome") +
            "  " + "-".repeat(100) + "\n" + rows,
    )

    // THE REFUSAL IS DECIDED BEFORE THE WRITE, not reported after it. The order in the log
    // is the only thing that can say so.
    run(FakeCard(capacity = 137, initial = ours))
    check(
        TagBus.calls == listOf("Ndef.get", "connect", "getMaxSize", "isWritable", "getNdefMessage", "close"),
        "a mounted card is read and released, and nothing else: ${TagBus.trace()}",
    )

    // THE OVERRIDE IS SPECIFIC. Not "are you sure" — the operator types back the last six
    // characters of the id that is about to be destroyed, off the screen.
    val occupied = run(FakeCard(capacity = 137, initial = ours)) as TagWriter.Outcome.Refused.Occupied
    check(occupied.token == "e82c3301".takeLast(6), "the token is the last six of the id on the card: ${occupied.token}")
    check(occupied.offered == HOIV_LOCATION, "the refusal also names what would have been written")
    check(WriteGuard.confirms(occupied.onTag, occupied.token), "the printed token is what unlocks it")
    check(WriteGuard.confirms(occupied.onTag, " ${occupied.token.uppercase()} "), "case and space are forgiven")
    check(!WriteGuard.confirms(occupied.onTag, ""), "an empty box confirms nothing")
    check(!WriteGuard.confirms(occupied.onTag, "ja"), "a generic yes confirms nothing")
    check(
        !WriteGuard.confirms(occupied.onTag, WriteGuard.token(HOIV_LOCATION)),
        "THE OBVIOUS WRONG THING: the token of the id being OFFERED (it is on the same screen) does not confirm",
    )

    // ...and the override, once used, is used up: the same confirmation presented with a
    // THIRD card refuses again. The screen clears it after a write; this is the property
    // underneath that, in TagWriter, where it cannot be lost to a Compose recomposition.
    val third = NdefTag.message("https://$host/t?l=11111111-2222-4333-8444-555555555599")!!
    val stillRefused = run(FakeCard(capacity = 137, initial = third), confirmedOverwriteOf = OTHER_LOCATION)
    check(
        stillRefused is TagWriter.Outcome.Refused.Occupied,
        "a confirmation for one card does not authorise the next card: $stillRefused",
    )
    check(!TagBus.wroteAnything(), "...and that next card was not touched")
}

// ---------------------------------------------------------------------------------
// 2. CAPACITY IS CHECKED BEFORE ANY WRITE.
//
//    A half-written card is the worst outcome available: it reads as something, and it is
//    not ours. 46 is the NDEF capacity of the foreign Mifare Ultralight already mounted at
//    the client's building; our message is 64. The assertion that matters is not the
//    verdict, it is that the log contains no write.
// ---------------------------------------------------------------------------------
private fun capacityIsCheckedBeforeAnyWrite() {
    val small = run(FakeCard(capacity = 46))
    check(small is TagWriter.Outcome.Refused.TooSmall, "the 46-byte foreign tag REFUSES: $small")
    check(
        (small as? TagWriter.Outcome.Refused.TooSmall)?.needed == 64 &&
            (small as? TagWriter.Outcome.Refused.TooSmall)?.capacity == 46,
        "the refusal carries both numbers, so the operator knows which tag to fetch",
    )
    check(!TagBus.wroteAnything(), "THE CARD WAS NOT TOUCHED: ${TagBus.trace()}")
    check(TagBus.calls.contains("getMaxSize"), "...and it was refused because the capacity was READ")
    check(TagBus.calls.last() == "close", "the tag is released even on a refusal")

    // The boundary from both sides, through the writer and not only through plan().
    check(run(FakeCard(capacity = 63)) is TagWriter.Outcome.Refused.TooSmall, "63 is one byte too few")
    check(!TagBus.wroteAnything(), "63 bytes writes nothing")
    check(run(FakeCard(capacity = 64)) is TagWriter.Outcome.Written, "64 is exactly enough")
    check(TagBus.wroteAnything(), "64 bytes does write")

    val none = run(FakeCard(capacity = 0))
    check(none is TagWriter.Outcome.Refused.NoCapacity, "a zero capacity is refused: $none")
    check(!TagBus.wroteAnything(), "a zero-capacity tag is not written to")

    // A bad id must not reach a card either — and must be refused BEFORE the write, not
    // after. Every one of these is an operator screen bug, not an attack.
    for (bad in listOf(null, "", "not-a-uuid", "1-1-1-1-1", "westbahnhof")) {
        val outcome = run(FakeCard(capacity = 137), locationId = bad)
        check(outcome is TagWriter.Outcome.Refused.BadId, "id '$bad' never reaches a card: $outcome")
        check(!TagBus.wroteAnything(), "id '$bad' wrote nothing: ${TagBus.trace()}")
    }
}

// ---------------------------------------------------------------------------------
// 3. THE READ-BACK ACTUALLY COMPARES.
//
//    A read-back that cannot fail is decoration. Each card below acknowledges the write
//    and then holds something else — which is exactly what a card pulled out of the field
//    mid-write, or a flaky clone, does. Every one must come back Unverified.
// ---------------------------------------------------------------------------------
private fun theReadBackActuallyCompares() {
    // One flipped bit in the last byte of the uuid. Still decodes cleanly, still looks like
    // one of ours, points at a building that does not exist.
    val flipped = run(
        FakeCard(capacity = 137) { bytes ->
            bytes.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 0x01).toByte() }
        },
    )
    check(flipped is TagWriter.Outcome.Unverified, "one flipped byte in the uuid is UNVERIFIED: $flipped")
    check((flipped as? TagWriter.Outcome.Unverified)?.reason == "mismatch", "and it is reported as a mismatch")
    check(
        (flipped as? TagWriter.Outcome.Unverified)?.onTag?.isNotEmpty() == true,
        "the refusal carries what the card ACTUALLY holds, so a bad card can be diagnosed",
    )

    // Truncated mid-write: the classic partial write.
    val truncated = run(FakeCard(capacity = 137) { it.copyOfRange(0, it.size - 6) })
    check(truncated is TagWriter.Outcome.Unverified, "a truncated card is UNVERIFIED: $truncated")

    // One byte more than we wrote — parses fine in most readers, is not our tag.
    val extra = run(FakeCard(capacity = 137) { it + 0x00 })
    check(extra is TagWriter.Outcome.Unverified, "one extra byte is UNVERIFIED: $extra")

    // The card comes back empty. The write may well have succeeded — but we cannot say so,
    // and "probably fine" is how an unverified card gets screwed to a wall.
    val empty = run(FakeCard(capacity = 137) { null })
    check(empty is TagWriter.Outcome.Unverified, "an empty read-back is UNVERIFIED: $empty")
    check((empty as? TagWriter.Outcome.Unverified)?.reason == "empty", "and it is reported as empty, not as a mismatch")

    // A DIFFERENT building, same length. Length alone proves nothing; this is the card that
    // becomes a payroll dispute.
    val elsewhere = NdefTag.message("https://$host/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301")!!
    val wrongBuilding = run(FakeCard(capacity = 137) { elsewhere })
    check(wrongBuilding is TagWriter.Outcome.Unverified, "a same-length URI for another building is UNVERIFIED: $wrongBuilding")

    // A Text record of the same length: it would be a card no App Link ever matches.
    val asText = run(
        FakeCard(capacity = 137) { bytes -> bytes.copyOf().also { it[3] = 0x54 } },
    )
    check(asText is TagWriter.Outcome.Unverified, "a card that came back as a Text record is UNVERIFIED: $asText")

    // THE ONE THE PARSE CHECK CANNOT SEE, and the reason byte equality is load-bearing.
    //
    // TagWriter has a second, belt-and-braces guard after the byte comparison: it re-parses
    // the card's bytes through TagLink and compares the uuid. That guard catches almost
    // every corruption above, which is what makes this case worth writing down: a card that
    // comes back holding the SAME uuid on a LEGACY host parses perfectly — TagLink accepts
    // legacy hosts on purpose, so tags written before the rename still scan — and the uuid
    // matches, so the parse guard is happy. Only the byte comparison refuses it.
    //
    // And it must refuse it. That card carries the RENAMEABLE api host (decision-40). It
    // works today, it is scrap the next time that host is renamed, and the last rename cost
    // five days of a phone in the field that could not clock in. Written to a card and
    // screwed to a wall, it is a site visit waiting to happen.
    //
    // Deleting NdefTag.verified()'s byte comparison leaves every other assertion in this
    // function still passing. This is the line that goes red.
    val legacyHost = legacyHosts.firstOrNull { it != host }
    if (legacyHost != null) {
        val onLegacyHost = NdefTag.message("https://$legacyHost/t?l=$HOIV_LOCATION")!!
        val wrongHost = run(FakeCard(capacity = 137) { onLegacyHost })
        check(
            tagLink.locationId(NdefTag.uriFrom(onLegacyHost)) == HOIV_LOCATION,
            "precondition: the legacy-host card PARSES to the right uuid, so only bytes can catch it",
        )
        check(
            wrongHost is TagWriter.Outcome.Unverified,
            "a card that read back on the RENAMEABLE host is UNVERIFIED, though it parses clean: $wrongHost",
        )
    } else {
        check(false, "no legacy host in branding.properties — the strongest read-back case cannot run")
    }

    // And the control: an honest card verifies. Without this line every assertion above is
    // satisfied by a writer that returns Unverified unconditionally.
    check(run(FakeCard(capacity = 137)) is TagWriter.Outcome.Written, "THE CONTROL: an honest card still verifies")
}

// ---------------------------------------------------------------------------------
// 4. THE CARD IS NEVER LOCKED, AND A LOCKED CARD IS REFUSED.
//
//    Locking is irreversible. The stub's makeReadOnly()/canMakeReadOnly() THROW, so this
//    is not "the source does not contain the call" — it is "no path driven here reaches
//    it", which includes the paths where a tired implementation might have added it: after
//    a successful write, and after a failed verify.
// ---------------------------------------------------------------------------------
private fun theCardIsNeverLocked() {
    val locked = run(FakeCard(capacity = 137, writable = false))
    check(locked is TagWriter.Outcome.Refused.ReadOnly, "a tag locked by a previous owner is refused: $locked")
    check(!TagBus.wroteAnything(), "a locked tag is not written to")

    // Locked AND too small: the operator must be told the unfixable thing, or they fetch a
    // bigger tag and hit the same wall.
    val both = run(FakeCard(capacity = 46, writable = false))
    check(both is TagWriter.Outcome.Refused.ReadOnly, "locked beats too-small: $both")

    // Every path driven in this file, checked in one place. The stub throws on the call, so
    // reaching it would already have crashed the run — this catches the case where someone
    // "helpfully" stubs it out again.
    check(
        TagBus.calls.none { it.contains("makeReadOnly") },
        "makeReadOnly is never called: ${TagBus.trace()}",
    )
}

// ---------------------------------------------------------------------------------
// 5. THE TAG LEFT THE FIELD. Every one of these happens in a stairwell, holding a phone
//    at arm's length against a card screwed to a wall.
// ---------------------------------------------------------------------------------
private fun transportFailures() {
    val gone = run(FakeCard(capacity = 137, connectThrows = "tag out of range"))
    check(gone is TagWriter.Outcome.Lost, "a tag that cannot be connected to is Lost, not failed: $gone")
    check(!TagBus.wroteAnything(), "nothing is written to a tag we never connected to")

    // The write itself throws. THE CARD IS NOW SUSPECT — it may hold a partial message —
    // and the one thing that must not happen is a Written verdict.
    val died = run(FakeCard(capacity = 137, writeThrows = "tag lost mid-write"))
    check(died is TagWriter.Outcome.Unverified, "a write that threw is UNVERIFIED, never Written: $died")
    check(
        (died as? TagWriter.Outcome.Unverified)?.reason == "IOException",
        "the reason names the exception, so a field report is diagnosable: $died",
    )
    check(TagBus.calls.last() == "close", "the tag is released even when the write threw")

    // The read-back throws: the write landed, and we cannot say what is on the card.
    val blind = run(FakeCard(capacity = 137, readThrows = "tag lost before re-read"))
    check(blind is TagWriter.Outcome.Unverified, "a read-back that threw is UNVERIFIED: $blind")
    check(TagBus.calls.last() == "close", "the tag is released when the read-back threw")
}

// ---------------------------------------------------------------------------------
// 6. NOT NDEF-FORMATTED. Refused rather than formatted blind: an unformatted tag reports
//    no capacity until it has been formatted, so format-then-write is precisely the
//    unguarded write this whole class exists to prevent.
// ---------------------------------------------------------------------------------
private fun notFormatted() {
    val raw = run(FakeCard(capacity = 137, ndefCapable = false))
    check(raw is TagWriter.Outcome.Refused.NotFormatted, "a non-NDEF tag is refused, not formatted: $raw")
    check(!TagBus.wroteAnything(), "a non-NDEF tag is not written to")
    check(TagBus.calls.none { it == "connect" }, "and it is not even connected to: ${TagBus.trace()}")

    val formattable = run(FakeCard(capacity = 137, ndefCapable = false, formattable = true))
    check(
        (formattable as? TagWriter.Outcome.Refused.NotFormatted)?.techs?.contains("formattable") == true,
        "a formattable tag says so, so the operator knows a tag tool will fix it: $formattable",
    )
}
