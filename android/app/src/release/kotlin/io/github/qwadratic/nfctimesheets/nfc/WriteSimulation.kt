package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.TagLink

/**
 * RELEASE BUILDS. The debug counterpart of this file (`src/debug/.../WriteSimulation.kt`)
 * can pretend a tag is present, is too small, is locked, or came back corrupt — which is the
 * only way to exercise the write screen on an emulator, where NFC hardware does not exist.
 *
 * None of that code is here, and that is the point. This is not a disabled feature behind a
 * flag; in a release build there is no simulator to disable. `writeSimulations()` returns an
 * empty list, the screen renders no simulate control, and [runSimulation] cannot be called
 * because nothing can produce a [WriteSimulation] to pass it.
 *
 * The claim is checked against the ARTEFACT, not against this comment: see
 * `android/checks/release-artefact.sh`, which greps the compiled dex of the signed release
 * .apk for the simulator's own strings and class members.
 */
data class WriteSimulation(
    val label: String,
    val capacity: Int,
    val writable: Boolean,
)

/** Always empty in a release build. Nothing constructs a [WriteSimulation] here. */
fun writeSimulations(): List<WriteSimulation> = emptyList()

/**
 * Unreachable by construction: [writeSimulations] is the only source of its argument and it
 * is always empty. Present only so the two source sets expose the same surface to the screen.
 */
fun runSimulation(
    simulation: WriteSimulation,
    tagLink: TagLink,
    locationId: String?,
): TagWriter.Outcome = TagWriter.Outcome.Refused.BadId(locationId)
