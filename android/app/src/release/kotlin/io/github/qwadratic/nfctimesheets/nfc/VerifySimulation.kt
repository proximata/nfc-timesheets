package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone

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
