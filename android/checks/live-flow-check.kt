package io.github.qwadratic.nfctimesheets.checks

import android.nfc.Tag
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WriteGuard
import io.github.qwadratic.nfctimesheets.nfc.TagWriter
import io.github.qwadratic.nfctimesheets.nfc.runSimulation
import io.github.qwadratic.nfctimesheets.nfc.writeSimulations
import java.io.File
import java.util.UUID
import kotlin.system.exitProcess

/**
 * THE PHONE HALF OF `ops/prove-live.sh`, RUN AGAINST THE ROW THAT IS ACTUALLY IN PRODUCTION.
 *
 *     LIVE_HOIV_ID=<uuid read out of the live database> \
 *       ./checks/live-flow.sh <outdir>
 *
 * WHY IT IS NOT `tag-writer-check.kt` AGAIN. That check drives nfc/TagWriter against fake
 * cards and a HARDCODED constant that *says* it is the building in production. Nothing ever
 * asked production. This one is handed the uuid `ops/prove-live.sh` has just SELECTed off
 * the live box, so "a card holding HOIV's uuid is refused" stops being a claim about a
 * constant in a source file and becomes a claim about the building the cleaners tap.
 * If someone re-creates that building tomorrow with a different id, this goes red.
 *
 * WHY IT RUNS THE DEBUG MOCK AND THE REAL WRITER, ON THE SAME CARD, AND COMPARES THEM.
 * The emulator has no NFC field, so `src/debug/WriteSimulation.kt` is what an operator taps
 * on a debug build in place of a card — and a mock that has drifted from nfc/TagWriter is
 * worse than no mock at all: it would show a refusal on screen that the shipping build does
 * not perform. So every scenario here is run TWICE — once through `runSimulation()` (the
 * debug button) and once through the real `TagWriter.write()` against `checks/fake` — and
 * the two verdicts must agree, class for class and field for field. § 2.
 *
 * WHAT IT EMITS. `<outdir>/facts.tsv` (key<TAB>value) and `<outdir>/screen-*.txt`, which is
 * the German the operator would actually read, rendered from `res/values/strings.xml` —
 * not a paraphrase typed here. `ops/prove-live.sh` asserts against those files and prints
 * them, so "the screen" is evidence in the transcript rather than a description of one.
 *
 * WHAT IT STILL CANNOT PROVE, and no code on a laptop can: that a real NTAG213 reports
 * maxSize 137, that the platform's encoder agrees byte-for-byte, or anything about a tag
 * pulled out of the field. backlog/docs/CORE-FLOW.md § 4 is where those live.
 */

private var failed = false
private val facts = LinkedHashMap<String, String>()

private fun check(ok: Boolean, what: String) {
    if (ok) {
        println("  ok:   $what")
    } else {
        println("  FAIL: $what")
        failed = true
    }
}

private fun fact(key: String, value: String) {
    facts[key] = value
}

// ---- branding, never a literal host ------------------------------------------------------
private val branding = java.util.Properties().apply {
    File("branding.properties").inputStream().use { load(it) }
}
private val tagLink = TagLink(
    branding.getProperty("ts.tagHost").trim(),
    (branding.getProperty("ts.legacyTagHosts") ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() },
)
private val writer = TagWriter(tagLink)

/**
 * THE BUILDING IN PRODUCTION, read off the live database by the caller. Absent = this check
 * refuses to run, rather than falling back to a constant: a fallback is exactly how the
 * hardcoded id in tag-writer-check.kt came to be trusted without ever being compared.
 */
private val liveHoiv: String = System.getenv("LIVE_HOIV_ID")?.trim().orEmpty()

private fun tag(uid: String = "04A2B3C4D5E680") =
    Tag(uid.chunked(2).map { it.toInt(16).toByte() }.toByteArray(), arrayOf("android.nfc.tech.Ndef"))

private fun write(card: FakeCard, locationId: String?, confirmedOverwriteOf: String? = null): TagWriter.Outcome {
    TagBus.present(card)
    return writer.write(tag(), locationId, confirmedOverwriteOf)
}

/** The card an operator takes out of the packet. */
private fun blank(capacity: Int = 137) = FakeCard(capacity = capacity)

/** A card that is already on a wall, carrying [id] in exactly the bytes we burn. */
private fun mounted(id: String) = FakeCard(capacity = 137, initial = NdefTag.message(tagLink.uriFor(id)?.toString()))

