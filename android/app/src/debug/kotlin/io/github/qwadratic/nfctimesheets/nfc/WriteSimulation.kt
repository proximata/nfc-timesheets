package io.github.qwadratic.nfctimesheets.nfc

import android.nfc.FormatException
import android.nfc.NdefMessage
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation
import io.github.qwadratic.nfctimesheets.core.WireResolvedZone
import io.github.qwadratic.nfctimesheets.core.WriteGuard
import org.json.JSONObject

/**
 * DEBUG BUILDS ONLY. There is a file with this exact name and package in `src/release/`
 * whose [writeSimulations] returns an empty list and which contains none of the code below.
 *
 * WHY THIS IS A SOURCE SET AND NOT AN `if (BuildConfig.DEBUG)`. A flag leaves the simulator's
 * classes, strings and branches inside the shipped APK, one reflective call or one flipped
 * boolean away from a build that tells an operator a card was written when no card was
 * present. Splitting by source set makes the release artefact contain no such code at all,
 * which is a claim that can be checked against the .apk rather than against the source —
 * and `android/checks/release-artefact.sh` does exactly that.
 *
 * WHY IT EXISTS AT ALL. NFC hardware does not work on an emulator: there is no field, no
 * tag, and `enableReaderMode` never fires. Everything downstream of the tag read — the
 * refusal screens, the report call, the retry after a failed report — would otherwise be
 * unexercisable anywhere except a client's building with a client's cards.
 *
 * IT SIMULATES THE TAG, NOT THE ANSWER. Each scenario supplies only the two facts a real
 * tag supplies (capacity, writability) and, for the write itself, the bytes the card would
 * hold afterwards. The verdict still comes from `core/NdefTag.plan()` and
 * `core/NdefTag.verified()` — the same functions the real path calls. A simulation that
 * returned a canned Outcome would be a screen test that proves nothing about the writer.
 *
 * AND IT IS HELD TO THAT. `android/checks/live-flow-check.kt` § 2 replays every scenario
 * below through the REAL nfc/TagWriter against a fake card and fails unless the two produce
 * the same screen, word for word (the serial excepted — there is no card to have one). That
 * is not decoration: it caught the truncated-write scenario telling the operator the
 * read-back "mismatch"ed while the shipping build says `FormatException`, because this file
 * compared raw bytes where TagWriter parses them through the platform first. A mock that
 * shows a refusal the shipped build does not perform is worse than no mock.
 */
data class WriteSimulation(
    val label: String,
    val capacity: Int,
    val writable: Boolean,
    /**
     * What the card ALREADY holds, minted from the build's own [TagLink]. null = blank.
     * Drives the TASK-220 overwrite guard.
     *
     * A FUNCTION OF TagLink and not a constant: the tag host is typed once, in
     * branding.properties, and android/checks fails on any occurrence of it under app/src.
     * A simulation with its own copy of the host would also be a simulation that keeps
     * passing after the host changes.
     *
     * DECLARED BEFORE [corrupt] on purpose: [corrupt] must stay the LAST parameter, because
     * every scenario below passes it as a trailing lambda and Kotlin binds a trailing lambda
     * to the last parameter — put this one after it and the six existing scenarios silently
     * hand their corruption function to the wrong field.
     */
    val initial: (TagLink) -> ByteArray? = { null },
    /** What the card holds after the write. null = the read-back itself failed. */
    val corrupt: (ByteArray) -> ByteArray?,
)

/**
 * The building in production. A card carrying this id is a card on a wall at the client's
 * building, which is exactly the card the overwrite guard exists to refuse.
 */
private const val HOIV_LOCATION = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"

