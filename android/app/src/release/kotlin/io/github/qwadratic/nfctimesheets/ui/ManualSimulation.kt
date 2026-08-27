package io.github.qwadratic.nfctimesheets.ui

import io.github.qwadratic.nfctimesheets.core.WireShift
import java.time.Instant

/**
 * RELEASE BUILDS (decision-56). The debug counterpart of this file
 * (`src/debug/.../ui/ManualSimulation.kt`) can answer a manual clock-in or clock-out without
 * a server — the only way to see the 422/409 refusals on an emulator.
 *
 * None of that is here, and that is the point: this is not a feature behind a flag, there is
 * no simulator in a release build to disable. Both lists are empty, the two confirmation
 * dialogs render no simulate control, and [ManualSimulation.answer] can never run because
 * nothing constructs one. Checked against the .apk by android/checks/release-artefact.sh.
 */
data class ManualSimulation(
    val label: String,
    val answer: (clientUuid: String, workerId: Int, locationId: String, at: Instant) -> WireShift,
)

/** Always empty in a release build. Nothing constructs a [ManualSimulation] here. */
fun manualOpenSimulations(): List<ManualSimulation> = emptyList()

/** Always empty, same reason. The real POST /shifts/close is the only answer that exists. */
fun manualCloseSimulations(): List<ManualSimulation> = emptyList()
