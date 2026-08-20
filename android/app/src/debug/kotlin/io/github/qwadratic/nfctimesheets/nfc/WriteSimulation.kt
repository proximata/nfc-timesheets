package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WriteGuard

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

    // The overwrite guard, run by the SAME functions TagWriter calls. The mounted-card
    // scenario's `initial` is a real encoded message, so this is the real classification.
    val existing = WriteGuard.classify(tagLink, simulation.initial(tagLink))
    when (val verdict = WriteGuard.decide(existing, write.locationId, confirmedOverwriteOf)) {
        is WriteGuard.Verdict.Occupied -> return TagWriter.Outcome.Refused.Occupied(
            serial = serial,
            onTag = verdict.onTag,
            offered = verdict.offered,
            token = verdict.token,
        )
        is WriteGuard.Verdict.Proceed -> Unit
    }

    val readBack = simulation.corrupt(write.bytes)
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
