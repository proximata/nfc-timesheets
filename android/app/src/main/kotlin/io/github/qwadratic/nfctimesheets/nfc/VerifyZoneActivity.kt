package io.github.qwadratic.nfctimesheets.nfc

import android.content.Context
import android.net.Uri
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import io.github.qwadratic.nfctimesheets.AppLocale
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone
import io.github.qwadratic.nfctimesheets.core.WireZoneShiftPage
import io.github.qwadratic.nfctimesheets.core.WireZoneVerifyResult
import io.github.qwadratic.nfctimesheets.core.Zones
import io.github.qwadratic.nfctimesheets.ui.BuildingPicker
import io.github.qwadratic.nfctimesheets.ui.TimeSheetsTheme
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * THE TEST SCAN — an operator, in the field, with the mounted card in hand, proving that a
 * zone's card actually resolves to that zone before a cleaner is ever allowed to clock in
 * on it (decision-47).
 *
 * A MODE OF THE SAME JOB SCANACTIVITY DOES, A SEPARATE SCREEN FROM IT. Both screens read an
 * NFC tag in the foreground and turn it into a place id — that half is one job, one shape,
 * and this file is deliberately no more than that shape plus the operator's own network
 * call, the same relationship [WriteTagActivity] already has to it. What must NOT be one
 * job is what happens AFTER the id is known: [ScanActivity] converges into the platform's
 * own tap-launch intent and hands off into the worker's clock-in inbox, on purpose — that
 * convergence is the whole point of that screen, described in its own header. Folding a
 * second, incompatible ending into that same `onTag` as a runtime "mode" flag would put the
 * one branch that must never open a shift one `if` away from the one branch whose entire
 * job is to open one. This class is a SEPARATE type instead: it never starts that intent,
 * never hands anything to that inbox, and never touches the worker-session client anywhere
 * in it — a property of the wiring, not a rule someone has to remember, and
 * `android/checks/verify-no-shift-check.sh` proves exactly that against the compiled source.
 *
 * CANNOT OPEN A SHIFT, STRUCTURALLY. Every network call this screen makes goes out over
 * `app.operatorApi`, which carries the `ts_operator` cookie (TimeSheetsApplication), and no
 * route that touches a shift accepts that cookie (decision-45, routes/operator.js's own file
 * header). There is no credential here with which to open one.
 *
 * ROLE-GATED THE SAME WAY [WriteTagActivity] gates its write: reader mode is never enabled
 * without a `ts_operator` session read from DISK on every resume — no network call, nothing
 * to be slow, nothing to fail at the one moment an operator is standing at a door with no
 * signal. Since decision-54 §4 this screen is also UNREACHABLE without that session (the
 * gate is ui/TimeSheetApp.kt's OperatorSection), so the inline operator-code field that used
 * to live here is gone; the structural gate above it is untouched and still the thing that
 * makes a card physically unreadable without a session. What remains for `!operatorReady` is
 * one sentence for a session that dies mid-screen, never a second code form.
 *
 * ORDER, AND WHY THE ZONE IS PICKED BEFORE ANY CARD IS READ: the equality check in
 * `POST /operator/zones/:id/verify` — "does this card resolve to THIS zone" — only means
 * anything if the operator committed to which zone they are testing before they knew what
 * the card would say. "Stamp whatever was scanned" would happily bless a card mounted on
 * the wrong door, which is the single most likely honest mistake on a field visit.
 */
class VerifyZoneActivity : ComponentActivity() {

    private val app: TimeSheetsApplication get() = application as TimeSheetsApplication
    private var adapter: NfcAdapter? = null

    private var nfcState by mutableStateOf(NfcState.READY)
    private var operatorReady by mutableStateOf(false)

    private var zones by mutableStateOf<List<WireOperatorZone>>(emptyList())
    private var zonesLoading by mutableStateOf(false)
    private var zonesError by mutableStateOf(false)

    private var selectedZone by mutableStateOf<WireOperatorZone?>(null)
    private var checking by mutableStateOf(false)
    private var outcome by mutableStateOf<VerifyOutcome?>(null)

    private var bindStep by mutableStateOf<BindStep>(BindStep.Idle)
    private var bindBuilding by mutableStateOf<WireOperatorLocation?>(null)

    private var shifts by mutableStateOf<WireZoneShiftPage?>(null)
    private var shiftsLoading by mutableStateOf(false)
    private var shiftsError by mutableStateOf(false)

    /** What a completed test scan showed. Rendered as a named sentence, never a raw code. */
    private sealed interface VerifyOutcome {
        data class Verified(val result: WireZoneVerifyResult) : VerifyOutcome
        data class Mismatch(val selectedZoneName: String) : VerifyOutcome
        data object Unbound : VerifyOutcome
        data object UnknownLocation : VerifyOutcome
        data object UnknownZone : VerifyOutcome
        data class Unreadable(val techs: List<String>, val uid: String) : VerifyOutcome
        data class Failure(val serverSide: Boolean) : VerifyOutcome
    }

    /**
     * BINDING AN UNBOUND ZONE (decision-54 §3) — the branch this screen takes INSTEAD of a
     * test scan, never before one and never after one.
     *
     * A zone with no building cannot be verified, and that is not a policy in this file: the
     * server's `activePlace` INNER JOINs `locations`, so no card on earth resolves to an
     * unbound zone and the verify would answer 422 for every card the operator held up. So
     * reader mode is never started for such a zone at all — the same absence-of-a-callback
     * gate the operator session already uses, for the same reason: a refusal the operator can
     * trigger is a refusal they will trigger, in a stairwell, with a card in their hand.
     */
    private sealed interface BindStep {
        /** The zone is already bound, or none is selected. Renders nothing. */
        data object Idle : BindStep
        data object Loading : BindStep
        data class Picking(val locations: List<WireOperatorLocation>) : BindStep

        /** The list did not load. RETRYABLE, and a dead end until it does: no building, no scan. */
        data class LoadFailed(val code: String) : BindStep
        data object Submitting : BindStep

        /**
         * Bound just now. The zone is a scan target from here on, so this state renders one
         * sentence and then gets out of the way of the ordinary scan body below it.
         */
        data class Bound(val building: String) : BindStep
        data class Failed(val code: String) : BindStep
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        adapter = NfcAdapter.getDefaultAdapter(this)

        setContent {
            TimeSheetsTheme {
                Scaffold { padding ->
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(padding)
                            .padding(24.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(stringResource(R.string.verify_title), style = MaterialTheme.typography.headlineSmall)
                        Text(stringResource(R.string.verify_hint), style = MaterialTheme.typography.bodyMedium)

                        when (nfcState) {
                            NfcState.UNSUPPORTED -> Text(stringResource(R.string.scan_unsupported))
                            NfcState.DISABLED -> Text(stringResource(R.string.scan_disabled))
                            NfcState.READY -> ReadyBody()
                        }

                        Button(
                            onClick = { finish() },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.scan_close)) }
                    }
                }
            }
        }
    }

    @Composable
    private fun ReadyBody() {
        if (!operatorReady) {
            Text(
                stringResource(R.string.operator_session_expired),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            return
        }

        val zone = selectedZone
        if (zone == null) {
            Text(stringResource(R.string.verify_pick_zone_hint), style = MaterialTheme.typography.titleMedium)
            if (zonesLoading && zones.isEmpty()) Text(stringResource(R.string.verify_zones_loading))
            if (zonesError) {
                Text(stringResource(R.string.verify_zones_error), color = MaterialTheme.colorScheme.error)
            }
            if (!zonesLoading && zones.isEmpty() && !zonesError) {
                Text(stringResource(R.string.verify_zones_empty))
            }
            for (z in zones) {
                OutlinedButton(
                    onClick = { selectZone(z) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) {
                    Column(Modifier.fillMaxWidth()) {
                        // An unbound zone is named as such rather than hidden: it is on this
                        // worklist precisely so an operator can finish it (decision-54 §1).
                        Text("${z.locationName ?: getString(R.string.verify_zone_no_building)} \u00b7 ${z.name}")
                        Text(
                            if (!z.isBound) {
                                stringResource(R.string.verify_zone_status_unbound)
                            } else if (z.isVerified) {
                                getString(R.string.verify_zone_status_verified, z.verifiedAt?.let(::formatted).orEmpty())
                            } else {
                                stringResource(R.string.verify_zone_status_pending)
                            },
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
            return
        }

        Text(
            stringResource(
                R.string.verify_selected,
                zone.name,
                zone.locationName ?: getString(R.string.verify_zone_no_building),
            ),
            style = MaterialTheme.typography.titleMedium,
        )

        // NO BUILDING, NO SCAN. The bind form replaces the scan body entirely — it does not
        // sit above a screen that is simultaneously waiting for a card it could never accept.
        if (!zone.isBound) {
            BindBody(zone)
            OutlinedButton(
                onClick = ::changeZone,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.verify_change_zone)) }
            return
        }

        (bindStep as? BindStep.Bound)?.let {
            Text(
                getString(R.string.verify_bind_done, zone.name, it.building),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        // liveRegion: the operator is holding a phone against a wall and cannot hunt the
        // screen for what changed.
        Text(
            text = statusLine(),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )

        // DEBUG BUILDS ONLY. verifyTapSimulations() is defined twice, once in src/debug/
        // with real scenarios and once in src/release/ returning an empty list — same
        // split as nfc/WriteSimulation.kt, and android/checks/release-artefact.sh checks
        // it the same way: against the compiled dex, not against this source file.
        for (simulation in verifyTapSimulations(zone, zones, app.tagLink)) {
            OutlinedButton(
                onClick = { handleRead(simulation.techs, simulation.uid, simulation.uriString) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text("\u25b6 ${simulation.label}") }
        }

        ZonePage(zone)

        OutlinedButton(
            onClick = ::changeZone,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_change_zone)) }
    }

    /**
     * The bind form: which building is this zone in? [BuildingPicker] is the SAME list the
     * write flow uses to name a fresh card (ui/BuildingPicker.kt) — one question asked at two
     * moments, not two lists that will disagree later.
     *
     * THERE IS NO SKIP HERE, unlike the write flow. "No building" is the state the operator
     * came here to leave; walking away from it is picking a different zone off the worklist,
     * which the button below this form already does.
     */
    @Composable
    private fun BindBody(zone: WireOperatorZone) {
        Text(stringResource(R.string.verify_bind_hint), style = MaterialTheme.typography.titleMedium)
        when (val step = bindStep) {
            BindStep.Idle, BindStep.Loading -> Text(stringResource(R.string.verify_bind_loading))
            BindStep.Submitting -> Text(stringResource(R.string.verify_bind_submitting))
            is BindStep.Bound -> Unit

            is BindStep.LoadFailed -> {
                Text(
                    getString(R.string.verify_bind_load_failed, step.code),
                    color = MaterialTheme.colorScheme.error,
                )
                OutlinedButton(
                    onClick = ::loadBindLocations,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_bind_retry)) }
            }

            is BindStep.Failed -> {
                Text(
                    getString(R.string.verify_bind_failed, step.code),
                    color = MaterialTheme.colorScheme.error,
                )
                // Back to the picker with the pick still in place: nothing is retapped to retry.
                OutlinedButton(
                    onClick = ::loadBindLocations,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_bind_retry)) }
            }

            is BindStep.Picking -> {
                BuildingPicker(
                    locations = step.locations,
                    selectedId = bindBuilding?.id,
                    emptyText = stringResource(R.string.verify_bind_locations_empty),
                    onPick = { bindBuilding = it },
                )
                Button(
                    onClick = { submitBind(zone) },
                    enabled = bindBuilding != null,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_bind_submit)) }
            }
        }
    }

    /**
     * THE ZONE PAGE (decision-54 §7) — what this door actually did this month, shown only once
     * the card in the operator's hand has been proved against this zone. Before that the
     * operator has no reason to trust that this list is the door in front of them.
     *
     * WORKER, START, END, DURATION. No rate, no euro figure, no client name — the same line
     * the endpoint itself holds (decision-6/42/43): a zone is not a costing unit.
     *
     * THE TOTAL IS THE SERVER'S, for the whole month, and is NOT summed from the page on
     * screen. Fifty rows labelled "the month" would be a lie on the one figure here anybody
     * would act on.
     */
    @Composable
    private fun ZonePage(zone: WireOperatorZone) {
        val page = shifts
        if (page == null && !shiftsLoading && !shiftsError) return

        Text(stringResource(R.string.verify_shifts_title), style = MaterialTheme.typography.titleMedium)
        if (shiftsLoading) Text(stringResource(R.string.verify_shifts_loading))
        if (shiftsError) {
            Text(stringResource(R.string.verify_shifts_error), color = MaterialTheme.colorScheme.error)
            OutlinedButton(
                onClick = { loadShifts(zone, shifts?.page ?: 1) },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.verify_bind_retry)) }
        }
        if (page == null) return

        if (page.shifts.isEmpty()) Text(stringResource(R.string.verify_shifts_empty))
        for (row in page.shifts) {
            Text(
                getString(
                    R.string.verify_shifts_row,
                    row.workerName,
                    dateTimeFormat.format(row.startTime),
                    row.endTime?.let(timeFormat::format) ?: getString(R.string.verify_shifts_open),
                    hoursMinutes(row.durationMinutes),
                ),
                style = MaterialTheme.typography.bodySmall,
            )
        }

        Text(
            getString(R.string.verify_shifts_total, hoursMinutes(page.totalMinutes)),
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            getString(R.string.verify_shifts_page, page.page),
            style = MaterialTheme.typography.bodySmall,
        )
        if (page.hasPrevious) {
            OutlinedButton(
                onClick = { loadShifts(zone, page.page - 1) },
                enabled = !shiftsLoading,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.verify_shifts_previous)) }
        }
        if (page.hasNext) {
            OutlinedButton(
                onClick = { loadShifts(zone, page.page + 1) },
                enabled = !shiftsLoading,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.verify_shifts_next)) }
        }
    }

    override fun onResume() {
        super.onResume()
        val nfc = adapter
        nfcState = when {
            nfc == null -> NfcState.UNSUPPORTED
            !nfc.isEnabled -> NfcState.DISABLED
            else -> NfcState.READY
        }
        // Re-read on every resume, not once in onCreate: enrolment can have happened in
        // another screen, and a session can have been cleared while this one was backgrounded.
        operatorReady = app.operatorCookies.header() != null
        if (operatorReady) {
            loadZonesFromCache()
            lifecycleScope.launch { refreshZones() }
        }
        startReaderMode()
    }

    override fun onPause() {
        super.onPause()
        adapter?.disableReaderMode(this)
    }

    /**
     * NO OPERATOR SESSION, NO ZONE PICKED, NO READER MODE. The gate is the absence of the
     * callback, exactly as [WriteTagActivity.startReaderMode] documents it: with reader
     * mode never enabled the NFC service never delivers a tag to this screen at all, so
     * there is no code path on which an unpicked or unauthorised scan touches a card.
     */
    private fun startReaderMode() {
        // AND NO UNBOUND ZONE EITHER (decision-54 §3): no card can resolve to a zone with no
        // building, so a scan here could only ever end in a 422. The gate is again the absence
        // of the callback, not a message after the fact.
        if (!operatorReady || selectedZone?.isBound != true) return
        val nfc = adapter ?: return
        if (!nfc.isEnabled) return
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        nfc.enableReaderMode(this, ::onTag, flags, null)
    }

    /**
     * The zone is picked BEFORE any card is read — see this class's header for why that order
     * is the whole point. Since decision-54 the choice forks here: a bound zone goes straight
     * to the test scan as it always did, an unbound one goes to the building picker and does
     * not start reader mode at all.
     */
    private fun selectZone(zone: WireOperatorZone) {
        selectedZone = zone
        outcome = null
        checking = false
        bindBuilding = null
        shifts = null
        shiftsError = false
        if (zone.isBound) {
            bindStep = BindStep.Idle
            startReaderMode()
        } else {
            loadBindLocations()
        }
    }

    private fun changeZone() {
        adapter?.disableReaderMode(this)
        selectedZone = null
        outcome = null
        checking = false
        bindStep = BindStep.Idle
        bindBuilding = null
        shifts = null
        shiftsError = false
    }

    /** GET /operator/locations — the same list the write flow's picker loads. */
    private fun loadBindLocations() {
        bindStep = BindStep.Loading
        // DEBUG BUILDS ONLY, and never for a zone the server sent: simulatedBindLocations()
        // is empty in src/release/ and isSimulatedZone() is constantly false there, so this
        // branch does not exist in a shipped build (nfc/VerifySimulation.kt).
        val zone = selectedZone
        if (zone != null && isSimulatedZone(zone)) {
            bindStep = BindStep.Picking(simulatedBindLocations())
            return
        }
        lifecycleScope.launch {
            bindStep = try {
                BindStep.Picking(app.operatorApi.operatorLocations())
            } catch (e: ApiFailure) {
                BindStep.LoadFailed(e.code)
            } catch (_: Exception) {
                BindStep.LoadFailed("unknown")
            }
        }
    }

    /**
     * POST /operator/zones/:id/bind. The zone the server hands back REPLACES the worklist row,
     * in [selectedZone] and in [zones] both: it now has a building (so reader mode may start)
     * and its `verified_at` has been cleared by the bind (decision-54 §3), which is exactly the
     * state the test scan below expects to find. Keeping the stale row would offer a scan
     * against a zone this screen still believed was unbound.
     */
    private fun submitBind(zone: WireOperatorZone) {
        val building = bindBuilding ?: return
        bindStep = BindStep.Submitting
        lifecycleScope.launch {
            try {
                val bound = if (isSimulatedZone(zone)) {
                    runBindSimulation(zone, building)
                } else {
                    app.operatorApi.bindZone(zone.id, building.id)
                }
                zones = zones.map { if (it.id == bound.id) bound else it }
                // The DISK cache is deliberately not rewritten here: it stores the worklist
                // envelope's exact bytes (nfc/OperatorZoneCache), and this response is one zone,
                // not that envelope. The next resume refreshes it from the server anyway.
                selectedZone = bound
                bindStep = BindStep.Bound(bound.locationName ?: building.name)
                startReaderMode()
            } catch (e: ApiFailure) {
                bindStep = BindStep.Failed(e.code)
            } catch (_: Exception) {
                bindStep = BindStep.Failed("unknown")
            }
        }
    }

    /**
     * GET /operator/zones/:id/shifts?page=N, after a verify landed. The MONTH is not sent — the
     * server decides it from its own clock, so the rows and the total can never name different
     * months (net/Api.kt says why).
     */
    private fun loadShifts(zone: WireOperatorZone, page: Int) {
        shiftsLoading = true
        lifecycleScope.launch {
            try {
                shifts = if (isSimulatedZone(zone)) {
                    runShiftsSimulation(page)
                } else {
                    app.operatorApi.zoneShifts(zone.id, page)
                }
                shiftsError = false
            } catch (_: Exception) {
                // The verify already succeeded and the card is proved; a failed read of the
                // month's history is a missing list, never a failed test scan.
                shiftsError = true
            }
            shiftsLoading = false
        }
    }

    /** Called off the main thread by the NFC service. */
    private fun onTag(tag: Tag) {
        // Belt and braces behind the reader-mode gate: disableReaderMode is asynchronous,
        // so a tag dispatched microseconds after the zone was cleared could still land here.
        if (!operatorReady || selectedZone == null) return
        val techs = tag.techList.map { it.substringAfterLast('.') }
        val uid = tag.id.joinToString(":") { "%02X".format(it) }
        val uri = readUri(tag)?.toString()
        runOnUiThread { handleRead(techs, uid, uri) }
    }

    /**
     * THE SHARED SHAPE WITH [ScanActivity], AND WHERE IT ENDS. Resolve a tag reading to a
     * place id exactly as ScanActivity's onTag does — a real URI first, then a roster/
     * worklist serial match, never the compiled [KnownTags] fallback (this screen only ever
     * proves a ZONE, and KnownTags names only the grandfathered HOIV BUILDING tap, which
     * this screen has no business touching). Then: nothing that launches an intent at all.
     * A POST to `/operator/zones/:id/verify` over the operator session, and nothing else.
     */
    private fun handleRead(techs: List<String>, uid: String, uriString: String?) {
        val target = selectedZone ?: return
        val fromUri = app.tagLink.locationId(uriString)
        val fromSerial = if (fromUri == null) matchSerial(uid) else null
        val placeUuid = fromUri ?: fromSerial

        if (placeUuid == null) {
            outcome = VerifyOutcome.Unreadable(techs, uid)
            return
        }

        checking = true
        outcome = null
        lifecycleScope.launch {
            outcome = try {
                val result = if (isSimulatedZone(target)) {
                    runVerifySimulation(target)
                } else {
                    app.operatorApi.verifyZone(target.id, placeUuid)
                }
                // The zone page follows a proof and never precedes one (decision-54 §7) —
                // including on a re-scan of an already-verified zone, which is the ordinary way
                // an operator revisits a door to see what happened there.
                loadShifts(target, 1)
                VerifyOutcome.Verified(result)
            } catch (e: ApiFailure) {
                when (e.code) {
                    "zone_mismatch" -> VerifyOutcome.Mismatch(target.name)
                    "tag_unbound" -> VerifyOutcome.Unbound
                    "unknown_location" -> VerifyOutcome.UnknownLocation
                    "unknown_zone" -> VerifyOutcome.UnknownZone
                    else -> VerifyOutcome.Failure(serverSide = e.status == 0 || e.status >= 500)
                }
            } catch (_: Exception) {
                VerifyOutcome.Failure(serverSide = true)
            }
            checking = false
        }
    }

    /**
     * An adopted, URL-less card matched against THIS worklist's own serial map — never
     * against the compiled [KnownTags] table (decision-44's pin: no serial travels to the
     * server; the phone matches it client-side, exactly `/roster`'s idiom, and posts the
     * resolved PLACE id). Matches against the whole worklist, not only the selected zone,
     * so a card genuinely mounted on a different zone's door is reported as `zone_mismatch`
     * by the server's own equality check rather than silently treated as unreadable.
     */
    private fun matchSerial(uid: String): String? {
        val normalised = Zones.normaliseSerial(uid) ?: return null
        return zones.firstOrNull { Zones.normaliseSerial(it.tagSerial) == normalised }?.id
    }

    /**
     * First URI record of the NDEF message. Everything is wrapped: the tag is unlocked and
     * attacker-writable (decision-15), so a malformed record is a normal event, not a crash.
     * Byte-for-byte the same read [ScanActivity] performs.
     */
    private fun readUri(tag: Tag): Uri? = runCatching {
        val ndef = Ndef.get(tag) ?: return null
        ndef.connect()
        val message = try {
            ndef.ndefMessage ?: ndef.cachedNdefMessage
        } finally {
            runCatching { ndef.close() }
        }
        message?.records?.firstNotNullOfOrNull { record -> runCatching { record.toUri() }.getOrNull() }
    }.getOrNull()

    private fun loadZonesFromCache() {
        if (zones.isEmpty()) show(app.operatorZones.read())
    }

    /**
     * The worklist as drawn: the server's rows, plus the debug simulator's two (one unbound,
     * one bound), which are an empty list in a release build and therefore not there at all.
     * They are appended and never merged in — a simulated row cannot displace or shadow a real
     * zone, it can only sit after the last of them.
     */
    private fun show(list: List<WireOperatorZone>) {
        zones = list + simulatedZones()
    }

    private suspend fun refreshZones() {
        zonesLoading = true
        try {
            val envelope = app.operatorApi.operatorZones()
            app.operatorZones.write(envelope)
            show(Wire.operatorZones(envelope))
            zonesError = false
        } catch (_: Exception) {
            zonesError = true
        } finally {
            zonesLoading = false
        }
    }

    private fun statusLine(): String = when {
        checking -> getString(R.string.verify_checking)
        outcome != null -> outcomeText(outcome!!)
        else -> getString(R.string.verify_waiting)
    }

    private fun outcomeText(o: VerifyOutcome): String = when (o) {
        is VerifyOutcome.Verified -> if (o.result.alreadyVerified) {
            getString(R.string.verify_already, formatted(o.result.verifiedAt))
        } else {
            getString(R.string.verify_ok)
        }
        is VerifyOutcome.Mismatch -> getString(R.string.verify_mismatch, o.selectedZoneName)
        VerifyOutcome.Unbound -> getString(R.string.verify_unbound)
        VerifyOutcome.UnknownLocation -> getString(R.string.verify_unknown_location)
        VerifyOutcome.UnknownZone -> getString(R.string.verify_unknown_zone)
        is VerifyOutcome.Unreadable -> getString(R.string.verify_no_uri, o.techs.joinToString(", "), o.uid)
        is VerifyOutcome.Failure ->
            getString(if (o.serverSide) R.string.verify_server_error else R.string.verify_network_error)
    }

    private fun formatted(instant: Instant): String = dateTimeFormat.format(instant)

    /**
     * Minutes as h:mm. The minutes come from the SERVER, already derived in SQL from
     * COALESCE(end_time, now()) — this phone rounds a number, and does no date arithmetic and
     * no timezone work of its own.
     */
    private fun hoursMinutes(minutes: Double): String {
        val whole = minutes.toLong()
        return "%d:%02d".format(whole / 60, whole % 60)
    }

    private companion object {
        val dateTimeFormat: DateTimeFormatter =
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

        /** Ends are shown time-only: a shift's end is the same day as the start it sits beside. */
        val timeFormat: DateTimeFormatter =
            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())
    }
}
