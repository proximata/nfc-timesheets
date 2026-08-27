package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone
import io.github.qwadratic.nfctimesheets.core.WireReassignedZone
import io.github.qwadratic.nfctimesheets.core.WireTagClassification
import io.github.qwadratic.nfctimesheets.core.WireZoneShiftPage
import io.github.qwadratic.nfctimesheets.core.WireZoneVerifyResult
import java.time.Instant

/**
 * RELEASE BUILDS. The debug counterpart of this file (`src/debug/.../VerifySimulation.kt`)
 * can pretend a card carries a given zone's card, a mismatched zone's card, the
 * grandfathered HOIV building card, or nothing readable at all — which is the only way to
 * exercise [VerifyZoneActivity]'s outcome rendering on an emulator, where NFC hardware does
 * not exist.
 *
 * None of that is here, and that is the point — same split, same reasoning, same checking
 * script as `nfc/WriteSimulation.kt`'s release stub: `verifyTapSimulations()` returns an
 * empty list, the screen renders no simulate control once a zone is picked, and nothing
 * constructs a [VerifyTapSimulation] to pass anywhere. The claim is checked against the
 * ARTEFACT: `android/checks/release-artefact.sh` greps the compiled dex of the signed
 * release .apk for the simulator's own strings.
 */
data class VerifyTapSimulation(
    val label: String,
    val techs: List<String>,
    val uid: String,
    val uriString: String?,
)

/** Always empty in a release build. Nothing constructs a [VerifyTapSimulation] here. */
fun verifyTapSimulations(
    selected: WireOperatorZone,
    all: List<WireOperatorZone>,
    tagLink: TagLink,
): List<VerifyTapSimulation> = emptyList()

/**
 * decision-54's two new branches — the bind form and the zone page — have no fixtures here
 * either. The worklist a release build shows is the server's and only the server's, so no
 * zone on it can be simulated and none of the four functions below is ever reached: an
 * operator is never told a zone was bound, a card proved, or a month worked, without a
 * request having actually been made.
 */
fun simulatedZones(): List<WireOperatorZone> = emptyList()

/** Always false: [simulatedZones] is empty, so no zone the screen holds can be one of ours. */
fun isSimulatedZone(zone: WireOperatorZone): Boolean = false

/** Always empty — the real GET /operator/locations is the only source of buildings. */
fun simulatedBindLocations(): List<WireOperatorLocation> = emptyList()

/**
 * The four below are unreachable by construction: every caller is behind [isSimulatedZone],
 * which is constantly false here. Present only so both source sets expose the same surface
 * to the screen.
 */
fun runBindSimulation(zone: WireOperatorZone, location: WireOperatorLocation): WireOperatorZone = zone

fun runUnbindSimulation(zone: WireOperatorZone): WireOperatorZone = zone

fun runVerifySimulation(zone: WireOperatorZone): WireZoneVerifyResult = WireZoneVerifyResult(
    id = zone.id,
    name = zone.name,
    locationId = zone.locationId.orEmpty(),
    locationName = zone.locationName.orEmpty(),
    verifiedAt = Instant.EPOCH,
    alreadyVerified = false,
)

fun runShiftsSimulation(page: Int): WireZoneShiftPage =
    WireZoneShiftPage(shifts = emptyList(), page = page, pageSize = 0, matching = 0, totalMinutes = 0.0)

/**
 * decision-55's scan-first screen has no fixtures here either. A release build offers no card
 * to scan but a real one, and every scanned id goes to the real GET /operator/tags/:id.
 */
fun classifyTapSimulations(tagLink: TagLink): List<VerifyTapSimulation> = emptyList()

/**
 * ALWAYS NULL, which is what makes every scan in a release build a REAL request. An operator is
 * never told what a card is by anything but the server.
 */
fun simulatedClassification(id: String): WireTagClassification? = null

data class ReassignPickSimulation(
    val label: String,
    val location: WireOperatorLocation,
)

/**
 * Always empty. A release build's reassign picker is tapped by a human or not at all — the
 * guard on the submit (TASK-286) is the same code either way, only its debug demonstration is
 * missing here.
 */
fun reassignPickSimulations(
    zone: WireOperatorZone,
    locations: List<WireOperatorLocation>,
): List<ReassignPickSimulation> = emptyList()

/**
 * Unreachable by construction: its only caller is behind [isSimulatedZone], constantly false
 * here. Present so both source sets expose the same surface to the screen.
 */
fun runReassignSimulation(
    zone: WireOperatorZone,
    newTagId: String,
    location: WireOperatorLocation,
): WireReassignedZone = WireReassignedZone(zone = zone, retiredZoneId = null)

/**
 * decision-58 §3's write-fresh recovery has no fixtures here either. [noteSimulatedWrite] does
 * nothing and [isSimulatedTag] is CONSTANTLY FALSE, so in a shipped build every recovered card is
 * really written, really reported through POST /operator/tags, and really resolved into a zone by
 * the server — and [runFreshZoneSimulation] below is unreachable by construction.
 */
fun noteSimulatedWrite(tagId: String) = Unit

fun isSimulatedTag(tagId: String): Boolean = false

fun runFreshZoneSimulation(
    tagId: String,
    name: String,
    location: WireOperatorLocation?,
): WireOperatorZone = WireOperatorZone(
    id = tagId,
    locationId = location?.id,
    locationName = location?.name,
    name = name,
    tagSerial = null,
    tagDeployedAt = null,
    verifiedAt = null,
)