fun writeSimulations(): List<WriteSimulation> = listOf(
    WriteSimulation("NTAG213, 137 bytes — writes and verifies", 137, true) { it },
    WriteSimulation("the foreign Ultralight at HOIV — 46 bytes", 46, true) { it },
    WriteSimulation("locked by a previous owner", 137, false) { it },
    WriteSimulation("verify fails: one flipped byte in the uuid", 137, true) { bytes ->
        bytes.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 0x01).toByte() }
    },
    WriteSimulation("verify fails: the card reads back empty", 137, true) { null },
    WriteSimulation("verify fails: truncated mid-write", 137, true) { it.copyOfRange(0, it.size - 6) },
    // TASK-220, without a card: the emulator has no NFC, so this is the only way to see the
    // refusal, the confirmation box and the override on a screen before a stairwell.
    WriteSimulation(
        label = "a MOUNTED card — already holds the HOIV id",
        capacity = 137,
        writable = true,
        initial = { link -> NdefTag.message(link.uriFor(HOIV_LOCATION)?.toString()) },
        corrupt = { it },
    ),
    WriteSimulation(
        label = "a foreign card — holds somebody else's URL",
        capacity = 137,
        writable = true,
        initial = { NdefTag.message("https://example.com/hello") },
        corrupt = { it },
    ),
)

// ---- decision-54 §2: what the card is FOR, without a server -----------------------------

/**
 * THE BUILDING LIST THE PICKER WOULD HAVE FETCHED. `GET /operator/locations`, canned.
 *
 * WHY THIS ONE MOCKS THE ANSWER when [writeSimulations] pointedly does not. The tag half of
 * this screen has real decision functions to run — [NdefTag.plan], [WriteGuard.decide] — so a
 * canned Outcome would prove nothing about them. The zone half has none: everything that
 * decides anything (is the name free, does the building exist, is the tag already resolved)
 * lives in Postgres, on the other side of a request. What is left on THIS side is the step
 * sequence, the enabled-ness of the submit button and the two endings — and those are
 * unreachable on an emulator, where there is no server and no card to have been written.
 *
 * IT STILL GOES THROUGH THE REAL DECODER. Every fixture below is JSON text handed to
 * `core/Wire`, never a hand-built data class: the field names here are therefore checked
 * against the ones the screen will really parse, and a rename in Wire breaks this file rather
 * than quietly letting a simulation keep passing with the old shape.
 */
private const val LOCATIONS_JSON = """
{"locations":[
  {"id":"5111d0de-0000-4000-8000-0000000000a1","name":"SIMULATED: Stiegengasse 3"},
  {"id":"5111d0de-0000-4000-8000-0000000000a2","name":"SIMULATED: Hauptplatz 12"}
]}
"""

/**
 * The buildings both pickers show with no server: this screen's (a fresh card) and
 * nfc/VerifyZoneActivity's bind form, which reads it from here rather than keeping a second
 * list — one question asked at two moments, one fixture, exactly as ui/BuildingPicker.kt is
 * one composable for the same reason.
 */
fun simulatedLocations(): List<WireOperatorLocation> = Wire.operatorLocations(JSONObject(LOCATIONS_JSON))

/**
 * One canned entry into the zone step, as if a card had just been written AND reported —
 * which is the only state that step is ever drawn in, and a state an emulator cannot reach.
 *
 * TWO SCENARIOS AND NOT ONE, because bound and unbound are the two ENDINGS of decision-54 §2
 * and they diverge before the submit, not after it: [building] null preselects Skip. The
 * picker itself stays live either way — the operator can tap a different building, or tap
 * Skip after all — so this preselects the branch under test without disabling the form it is
 * meant to exercise.
 */
data class ZoneSimulation(
    val label: String,
    val zoneName: String,
    val building: WireOperatorLocation?,
)

fun zoneSimulations(): List<ZoneSimulation> {
    val locations = simulatedLocations()
    return listOf(
        ZoneSimulation(
            label = "SIMULATED: geschrieben und gemeldet \u2014 Zone MIT Gebaeude",
            zoneName = "Stiege A",
            building = locations.first(),
        ),
        ZoneSimulation(
            label = "SIMULATED: geschrieben und gemeldet \u2014 Zone OHNE Gebaeude",
            zoneName = "Stiege B",
            building = null,
        ),
    )
}

