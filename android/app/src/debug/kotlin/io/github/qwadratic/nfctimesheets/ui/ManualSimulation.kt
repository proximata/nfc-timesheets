package io.github.qwadratic.nfctimesheets.ui

import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireShift
import org.json.JSONObject
import java.time.Instant

/**
 * DEBUG BUILDS ONLY (decision-56). There is a file with this exact name and package in
 * `src/release/` whose two list functions return empty lists and which contains none of the
 * code below — the same source-set split, for the same reason, as nfc/WriteSimulation.kt
 * and nfc/VerifySimulation.kt: a `BuildConfig.DEBUG` flag would leave these classes and
 * strings inside the shipped APK, one flipped boolean from a build that can tell a worker a
 * shift was opened on a server that was never asked. Checked against the artefact, not the
 * source: android/checks/release-artefact.sh greps the release dex for the labels below.
 *
 * WHY IT EXISTS. The manual paths are the two paths with no card in them, so they are also
 * the two that CANNOT be exercised on a device without a live server, a verified place and a
 * worker session — and the refusals (422 unbound/unverified, 409 already open) need the
 * server to be in a state nobody can produce on demand. AC #3 of TASK-289 is precisely that
 * those refusals read as the tap path's own copy, and this is the only way to look at them.
 *
 * IT SIMULATES THE ANSWER, NOT THE SCREEN. A simulation supplies exactly what
 * `net/Api.openShift`/`closeShift` would have returned or thrown, and nothing else: the
 * store write, the local row, the signals and the error-key lookup are the real ones, so a
 * refusal shown here is the string the real refusal shows. Nothing here is a canned screen.
 */
data class ManualSimulation(
    val label: String,
    /** Returns the server's WireShift, or THROWS the ApiFailure the server would have. */
    val answer: (clientUuid: String, workerId: Int, locationId: String, at: Instant) -> WireShift,
)

/**
 * Every fixture goes through the REAL decoder ([Wire.shift]) rather than being a hand-built
 * data class, so a field rename in Wire.kt breaks this file instead of letting a simulation
 * keep passing against a shape the app no longer parses.
 */
private fun openedShift(clientUuid: String, workerId: Int, locationId: String, at: Instant): WireShift =
    Wire.shift(
        JSONObject(
            """
            {"id":900001,"worker_id":$workerId,"location_id":"$locationId",
             "start_time":"${Wire.string(at)}","end_time":null,"auto_closed":false,
             "corrected_at":null,"client_uuid":"$clientUuid"}
            """.trimIndent(),
        ),
    )

fun manualOpenSimulations(): List<ManualSimulation> = listOf(
    ManualSimulation("SIMULATED manual start: the server accepts it") { uuid, worker, location, at ->
        openedShift(uuid, worker, location, at)
    },
    // The three refusals decision-56 §4 names by name. Each is the EXACT status/code pair
    // server/routes/app.js answers with, so what appears on the screen is what a worker in a
    // stairwell would read.
    ManualSimulation("SIMULATED manual start: 422 the zone tag is not bound yet") { _, _, _, _ ->
        throw ApiFailure(status = 422, code = "tag_unbound")
    },
    ManualSimulation("SIMULATED manual start: 422 the zone is not verified") { _, _, _, _ ->
        throw ApiFailure(status = 422, code = "zone_unverified")
    },
    ManualSimulation("SIMULATED manual start: 409 a shift is already open") { _, _, _, _ ->
        throw ApiFailure(status = 409, code = "shift_already_open")
    },
    ManualSimulation("SIMULATED manual start: the phone has no signal") { _, _, _, _ ->
        throw ApiFailure(status = 0, code = "network")
    },
)

fun manualCloseSimulations(): List<ManualSimulation> = listOf(
    ManualSimulation("SIMULATED manual stop: closed and flagged") { uuid, worker, location, at ->
        Wire.shift(
            JSONObject(
                """
                {"id":900001,"worker_id":$worker,"location_id":"$location",
                 "start_time":"${Wire.string(at.minusSeconds(3600))}","end_time":"${Wire.string(at)}",
                 "auto_closed":false,"corrected_at":"${Wire.string(at)}","client_uuid":"$uuid"}
                """.trimIndent(),
            ),
        )
    },
    ManualSimulation("SIMULATED manual stop: the phone has no signal") { _, _, _, _ ->
        throw ApiFailure(status = 0, code = "network")
    },
)