// =========================================================================================
// THE GERMAN, READ OUT OF res/values/strings.xml
// =========================================================================================
//
// WriteTagActivity renders these with getString(R.string.x, ...). Off a device there is no
// resource table, so the XML is parsed and formatted here. That is a SECOND copy of the
// rendering logic and copies drift, so § 5 reads WriteTagActivity.kt itself and fails if it
// mentions a write_* string this renderer does not know how to produce.

private val stringsXml = File("app/src/main/res/values/strings.xml").readText()

private val strings: Map<String, String> = Regex(
    """<string name="([^"]+)"(?:\s[^>]*)?>(.*?)</string>""",
    RegexOption.DOT_MATCHES_ALL,
).findAll(stringsXml).associate { m ->
    m.groupValues[1] to m.groupValues[2]
        .replace("\\n", "\n")
        .replace("\\'", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#8230;", "\u2026")
}

private fun de(name: String, vararg args: Any?): String {
    val raw = strings[name] ?: run {
        check(false, "res/values/strings.xml has no <string name=\"$name\">")
        return "<<missing $name>>"
    }
    return String.format(raw, *args)
}

/** Mirrors WriteTagActivity.outcomeText() + replacedNote(). */
private fun screen(outcome: TagWriter.Outcome, confirmedFor: String? = null): String = when (outcome) {
    is TagWriter.Outcome.Written ->
        de("write_ok", outcome.locationId, outcome.bytes, outcome.capacity, outcome.serial) +
            when (val r = outcome.replaced) {
                WriteGuard.Existing.Blank -> ""
                is WriteGuard.Existing.Foreign -> "\n\n" + de("write_replaced_foreign", r.summary)
                is WriteGuard.Existing.Ours -> "\n\n" + de("write_replaced_ours", r.locationId)
            }
    is TagWriter.Outcome.Refused.Occupied ->
        if (confirmedFor == outcome.onTag) de("write_confirm_armed", outcome.onTag)
        else de("write_occupied", outcome.onTag, outcome.token)
    is TagWriter.Outcome.Refused.TooSmall -> de("write_too_small", outcome.capacity, outcome.needed)
    is TagWriter.Outcome.Refused.ReadOnly -> de("write_read_only")
    is TagWriter.Outcome.Refused.NoCapacity -> de("write_no_capacity")
    is TagWriter.Outcome.Refused.NotFormatted -> de("write_not_formatted", outcome.techs.joinToString(", "))
    is TagWriter.Outcome.Refused.BadId -> de("write_bad_id")
    is TagWriter.Outcome.Unverified -> de("write_unverified", outcome.reason)
    is TagWriter.Outcome.Lost -> de("write_lost")
}

/**
 * The two things that are NOT drift when the mock and the real writer are compared.
 *
 * THE SERIAL. A simulation has no card, so `runSimulation` stamps "SIMULATED" where the
 * writer puts the UID `checks/fake` hands it. Comparing those would fail every scenario for
 * the one reason that is guaranteed and meaningless.
 *
 * NOTHING ELSE IS FORGIVEN. In particular the read-back reason in parentheses is not: it is
 * how the mock's truncated-write scenario was found to say `mismatch` where the shipping
 * build says `FormatException`.
 */
private fun comparable(text: String): String =
    text.replace(Regex("""Seriennummer: \S+"""), "Seriennummer: <the card's own>")

/** The keys this renderer knows. § 5 compares it against what the Activity actually uses. */
private val renderedKeys = setOf(
    "write_ok", "write_replaced_foreign", "write_replaced_ours", "write_confirm_armed",
    "write_occupied", "write_too_small", "write_read_only", "write_no_capacity",
    "write_not_formatted", "write_bad_id", "write_unverified", "write_lost",
)

private lateinit var outDir: File

private fun saveScreen(name: String, text: String) {
    File(outDir, "screen-$name.txt").writeText(text)
    println("  ┌─ screen: $name")
    text.trim().lines().forEach { println("  │ $it") }
    println("  └─")
}

// =========================================================================================

fun main(argv: Array<String>) {
    outDir = File(argv.getOrNull(0) ?: "checks/.live-out").apply { mkdirs() }

    if (TagLink.normalizedUuid(liveHoiv) == null) {
        System.err.println("live-flow-check: LIVE_HOIV_ID must be the uuid read off the LIVE database; got '$liveHoiv'")
        exitProcess(2)
    }
    fact("live_hoiv_id", liveHoiv)
    println("live-flow-check — the building in production is $liveHoiv")

    theMockNamesTheLiveBuilding()
    theMockAgreesWithTheShippingWriter()
    theOperatorWritesTwoBlankCards()
    theLiveCardCannotBeOverwritten()
    theUltralightIsRefused()
    theRendererHasNotDriftedFromTheScreen()
    theUnboundTapSpeaksGerman()

    File(outDir, "facts.tsv").writeText(facts.entries.joinToString("\n") { "${it.key}\t${it.value}" } + "\n")

    if (failed) {
        println("\nLIVE-FLOW CHECK FAILED")
        exitProcess(1)
    }
    println("\nlive-flow-check OK — ${facts.size} facts written to ${outDir.path}/facts.tsv")
}

// -----------------------------------------------------------------------------------------
/**
 * § 1 — THE MOCK'S IDEA OF "THE BUILDING IN PRODUCTION" IS THE BUILDING IN PRODUCTION.
 *
 * src/debug/WriteSimulation.kt carries a private `HOIV_LOCATION` constant and a scenario
 * that pre-loads a card with it, described as "the card on a wall at the client's building".
 * Nothing has ever checked that sentence. The constant is private, so it is recovered the
 * only honest way: encode the scenario's own card and read the id back off the bytes with
 * the same parser a tap uses.
 */
private fun theMockNamesTheLiveBuilding() {
    println("\n== 1 · the debug mock's mounted card carries the LIVE building id")
    val mountedSim = writeSimulations().firstOrNull { it.initial(tagLink) != null && it.label.contains("MOUNTED") }
    if (mountedSim == null) {
        check(false, "src/debug/WriteSimulation.kt no longer ships a MOUNTED-card scenario")
        return
    }
    val onCard = tagLink.locationId(NdefTag.uriFrom(mountedSim.initial(tagLink)))
    fact("mock_mounted_id", onCard ?: "")
    check(onCard == liveHoiv, "the mock's mounted card holds $onCard, production holds $liveHoiv")
}

// -----------------------------------------------------------------------------------------
/**
 * § 2 — THE DEBUG BUTTON AND THE SHIPPING WRITER RETURN THE SAME VERDICT.
 *
 * Every scenario in the mock, replayed against `checks/fake` through the real TagWriter.
 * Compared by the rendered outcome (class + the fields the screen shows), because that is
 * exactly what an operator would compare: what the phone says.
 *
 * Not covered by construction: `NotFormatted` and `Lost`, which the mock cannot express —
 * it starts after `Ndef.get()` and `connect()` have already succeeded. tag-writer-check
 * owns those.
 */
private fun theMockAgreesWithTheShippingWriter() {
    println("\n== 2 · every debug scenario, replayed through the real TagWriter")
    val offered = "11111111-2222-4333-8444-555555555599"
    for (sim in writeSimulations()) {
        val mock = runSimulation(sim, tagLink, offered, confirmedOverwriteOf = null)
        val real = write(
            FakeCard(
                capacity = sim.capacity,
                writable = sim.writable,
                initial = sim.initial(tagLink),
                onWrite = sim.corrupt,
            ),
            offered,
        )
        val same = mock::class == real::class && comparable(screen(mock)) == comparable(screen(real))
        check(same, "«${sim.label}» -> mock ${mock::class.simpleName}, writer ${real::class.simpleName}")
        if (!same) {
            println("      mock says:")
            comparable(screen(mock)).trim().lines().forEach { println("        $it") }
            println("      the shipping writer says:")
            comparable(screen(real)).trim().lines().forEach { println("        $it") }
        }
    }
    fact("mock_scenarios", writeSimulations().size.toString())
}

// -----------------------------------------------------------------------------------------
/**
 * § 3 — TWO BLANK CARDS, WRITTEN AND VERIFIED. These two ids are what `ops/prove-live.sh`
 * then reports to the live office, resolves into a building and a zone, and taps. The phone
 * mints them offline, before the server has heard of either (WriteTagActivity's header).
 */
private fun theOperatorWritesTwoBlankCards() {
    println("\n== 3 · the operator writes two blank NTAG213s")
    for ((role, uid) in listOf("building" to "04AA01020304AA", "zone" to "04BB01020304BB")) {
        val id = UUID.randomUUID().toString()
        TagBus.present(blank())
        val outcome = writer.write(tag(uid), id)
        val written = outcome as? TagWriter.Outcome.Written
        check(written != null, "$role card: ${outcome::class.simpleName}")
        if (written == null) continue
        check(written.locationId == id, "$role card carries the id the phone minted")
        check(written.replaced == WriteGuard.Existing.Blank, "$role card replaced nothing")
        check(TagBus.wroteAnything(), "$role card was actually written (call log: ${TagBus.trace()})")
        // The bytes on the card decode, through the platform's decoder, to a tap on that id.
        val decoded = tagLink.locationId(TagBus.card.content?.let { NdefTag.uriFrom(it) })
        check(decoded == id, "$role card reads back as a tap on $id")
        fact("tag_$role", id)
        fact("tag_${role}_serial", written.serial)
        fact("tag_${role}_bytes", written.bytes.toString())
        saveScreen("write-$role", screen(outcome))
    }
}

// -----------------------------------------------------------------------------------------
/**
 * § 4 — TASK-220 AGAINST LIVE DATA. A card carrying the uuid the cleaners actually tap,
 * presented to the write screen while it is offering a fresh id.
 *
 * Four claims, and the last is the one that matters:
 *   a. it is REFUSED, and the refusal names the id on the card
 *   b. NOTHING was written — `writeNdefMessage` is absent from the observed call log
 *   c. the wrong six characters, and the six characters of the OFFERED id (which are on the
 *      same screen and are the obvious thing to copy), do not authorise anything
 *   d. the right six characters DO, and the screen then says the live id is gone
 */
private fun theLiveCardCannotBeOverwritten() {
    println("\n== 4 · a card holding the LIVE HOIV id, presented to the write screen")
    val offered = UUID.randomUUID().toString()
    fact("guard_offered_id", offered)

    val refused = write(mounted(liveHoiv), offered)
    val occupied = refused as? TagWriter.Outcome.Refused.Occupied
    check(occupied != null, "presenting the live card gives ${refused::class.simpleName} (want Occupied)")
    if (occupied == null) return
    check(occupied.onTag == liveHoiv, "the refusal names the live id ${occupied.onTag}")
    check(occupied.offered == offered, "the refusal names what would have been written")
    check(!TagBus.wroteAnything(), "NOTHING was written — call log: ${TagBus.trace()}")
    check(TagBus.card.content.contentEquals(mounted(liveHoiv).initial), "the card still holds the live id")
    fact("guard_token", occupied.token)
    check(occupied.token == liveHoiv.takeLast(6).lowercase(), "the token is the last six of the LIVE id")
    saveScreen("guard-refused", screen(refused))

    // (c) the confirmations that must not work.
    check(!WriteGuard.confirms(liveHoiv, ""), "an empty box confirms nothing")
    check(!WriteGuard.confirms(liveHoiv, "abc123"), "six wrong characters confirm nothing")
    check(!WriteGuard.confirms(liveHoiv, offered.takeLast(6)), "the OFFERED id's last six confirm nothing")
    check(WriteGuard.confirms(liveHoiv, occupied.token), "the live id's last six do confirm")
    check(WriteGuard.confirms(liveHoiv, " ${occupied.token.uppercase()} "), "typed loudly, with a stray space, still confirms")

    // A confirmation is bound to ONE id: confirming the live card does not license another.
    val other = "c0ffee00-dead-4bee-8fee-0123456789ab"
    val stillRefused = write(mounted(other), offered, confirmedOverwriteOf = liveHoiv)
    check(
        stillRefused is TagWriter.Outcome.Refused.Occupied && !TagBus.wroteAnything(),
        "confirming the live id does not license a DIFFERENT mounted card (${stillRefused::class.simpleName})",
    )

    // (d) the override, and the warning it produces.
    val overridden = write(mounted(liveHoiv), offered, confirmedOverwriteOf = liveHoiv)
    val done = overridden as? TagWriter.Outcome.Written
    check(done != null, "with the right six characters it writes (${overridden::class.simpleName})")
    if (done == null) return
    check(done.replaced == WriteGuard.Existing.Ours(liveHoiv), "and it reports destroying the LIVE id")
    val text = screen(overridden)
    check(text.contains(liveHoiv), "the screen names the id that was destroyed")
    saveScreen("guard-overridden", text)
    saveScreen("guard-armed", screen(refused, confirmedFor = liveHoiv))
}

// -----------------------------------------------------------------------------------------
/**
 * § 5 — THE 46-BYTE ULTRALIGHT. The foreign card mounted at HOIV holds 46 bytes and our
 * message needs 64. This is the one refusal `CORE-FLOW.md` § 4 step 2 exists to confirm on
 * real hardware, and all this can say is that the code refuses when the card SAYS 46.
 */
private fun theUltralightIsRefused() {
    println("\n== 5 · the foreign 46-byte Ultralight")
    val outcome = write(blank(capacity = 46), UUID.randomUUID().toString())
    val small = outcome as? TagWriter.Outcome.Refused.TooSmall
    check(small != null, "46 bytes gives ${outcome::class.simpleName} (want TooSmall)")
    if (small == null) return
    check(!TagBus.wroteAnything(), "the Ultralight was not touched — call log: ${TagBus.trace()}")
    fact("ultralight_needed", small.needed.toString())
    fact("ultralight_capacity", small.capacity.toString())
    saveScreen("ultralight", screen(outcome))
}

// -----------------------------------------------------------------------------------------
/**
 * § 6 — THIS FILE'S GERMAN RENDERER HAS NOT DRIFTED FROM THE SCREEN IT CLAIMS TO BE.
 *
 * `screen()` above is a second implementation of WriteTagActivity.outcomeText(). The
 * Activity imports Android and cannot be compiled here, so it is read as text: every
 * `R.string.write_*` it mentions in an outcome branch must be a key this renderer produces,
 * and every key must exist in the XML. Add a case to the Activity without one here and the
 * transcript would quietly print an old sentence.
 */
private fun theRendererHasNotDriftedFromTheScreen() {
    println("\n== 6 · the rendered German is the string the Activity actually uses")
    val activity = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/WriteTagActivity.kt").readText()
    val used = Regex("""R\.string\.(write_\w+)""").findAll(activity).map { it.groupValues[1] }.toSortedSet()
    // Not outcome text: the title, the hint, the buttons, the report line, the enrol box.
    val notOutcome = setOf(
        "write_title", "write_hint", "write_pending_id", "write_report_sending", "write_report_sent",
        "write_report_failed", "write_report_needs_operator", "write_report_retry", "write_operator_code",
        "write_operator_enrol", "write_needs_operator_to_write", "write_waiting", "write_confirm_label",
        "write_confirm_button",
    )
    val outcomeKeys = used - notOutcome
    for (key in outcomeKeys) {
        check(key in renderedKeys, "WriteTagActivity uses R.string.$key and this renderer produces it")
    }
    for (key in renderedKeys + notOutcome) {
        check(strings.containsKey(key), "res/values/strings.xml defines $key")
    }
    fact("outcome_strings", outcomeKeys.size.toString())
}

// -----------------------------------------------------------------------------------------
/**
 * § 7 — THE TAP ON AN UNBOUND TAG, IN GERMAN.
 *
 * The server answers 422 `tag_unbound`. core/ApiFailure maps it, and the worker reads a
 * sentence — not a code, not a blank line, and NOT the generic `err_rejected` bucket
 * either: this WILL happen in real life (a card gets mounted at a door before the office
 * resolves it in `/tags/`), it is not a rare server refusal, and "report this shift" is the
 * wrong instruction — there IS no shift, nothing was ever opened. `err_tag_unbound` names
 * what a cleaner actually has to do: this tag is not assigned yet, tell the office.
 */
private fun theUnboundTapSpeaksGerman() {
    println("\n== 7 · what a cleaner reads when the card is unbound")
    val failure = ApiFailure(status = 422, code = "tag_unbound")
    val key = failure.messageKey
    fact("unbound_key", key)
    check(!failure.isRetryable, "an unbound tag is NOT retried forever — a human has to act")
    check(key == "err_tag_unbound", "tag_unbound must map to its OWN key, not fold into err_rejected: got '$key'")
    val sentence = strings[key]
    check(sentence != null, "res/values/strings.xml defines $key")
    if (sentence == null) return
    check(sentence.any { it.isLetter() } && !sentence.contains("tag_unbound"), "it is a sentence, not the error code")
    val generic = strings["err_rejected"]
    check(sentence != generic, "must not be word-for-word the generic rejection sentence")
    fact("unbound_de", sentence)
    saveScreen("tap-unbound", sentence)
}