/**
 * `POST /operator/tags/:id/resolve-zone`, answered here instead of over the network — the
 * route's own 201 body, decoded by the same [Wire.resolvedZone] the real call uses.
 *
 * ECHOES THE ARGUMENTS rather than returning a fixed row: the screen's ending depends on
 * whether `location_id` came back null, so a fixture that always said "bound" would render
 * the bound sentence for the Skip scenario and hide the only difference being tested.
 */
fun runZoneSimulation(name: String, locationId: String?): WireResolvedZone {
    val building = if (locationId == null) "null" else JSONObject.quote(locationId)
    return Wire.resolvedZone(
        JSONObject(
            "{\"id\":\"5111d0de-0000-4000-8000-0000000000b1\"" +
                ",\"name\":${JSONObject.quote(name)},\"location_id\":$building}",
        ),
    )
}

/**
 * Run a scenario through the REAL decision functions. Mirrors TagWriter.write() step for
 * step; the only thing replaced is where the two tag facts and the read-back come from.
 */
fun runSimulation(
    simulation: WriteSimulation,
    tagLink: TagLink,
    locationId: String?,
    confirmedOverwriteOf: String? = null,
): TagWriter.Outcome {
    val serial = "SIMULATED"
    val plan = NdefTag.plan(tagLink, locationId, simulation.capacity, simulation.writable)
    when (plan) {
        is NdefTag.Plan.BadId -> return TagWriter.Outcome.Refused.BadId(locationId)
        is NdefTag.Plan.ReadOnly -> return TagWriter.Outcome.Refused.ReadOnly(serial)
        is NdefTag.Plan.NotWritable -> return TagWriter.Outcome.Refused.NoCapacity(serial)
        is NdefTag.Plan.TooSmall ->
            return TagWriter.Outcome.Refused.TooSmall(plan.needed, plan.capacity, serial)
        is NdefTag.Plan.Write -> Unit
    }
    val write = plan as NdefTag.Plan.Write

    // The overwrite guard, run by the SAME functions TagWriter calls, and fed the same two
    // readings of the card: our strict bytes AND the platform decoder's own opinion
    // (`NdefRecord.toUri()`). Passing only the bytes would make this file stricter than the
    // shipping build about what counts as "one of ours" — i.e. it would show a card being
    // overwritten that the phone refuses.
    val existing = try {
        val onCard = simulation.initial(tagLink)?.let { NdefMessage(it) }
        WriteGuard.classify(
            tagLink,
            onCard?.toByteArray(),
            onCard?.records?.firstOrNull()?.toUri()?.toString(),
        )
    } catch (_: FormatException) {
        WriteGuard.Existing.Foreign(WriteGuard.UNREADABLE)
    }
    when (val verdict = WriteGuard.decide(existing, write.locationId, confirmedOverwriteOf)) {
        is WriteGuard.Verdict.Occupied -> return TagWriter.Outcome.Refused.Occupied(
            serial = serial,
            onTag = verdict.onTag,
            offered = verdict.offered,
            token = verdict.token,
        )
        is WriteGuard.Verdict.Proceed -> Unit
    }

    // THE READ-BACK GOES THROUGH THE PLATFORM PARSER, exactly as TagWriter's does:
    // `Ndef.getNdefMessage()` decodes before it returns bytes, so a card left holding half a
    // message throws FormatException there and never reaches NdefTag.verified() at all.
    // Comparing simulation.corrupt() output directly — which this did — reported `mismatch`
    // for a case the phone reports as `FormatException`.
    val readBack = try {
        simulation.corrupt(write.bytes)?.let { NdefMessage(it).toByteArray() }
    } catch (e: Exception) {
        return TagWriter.Outcome.Unverified(serial, e.javaClass.simpleName, onTag = null)
    }
    if (!NdefTag.verified(write.bytes, readBack)) {
        return TagWriter.Outcome.Unverified(
            serial = serial,
            reason = if (readBack == null) "empty" else "mismatch",
            onTag = readBack?.let { NdefTag.hex(it) },
        )
    }
    return TagWriter.Outcome.Written(
        locationId = write.locationId,
        uri = write.uri,
        serial = serial,
        bytes = write.bytes.size,
        capacity = simulation.capacity,
        replaced = existing,
    )
}
