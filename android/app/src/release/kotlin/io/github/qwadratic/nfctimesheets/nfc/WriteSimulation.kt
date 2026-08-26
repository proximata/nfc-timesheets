package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation
import io.github.qwadratic.nfctimesheets.core.WireResolvedZone

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
    confirmedOverwriteOf: String? = null,
): TagWriter.Outcome = TagWriter.Outcome.Refused.BadId(locationId)

/**
 * decision-54 §2's zone step, absent for the same reason as everything above it: in a release
 * build there is no canned building list and no canned `resolve-zone` answer, so the screen
 * cannot tell an operator a zone was created when no request was ever made.
 */
data class ZoneSimulation(
    val label: String,
    val zoneName: String,
    val building: WireOperatorLocation?,
)

/** Always empty. Nothing constructs a [ZoneSimulation] here, so the picker is never entered. */
fun zoneSimulations(): List<ZoneSimulation> = emptyList()

/**
 * Always empty — the real `GET /operator/locations` is the only source of buildings in a
 * release build, on this screen and on nfc/VerifyZoneActivity's bind form both.
 */
fun simulatedLocations(): List<WireOperatorLocation> = emptyList()

/**
 * Unreachable by construction: the screen only calls this while a [ZoneSimulation] is the
 * thing that entered the zone step, and none can exist here. Present so both source sets
 * expose the same surface.
 */
fun runZoneSimulation(name: String, locationId: String?): WireResolvedZone =
    WireResolvedZone(id = "", name = name, locationId = locationId)
