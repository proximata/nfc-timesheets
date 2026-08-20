package io.github.qwadratic.nfctimesheets.checks

import android.nfc.Tag
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
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

private fun run(card: FakeCard, locationId: String? = HOIV_LOCATION): TagWriter.Outcome {
    TagBus.present(card)
    return writer.write(tag(), locationId)
}

fun main() {
    showTheBytes()
    happyPath()
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
    val written = TagBus.calls.first { it.startsWith("writeNdefMessage") }
        .substringAfter('[').substringBefore(']')
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
            TagBus.calls.first { it.startsWith("writeNdefMessage") },
            "getNdefMessage", "close",
        ),
        "EXACT call order — facts, then decision, then write, then re-read: ${TagBus.trace()}",
    )
    check(
        TagBus.calls.indexOf("getMaxSize") < TagBus.calls.indexOfFirst { it.startsWith("writeNdefMessage") },
        "capacity is read BEFORE the write, on the happy path too",
    )
    check(
        TagBus.calls.indexOfFirst { it.startsWith("writeNdefMessage") } < TagBus.calls.indexOf("getNdefMessage"),
        "the read-back happens AFTER the write, or it is reading the old card",
    )

    // A card that already holds a DIFFERENT valid message is simply overwritten. This is
    // also the case that would pass spuriously against a cache: the stub's cachedNdefMessage
    // throws, so reaching for it here is a crash rather than a green tick.
    val other = NdefTag.message("https://$host/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301")!!
    val over = run(FakeCard(capacity = 137, initial = other))
    check(over is TagWriter.Outcome.Written, "a card holding another building's URI is overwritten: $over")

    // The card that already holds EXACTLY what we are about to write. Byte equality alone
    // cannot tell this apart from a no-op, so the only thing that makes the Written verdict
    // honest is that a write really happened. Assert it did.
    val same = NdefTag.message("https://$host/t?l=$HOIV_LOCATION")!!
    val again = run(FakeCard(capacity = 137, initial = same))
    check(again is TagWriter.Outcome.Written, "re-writing the same URI is fine: $again")
    check(TagBus.wroteAnything(), "...and it was a REAL write, not a read-back of what was already there")
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
