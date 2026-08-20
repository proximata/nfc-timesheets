package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink

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
    /** What the card holds after the write. null = the read-back itself failed. */
    val corrupt: (ByteArray) -> ByteArray?,
)

fun writeSimulations(): List<WriteSimulation> = listOf(
    WriteSimulation("NTAG213, 137 bytes — writes and verifies", 137, true) { it },
    WriteSimulation("the foreign Ultralight at HOIV — 46 bytes", 46, true) { it },
    WriteSimulation("locked by a previous owner", 137, false) { it },
    WriteSimulation("verify fails: one flipped byte in the uuid", 137, true) { bytes ->
        bytes.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 0x01).toByte() }
    },
    WriteSimulation("verify fails: the card reads back empty", 137, true) { null },
    WriteSimulation("verify fails: truncated mid-write", 137, true) { it.copyOfRange(0, it.size - 6) },
)

/**
 * Run a scenario through the REAL decision functions. Mirrors TagWriter.write() step for
 * step; the only thing replaced is where the two tag facts and the read-back come from.
 */
fun runSimulation(
    simulation: WriteSimulation,
    tagLink: TagLink,
    locationId: String?,
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
    )
}
