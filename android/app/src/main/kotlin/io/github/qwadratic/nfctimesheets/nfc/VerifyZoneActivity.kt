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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone
import io.github.qwadratic.nfctimesheets.core.WireTagClassification
import io.github.qwadratic.nfctimesheets.core.WireZoneShiftPage
import io.github.qwadratic.nfctimesheets.core.WireZoneVerifyResult
import io.github.qwadratic.nfctimesheets.core.Zones
import io.github.qwadratic.nfctimesheets.ui.BuildingPicker
import io.github.qwadratic.nfctimesheets.ui.TimeSheetsTheme
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
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
 *
 * AND SINCE decision-55 §2, A SECOND WAY IN THAT INVERTS THAT ORDER — deliberately, and
 * without weakening it. With NO zone picked, a card scanned here is not verified against
 * anything: it is CLASSIFIED, read-only, by `GET /operator/tags/:id`, which answers what the
 * card IS. That is the shape of the honest mistake decision-47's own header names as the
 * reason this screen exists — a card in a drawer, a card on a door with no worklist entry.
 * `zone_mismatch` cannot fire on that path because there is nothing to mismatch AGAINST, and
 * it stays exactly as protective as it always was on the worklist-first path, which is
 * untouched: [selectZone] and its verify are the same lines they were. An ADDED entry point,
 * not a replacement.
 *
 * IT WRITES A CARD, IN EXACTLY ONE PLACE (decision-55 §3, [ReassignStep]). Reassigning a bound
 * zone's building needs a freshly written card before the server call, and it gets one through
 * the SAME `app.tagWriter` and the SAME `POST /operator/tags` report the write screen uses —
 * not a second copy of either. Nothing about that touches a shift: `TagWriter` puts bytes on a
 * card, and the report and the reassignment both go out over `app.operatorApi`.
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

    private var unbindStep by mutableStateOf<UnbindStep>(UnbindStep.Idle)
    private var unbindConfirming by mutableStateOf(false)

    private var scanStep by mutableStateOf<ScanStep>(ScanStep.Idle)

    private var reassignStep by mutableStateOf<ReassignStep>(ReassignStep.Idle)
    private var reassignBuilding by mutableStateOf<WireOperatorLocation?>(null)

    /**
     * The id the reassignment will write onto the NEW card. Minted on this phone before the
     * server has heard of it, for the reason [WriteTagActivity]'s header gives at length: the
     * operator is in a stairwell and a flow that needs a round trip before it can write a card
     * is a flow that fails where it is used. Re-minted only after one is actually consumed, so
     * a card re-presented after a failed read-back gets the SAME id.
     */
    private var reassignTagId by mutableStateOf(UUID.randomUUID().toString())

    private var freshStep by mutableStateOf<FreshStep>(FreshStep.Idle)
    private var freshName by mutableStateOf("")
    private var freshBuilding by mutableStateOf<WireOperatorLocation?>(null)

    /** The id the WRITE-FRESH recovery puts on the card. Minted here for [reassignTagId]'s reason. */
    private var freshTagId by mutableStateOf(UUID.randomUUID().toString())

    /** What a completed test scan showed. Rendered as a named sentence, never a raw code. */
    private sealed interface VerifyOutcome {
        data class Verified(val result: WireZoneVerifyResult) : VerifyOutcome
        data class Mismatch(val selectedZoneName: String) : VerifyOutcome
        data object Unbound : VerifyOutcome
        data object UnknownLocation : VerifyOutcome
        data object UnknownZone : VerifyOutcome
        data class Unreadable(
            val techs: List<String>,
            val uid: String,
            val diagnosis: TagLink.Diagnosis,
        ) : VerifyOutcome
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

    /**
     * UNBINDING A BOUND ZONE (TASK-277) — the way back out of a wrong building, and the only
     * one there is: [Api.bindZone] refuses a zone that already has a building, and decision-54
     * §2/§3 removed the admin panel's ability to touch a zone's building at all.
     *
     * IT IS NOT A DELETE and the confirmation says so. The zone, its card, its name and its
     * proof all survive; only the building goes, and binding it again puts one back.
     *
     * `zone_has_shifts` IS ITS OWN STATE, not a code in [Failed]. The server refuses a zone any
     * shift has ever referenced (a composite FK, not a check in this app), and that refusal is
     * a fact an operator standing at the door can act on — "this is the right building after
     * all" — where a code is not.
     */
    /**
     * SCAN FIRST, ASK WHAT THE CARD IS (decision-55 §1) — the state of the screen BEFORE any
     * zone is picked. Only [WireTagClassification.Zone] has anywhere to go; the other four are
     * one honest sentence each and offer no action, which is the decision and not an omission:
     * there is no operator screen for a building card, and turning a reported card into a zone
     * stays where it has always been, in the write flow.
     */
    private sealed interface ScanStep {
        /** Waiting for a card, with no zone picked. Renders the ordinary worklist. */
        data object Idle : ScanStep
        data object Checking : ScanStep
        data object Building : ScanStep
        data object Retired : ScanStep
        data object TagReported : ScanStep
        data object Unknown : ScanStep

        /** No URI and no worklist serial: never reached the server, because there was no id. */
        data class Unreadable(
            val techs: List<String>,
            val uid: String,
            val diagnosis: TagLink.Diagnosis,
        ) : ScanStep
        data class Failed(val code: String) : ScanStep
    }

    /**
     * REASSIGNING A BOUND ZONE'S BUILDING (decision-55 §3) — the door changed management
     * company, which is the case decision-40 split the whole system's two hostnames for.
     *
     * OFFERED ONLY ON A BOUND ZONE, because an unbound one has nothing to reassign: the bind
     * form is already the right question there, and the server says the same thing with 409
     * `zone_unbound`.
     *
     * IT COSTS A NEW CARD, AND THAT IS THE POINT. Nothing is moved: the old zone is retired
     * with its shifts and its proof intact, and a NEW zone is minted on a card this phone
     * writes first. A zone with any shift history structurally cannot have its building changed
     * in place — the composite shift FKs refuse it — so there is one path and not two.
     *
     *   pick building -> write a NEW card -> report it -> reassign -> the NEW zone's page
     *
     * The write and the report are [WriteTagActivity]'s own `app.tagWriter` and `reportTag`,
     * called here rather than copied.
     */
    private sealed interface ReassignStep {
        /** Not reassigning. Renders one button on a bound zone and nothing else. */
        data object Idle : ReassignStep
        data object Loading : ReassignStep
        data class Picking(val locations: List<WireOperatorLocation>) : ReassignStep

        /** The building list did not load. Retryable, and a dead end until it does. */
        data class LoadFailed(val code: String) : ReassignStep

        /** Building chosen; now hold a NEW, blank card against the phone. */
        data class AwaitingCard(val building: WireOperatorLocation) : ReassignStep

        /**
         * The card was NOT written. The old zone is untouched and the operator can present
         * another card — this is the one state that stays armed for a further tap.
         */
        data class WriteRefused(val building: WireOperatorLocation, val reason: String) : ReassignStep

        /** Card written; telling the office it exists, then reassigning in one go. */
        data object Submitting : ReassignStep

        /**
         * The card is written and correct but the server call did not land. RETRYABLE without
         * touching the card again: the report is idempotent and the reassignment is one
         * all-or-nothing statement, so repeating both is safe.
         */
        data class Failed(val building: WireOperatorLocation, val code: String) : ReassignStep

        /** Done. The screen has already moved to the NEW zone; this is one sentence over it. */
        data class Done(val zoneName: String, val building: String) : ReassignStep
    }

    /**
     * WRITE A FRESH CARD, FROM A DEAD END (decision-58 §3) — offered ONLY from an Unreadable
     * outcome, on both the worklist-first and the scan-first path.
     *
     * WHATEVER IS ON THE CARD, THE OPERATOR IS HOLDING IT. Before this, a card whose URI this
     * app cannot parse ended the screen: no id, so no classification, so no action at all. Now
     * it gets overwritten with a card that is guaranteed to work, because the same app writes
     * it and reads it back ([TagWriter], byte equality) — the same `app.tagWriter` and the same
     * `POST /operator/tags` the reassign flow above already uses, called and not copied.
     *
     * IT ENDS IN A ZONE, exactly as a fresh write from [WriteTagActivity] does: report the card,
     * then `POST /operator/tags/:id/resolve-zone` with a name and an optional building, then the
     * screen selects that new zone — whose very next step is the test scan it was already on.
     *
     * NO OVERWRITE OVERRIDE, for [applyReassignWrite]'s reason: a card already carrying one of
     * our ids is a card on somebody's wall, and `WriteGuard` refusing it is the right answer.
     */
    private sealed interface FreshStep {
        /** Not recovering. Renders one button under the unreadable sentence. */
        data object Idle : FreshStep

        /** Hold the card against the phone again — this time it gets written. */
        data object AwaitingCard : FreshStep

        /** Not written. The card is untouched and another one may be presented. */
        data class WriteRefused(val reason: String) : FreshStep

        /** Written; telling the office the card exists. */
        data object Reporting : FreshStep

        /** Reported. Name the door, optionally pick its building — the write flow's question. */
        data class Naming(val locations: List<WireOperatorLocation>) : FreshStep
        data object Submitting : FreshStep

        /**
         * The card is written and correct; a server call did not land. Retryable without
         * touching the card again — the report is idempotent and resolve-zone is one statement.
         */
        data class Failed(val code: String) : FreshStep
    }

    private sealed interface UnbindStep {
        data object Idle : UnbindStep
        data object Submitting : UnbindStep

        /** Done. The zone below has already flipped to unbound, so this is one sentence over it. */
        data class Unbound(val building: String) : UnbindStep

        /** 409 zone_has_shifts: somebody has clocked in here. Rendered as a sentence. */
        data object HasShifts : UnbindStep
        data class Failed(val code: String) : UnbindStep
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
            // SCAN FIRST (decision-55 §2). The card may be held up right now, before anything is
            // picked — reader mode is already running (see startReaderMode), so this is a
            // statement of fact and not an invitation to arm something.
            Text(stringResource(R.string.verify_scan_any_hint), style = MaterialTheme.typography.titleMedium)
            ScanFirstStatus()
            // THE DEAD END GETS AN EXIT (decision-58 §3). Same section, same writer, on both
            // paths — only the state that reveals it differs.
            if (scanStep is ScanStep.Unreadable) FreshCardSection()

            // DEBUG BUILDS ONLY, same split and same checking script as every other simulator
            // on this screen: classifyTapSimulations() is empty in src/release/.
            for (simulation in classifyTapSimulations(app.tagLink)) {
                OutlinedButton(
                    onClick = { handleScanFirst(simulation.techs, simulation.uid, simulation.uriString) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text("\u25b6 ${simulation.label}") }
            }

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

        UnbindStatus()

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
        if (outcome is VerifyOutcome.Unreadable) FreshCardSection()

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
        ReassignSection(zone)
        UnbindAction(zone)

        OutlinedButton(
            onClick = ::changeZone,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_change_zone)) }
    }

    /**
     * What the last scan-first card was, in one sentence. Four of the five kinds end here and
     * offer nothing else; the fifth ([WireTagClassification.Zone]) never renders in this state at
     * all, because it has already put a zone on the screen.
     */
    @Composable
    private fun ScanFirstStatus() {
        val text = when (val step = scanStep) {
            ScanStep.Idle -> return
            ScanStep.Checking -> stringResource(R.string.verify_scan_any_checking)
            ScanStep.Building -> stringResource(R.string.verify_scan_any_building)
            ScanStep.Retired -> stringResource(R.string.verify_scan_any_retired)
            ScanStep.TagReported -> stringResource(R.string.verify_scan_any_reported)
            ScanStep.Unknown -> stringResource(R.string.verify_scan_any_unknown)
            is ScanStep.Unreadable -> unreadableText(step.techs, step.uid, step.diagnosis)
            is ScanStep.Failed -> getString(R.string.verify_scan_any_failed, step.code)
        }
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = if (scanStep is ScanStep.Failed) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }

    /**
     * THE RECOVERY FROM AN UNREADABLE CARD (decision-58 §3). Drawn only under an Unreadable
     * state — both callers check that — and a button until it is used, because a screen that is
     * always ready to overwrite a card is a screen that eventually overwrites the wrong one.
     */
    @Composable
    private fun FreshCardSection() {
        when (val step = freshStep) {
            FreshStep.Idle -> {
                OutlinedButton(
                    onClick = ::startFreshCard,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_fresh_action)) }
                return
            }

            FreshStep.AwaitingCard -> Text(
                stringResource(R.string.verify_fresh_awaiting),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )

            is FreshStep.WriteRefused -> Text(
                getString(R.string.verify_fresh_write_failed, step.reason),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )

            FreshStep.Reporting -> Text(stringResource(R.string.verify_fresh_reporting))
            FreshStep.Submitting -> Text(stringResource(R.string.verify_fresh_submitting))

            is FreshStep.Naming -> {
                Text(
                    stringResource(R.string.verify_fresh_naming),
                    style = MaterialTheme.typography.titleMedium,
                )
                OutlinedTextField(
                    value = freshName,
                    onValueChange = { freshName = it },
                    label = { Text(stringResource(R.string.verify_fresh_name_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                // The same picker the bind and reassign forms use. No building is a resting
                // state, not a failure: the zone lands unbound and the bind form is the very
                // next thing this screen shows.
                BuildingPicker(
                    locations = step.locations,
                    selectedId = freshBuilding?.id,
                    emptyText = stringResource(R.string.verify_bind_locations_empty),
                    onPick = { freshBuilding = it },
                )
                Button(
                    onClick = ::submitFreshZone,
                    enabled = freshName.isNotBlank(),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_fresh_submit)) }
            }

            is FreshStep.Failed -> {
                Text(
                    getString(R.string.verify_fresh_failed, step.code),
                    color = MaterialTheme.colorScheme.error,
                )
                OutlinedButton(
                    onClick = ::submitFreshZone,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_reassign_retry)) }
            }
        }

        // DEBUG BUILDS ONLY, and the write screen's own fixtures: writeSimulations() is empty
        // in src/release/ (nfc/WriteSimulation.kt), so this loop draws nothing there.
        if (freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused) {
            for (simulation in writeSimulations()) {
                OutlinedButton(
                    onClick = {
                        noteSimulatedWrite(freshTagId)
                        applyFreshWrite(runSimulation(simulation, app.tagLink, freshTagId))
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("\u25b6 ${simulation.label}") }
            }
        }

        OutlinedButton(
            onClick = ::cancelFreshCard,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_fresh_cancel)) }
    }

    /** Arm the write. Reader mode is (re)started because this is now a tap that WRITES. */
    private fun startFreshCard() {
        freshStep = FreshStep.AwaitingCard
        freshName = ""
        freshBuilding = null
        startReaderMode()
    }

    private fun cancelFreshCard() {
        freshStep = FreshStep.Idle
        freshBuilding = null
        startReaderMode()
    }

    /** One step after [TagWriter] has spoken, on the UI thread. */
    private fun applyFreshWrite(result: TagWriter.Outcome) {
        if (result !is TagWriter.Outcome.Written) {
            freshStep = FreshStep.WriteRefused(writeRefusalToken(result))
            return
        }
        freshStep = FreshStep.Reporting
        lifecycleScope.launch {
            val locations = try {
                reportFreshTag(freshTagId)
                // A building list that will not load is not a reason to strand a written card:
                // the picker shows its empty text and the zone can still be created unbound.
                runCatching { freshLocations(freshTagId) }.getOrDefault(emptyList())
            } catch (e: ApiFailure) {
                freshStep = FreshStep.Failed(e.code)
                return@launch
            } catch (_: Exception) {
                freshStep = FreshStep.Failed("unknown")
                return@launch
            }
            freshStep = FreshStep.Naming(locations)
        }
    }

    /**
     * POST /operator/tags/:id/resolve-zone — the write flow's own last step, called here.
     *
     * The report is REPEATED before it, so a retry after a failed report needs no second card:
     * `POST /operator/tags` is idempotent and answering `already_resolved` is the server's job.
     */
    private fun submitFreshZone() {
        val name = freshName.trim()
        if (name.isEmpty()) return
        val building = freshBuilding
        val tagId = freshTagId
        freshStep = FreshStep.Submitting
        lifecycleScope.launch {
            val zone = try {
                reportFreshTag(tagId)
                if (isSimulatedTag(tagId)) {
                    runFreshZoneSimulation(tagId, name, building)
                } else {
                    val resolved = app.operatorApi.resolveZone(tagId, name, building?.id)
                    // The route answers OP_ZONE_COLS with no location_name, and the operator just
                    // tapped the building's name — substituted rather than re-fetched, exactly as
                    // finishReassign does.
                    WireOperatorZone(
                        id = resolved.id,
                        locationId = resolved.locationId,
                        locationName = if (resolved.locationId == null) null else building?.name,
                        name = resolved.name,
                        tagSerial = null,
                        tagDeployedAt = null,
                        verifiedAt = null,
                    )
                }
            } catch (e: ApiFailure) {
                freshStep = FreshStep.Failed(e.code)
                return@launch
            } catch (_: Exception) {
                freshStep = FreshStep.Failed("unknown")
                return@launch
            }
            // The id is on a card and now names a zone: the NEXT card must not reuse it.
            freshTagId = UUID.randomUUID().toString()
            zones = zones + zone
            selectZone(zone)
            freshStep = FreshStep.Idle
            freshName = ""
            freshBuilding = null
        }
    }

    /**
     * The unchanged report route — skipped only for a card the DEBUG simulator "wrote".
     * [isSimulatedTag] is constantly false in a release build (nfc/VerifySimulation.kt), so a
     * shipped build always reports.
     */
    private suspend fun reportFreshTag(tagId: String) {
        if (isSimulatedTag(tagId)) return
        app.operatorApi.reportTag(tagId)
    }

    private suspend fun freshLocations(tagId: String): List<WireOperatorLocation> =
        if (isSimulatedTag(tagId)) simulatedBindLocations() else app.operatorApi.operatorLocations()

    /**
     * REASSIGN THIS DOOR TO A DIFFERENT BUILDING (decision-55 §3). Drawn only under a BOUND
     * zone — its only caller sits in the bound branch — and it is a button until it is used,
     * because an always-open building picker under every zone page is a picker somebody will
     * eventually tap on the wrong screen.
     */
    @Composable
    private fun ReassignSection(zone: WireOperatorZone) {
        when (val step = reassignStep) {
            ReassignStep.Idle -> {
                OutlinedButton(
                    onClick = ::loadReassignLocations,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_reassign_action)) }
                return
            }

            ReassignStep.Loading -> Text(stringResource(R.string.verify_reassign_loading))
            ReassignStep.Submitting -> Text(stringResource(R.string.verify_reassign_submitting))

            is ReassignStep.Done -> {
                Text(
                    getString(R.string.verify_reassign_done, step.zoneName, step.building),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                return
            }

            is ReassignStep.LoadFailed -> {
                Text(
                    getString(R.string.verify_reassign_load_failed, step.code),
                    color = MaterialTheme.colorScheme.error,
                )
                OutlinedButton(
                    onClick = ::loadReassignLocations,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_bind_retry)) }
            }

            is ReassignStep.Picking -> {
                Text(
                    stringResource(R.string.verify_reassign_hint),
                    style = MaterialTheme.typography.titleMedium,
                )
                BuildingPicker(
                    locations = step.locations,
                    selectedId = reassignBuilding?.id,
                    emptyText = stringResource(R.string.verify_bind_locations_empty),
                    onPick = { reassignBuilding = it },
                )
                // The zone's CURRENT building is not a move (TASK-286, matching
                // VerifyZoneScreen.swift:434). Disabled rather than hidden: an operator
                // scanning the list for the building they meant needs to see the one they
                // are leaving. The guard sits BEFORE AwaitingCard on purpose — past it a
                // card is physically written and reported, and the server's own 409
                // duplicate_zone_name then arrives about the zone already on screen.
                val picked = reassignBuilding
                Button(
                    onClick = {
                        picked?.let {
                            reassignStep = ReassignStep.AwaitingCard(it)
                            startReaderMode()
                        }
                    },
                    enabled = picked != null && picked.id != zone.locationId,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_reassign_submit)) }

                // DEBUG BUILDS ONLY: reassignPickSimulations() is empty in src/release/
                // (nfc/VerifySimulation.kt). Picks a building INTO the real picker state —
                // it does not fake an outcome, so the button's own enabled-ness is what is
                // being shown.
                for (simulation in reassignPickSimulations(zone, step.locations)) {
                    OutlinedButton(
                        onClick = { reassignBuilding = simulation.location },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    ) { Text("\u25b6 ${simulation.label}") }
                }
            }

            is ReassignStep.AwaitingCard -> Text(
                getString(R.string.verify_reassign_awaiting, step.building.name),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )

            is ReassignStep.WriteRefused -> Text(
                getString(R.string.verify_reassign_write_failed, step.reason),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )

            is ReassignStep.Failed -> {
                Text(reassignFailureText(step.code), color = MaterialTheme.colorScheme.error)
                // The CARD IS ALREADY CORRECT here, so the retry repeats the two server calls
                // and never asks for another card: the report is idempotent and the
                // reassignment is one all-or-nothing statement.
                OutlinedButton(
                    onClick = { finishReassign(zone, step.building) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.verify_reassign_retry)) }
            }
        }

        // DEBUG BUILDS ONLY, and the same fixtures the write screen uses: a written card is
        // the one thing an emulator cannot produce, and writeSimulations() is empty in
        // src/release/ so this loop has nothing to draw there (nfc/WriteSimulation.kt).
        val awaiting = reassignStep as? ReassignStep.AwaitingCard
            ?: (reassignStep as? ReassignStep.WriteRefused)?.let { ReassignStep.AwaitingCard(it.building) }
        if (awaiting != null) {
            for (simulation in writeSimulations()) {
                OutlinedButton(
                    onClick = {
                        applyReassignWrite(
                            zone,
                            awaiting.building,
                            runSimulation(simulation, app.tagLink, reassignTagId),
                        )
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("\u25b6 ${simulation.label}") }
            }
        }

        OutlinedButton(
            onClick = ::cancelReassign,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_reassign_cancel)) }
    }

    /**
     * The unbind outcome, one sentence, above whichever body the zone now renders — a
     * successful unbind flips the zone to UNBOUND and therefore to the bind form, so this has
     * to sit ABOVE that fork rather than inside the bound branch that produced it.
     */
    @Composable
    private fun UnbindStatus() {
        val text = when (val step = unbindStep) {
            UnbindStep.Idle -> return
            UnbindStep.Submitting -> stringResource(R.string.verify_unbind_submitting)
            is UnbindStep.Unbound -> getString(R.string.verify_unbind_done, step.building)
            UnbindStep.HasShifts -> stringResource(R.string.verify_unbind_has_shifts)
            is UnbindStep.Failed -> getString(R.string.verify_unbind_failed, step.code)
        }
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = if (unbindStep is UnbindStep.Unbound || unbindStep is UnbindStep.Submitting) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.error
            },
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }

    /**
     * The unbind button and its confirmation. The dialog NAMES THE BUILDING being removed —
     * an operator with a worklist of near-identical stairwells is exactly who this is for, and
     * "are you sure?" over an unnamed building is a question nobody can answer.
     */
    @Composable
    private fun UnbindAction(zone: WireOperatorZone) {
        val building = zone.locationName ?: getString(R.string.verify_zone_no_building)
        OutlinedButton(
            onClick = { unbindConfirming = true },
            enabled = unbindStep != UnbindStep.Submitting,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_unbind_action)) }

        if (!unbindConfirming) return
        AlertDialog(
            onDismissRequest = { unbindConfirming = false },
            title = { Text(stringResource(R.string.verify_unbind_confirm_title)) },
            text = { Text(getString(R.string.verify_unbind_confirm_body, building)) },
            confirmButton = {
                TextButton(onClick = { submitUnbind(zone) }) {
                    Text(stringResource(R.string.verify_unbind_confirm_yes))
                }
            },
            dismissButton = {
                TextButton(onClick = { unbindConfirming = false }) {
                    Text(stringResource(R.string.verify_unbind_confirm_cancel))
                }
            },
        )
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
        if (!operatorReady || !readerWanted()) return
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
     * WHEN A CARD MAY BE READ AT ALL, in one place, because there are now three answers and a
     * scattered set of `if`s is how the fourth one ends up wrong.
     *
     *   no zone picked   YES — scan-first classification (decision-55 §2), read-only.
     *   reassigning      YES — and ONLY while a fresh card is expected: this is the one state
     *                    in this screen where a tap WRITES. Mid-reassignment (picking a
     *                    building, submitting) NO: a card presented then has nowhere to go.
     *                    A FINISHED one is not "reassigning" at all — the screen is already on
     *                    the NEW zone, whose very next step is a test scan.
     *   a bound zone     YES — the test scan, unchanged.
     *   an unbound zone  NO (decision-54 §3): no card can resolve to a zone with no building,
     *                    so a scan could only ever end in a 422. The gate is the absence of the
     *                    callback, not a message after the fact.
     */
    private fun readerWanted(): Boolean = when {
        // The write-fresh recovery (decision-58 §3) is the SECOND tap in this screen that
        // writes, and like the first it is armed only while a card is actually expected.
        freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused -> true
        // ...and DISARMED for every other mid-recovery state (TASK-301). Reporting/Naming/
        // Submitting/Failed mean the card is already written and reported; a stray tap there
        // would fall through to the ordinary read, re-classify away from Unreadable and take
        // FreshCardSection out of the composition with no way back. Must stay BELOW the arming
        // arm above. Mirrors the reassign pair two lines down.
        freshStep !is FreshStep.Idle -> false
        reassignStep is ReassignStep.AwaitingCard || reassignStep is ReassignStep.WriteRefused -> true
        reassignStep !is ReassignStep.Idle && reassignStep !is ReassignStep.Done -> false
        selectedZone == null -> true
        else -> selectedZone?.isBound == true
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
        scanStep = ScanStep.Idle
        reassignStep = ReassignStep.Idle
        reassignBuilding = null
        freshStep = FreshStep.Idle
        freshBuilding = null
        bindBuilding = null
        shifts = null
        shiftsError = false
        unbindStep = UnbindStep.Idle
        unbindConfirming = false
        if (zone.isBound) {
            bindStep = BindStep.Idle
            startReaderMode()
        } else {
            loadBindLocations()
        }
    }

    private fun changeZone() {
        selectedZone = null
        outcome = null
        checking = false
        bindStep = BindStep.Idle
        bindBuilding = null
        shifts = null
        shiftsError = false
        unbindStep = UnbindStep.Idle
        unbindConfirming = false
        scanStep = ScanStep.Idle
        reassignStep = ReassignStep.Idle
        reassignBuilding = null
        freshStep = FreshStep.Idle
        freshBuilding = null
        // NOT disableReaderMode: with no zone picked this screen is the scan-first one
        // (decision-55 §2), which reads cards precisely in that state. Restarting is a no-op
        // when reader mode is already on and the honest thing when it was off.
        startReaderMode()
    }

    /**
     * SCAN FIRST: what IS this card (decision-55 §1)? The id is resolved exactly as the test
     * scan resolves it — a real URI first, then this worklist's own serials — and then handed
     * to `GET /operator/tags/:id`, which stamps nothing.
     *
     * A BOUND ZONE IS THEN VERIFIED, by the SAME [handleRead] the worklist-first path runs, with
     * the same card reading. That is the reuse decision-55 §2 asks for: no second verify call
     * site, no second zone page, and `zone_mismatch` structurally impossible because the zone
     * being verified IS the one the card just named.
     *
     * AN UNBOUND ZONE STOPS AT [selectZone], which forks into the building picker that already
     * exists — there is nothing to verify until it has a building.
     */
    private fun handleScanFirst(techs: List<String>, uid: String, uriString: String?) {
        val placeUuid = app.tagLink.locationId(uriString) ?: matchSerial(uid)
        if (placeUuid == null) {
            scanStep = ScanStep.Unreadable(techs, uid, app.tagLink.diagnose(uriString))
            return
        }
        scanStep = ScanStep.Checking
        lifecycleScope.launch {
            val classification = try {
                // DEBUG BUILDS ONLY: simulatedClassification() is constantly null in src/release/,
                // so a release build always asks the server (nfc/VerifySimulation.kt).
                simulatedClassification(placeUuid) ?: app.operatorApi.classifyTag(placeUuid)
            } catch (e: ApiFailure) {
                scanStep = ScanStep.Failed(e.code)
                return@launch
            } catch (_: Exception) {
                scanStep = ScanStep.Failed("unknown")
                return@launch
            }
            when (classification) {
                is WireTagClassification.Zone -> {
                    selectZone(classification.zone)
                    if (classification.zone.isBound) handleRead(techs, uid, uriString)
                }
                WireTagClassification.Building -> scanStep = ScanStep.Building
                WireTagClassification.Retired -> scanStep = ScanStep.Retired
                WireTagClassification.TagReported -> scanStep = ScanStep.TagReported
                WireTagClassification.Unknown -> scanStep = ScanStep.Unknown
            }
        }
    }

    /** GET /operator/locations — the same list the bind form and the write flow already load. */
    private fun loadReassignLocations() {
        reassignStep = ReassignStep.Loading
        reassignBuilding = null
        val zone = selectedZone
        if (zone != null && isSimulatedZone(zone)) {
            reassignStep = ReassignStep.Picking(simulatedBindLocations())
            return
        }
        lifecycleScope.launch {
            reassignStep = try {
                ReassignStep.Picking(app.operatorApi.operatorLocations())
            } catch (e: ApiFailure) {
                ReassignStep.LoadFailed(e.code)
            } catch (_: Exception) {
                ReassignStep.LoadFailed("unknown")
            }
        }
    }

    private fun cancelReassign() {
        reassignStep = ReassignStep.Idle
        reassignBuilding = null
        startReaderMode()
    }

    /**
     * The write half of a reassignment, one step after [TagWriter] has spoken.
     *
     * NO OVERWRITE OVERRIDE HERE, unlike [WriteTagActivity]. A reassignment needs a card the
     * operator is mounting on a door that is about to change buildings; a card that already
     * carries one of our ids is a card on some other wall, and `WriteGuard` refusing it is the
     * right answer with no way to argue. The operator picks up a blank one.
     */
    private fun applyReassignWrite(
        zone: WireOperatorZone,
        building: WireOperatorLocation,
        result: TagWriter.Outcome,
    ) {
        if (result !is TagWriter.Outcome.Written) {
            reassignStep = ReassignStep.WriteRefused(building, writeRefusalToken(result))
            return
        }
        finishReassign(zone, building)
    }

    /**
     * The two server calls, in the only order that can be safe: REPORT the card first (that is
     * what makes the minted id exist server-side), then reassign, which CLAIMS that report.
     *
     * BOTH ARE RETRYABLE TOGETHER and this is the retry: `POST /operator/tags` is idempotent and
     * the reassignment is one all-or-nothing statement, so repeating the pair after a failure
     * cannot half-apply anything. The card is already correct before either call runs, so a
     * failure here is never a failed write — the same rule the write screen states at length.
     */
    private fun finishReassign(zone: WireOperatorZone, building: WireOperatorLocation) {
        val newTagId = reassignTagId
        reassignStep = ReassignStep.Submitting
        lifecycleScope.launch {
            val reassigned = try {
                if (isSimulatedZone(zone)) {
                    runReassignSimulation(zone, newTagId, building)
                } else {
                    app.operatorApi.reportTag(newTagId)
                    app.operatorApi.reassignZoneBuilding(zone.id, newTagId, building.id)
                }
            } catch (e: ApiFailure) {
                reassignStep = ReassignStep.Failed(building, e.code)
                return@launch
            } catch (_: Exception) {
                reassignStep = ReassignStep.Failed(building, "unknown")
                return@launch
            }
            // The id is spent: it is on a card and it now names a zone, so the NEXT card this
            // screen writes must not reuse it.
            reassignTagId = UUID.randomUUID().toString()
            // The route returns OP_ZONE_COLS, which carry no location_name — and the operator
            // just tapped the building's name, so it is substituted rather than re-fetched.
            val fresh = reassigned.zone.copy(locationName = building.name)
            // THE OLD ZONE IS GONE FROM THE WORKLIST, not merely unselected: the server has
            // deactivated it, and a row this phone keeps offering as a scan target is a row an
            // operator will scan.
            zones = zones.filterNot { it.id == (reassigned.retiredZoneId ?: zone.id) } + fresh
            selectZone(fresh)
            reassignStep = ReassignStep.Done(fresh.name, building.name)
        }
    }

    /**
     * WHY THE CARD WAS NOT WRITTEN, as one short token inside a translated sentence.
     *
     * ponytail: deliberately coarser than [WriteTagActivity]'s per-outcome sentences, which name
     * capacities, ids and confirmation tokens because that screen's WHOLE job is writing cards.
     * Here the only useful next move is the same for every refusal — use a different card — so
     * one sentence carries it. If field use shows an operator needs the detail, the upgrade path
     * is to lift WriteTagActivity.outcomeText() into a shared function and call it from both,
     * not to grow a second copy of it here.
     *
     * THE TOKEN IS NOT TRANSLATED AND MUST NOT BE: it is a diagnostic riding inside a translated
     * sentence, exactly as this screen already renders raw server codes (verify_bind_failed and
     * friends). A German literal here would be a user-visible string living in Kotlin, which the
     * project's i18n rule forbids outright.
     */
    private fun writeRefusalToken(result: TagWriter.Outcome): String = when (result) {
        is TagWriter.Outcome.Written -> ""
        is TagWriter.Outcome.Refused.Occupied -> "occupied"
        is TagWriter.Outcome.Refused.TooSmall -> "too_small"
        is TagWriter.Outcome.Refused.ReadOnly -> "read_only"
        is TagWriter.Outcome.Refused.NoCapacity -> "no_capacity"
        is TagWriter.Outcome.Refused.NotFormatted -> "not_formatted"
        is TagWriter.Outcome.Refused.BadId -> "bad_id"
        is TagWriter.Outcome.Unverified -> result.reason
        is TagWriter.Outcome.Lost -> "lost"
    }

    /**
     * Every refusal `POST /operator/zones/:id/reassign-building` can produce, as its own
     * sentence — never a bare code. Each one has a DIFFERENT next move for the operator, which
     * is the whole reason the route bothers to tell them apart.
     */
    private fun reassignFailureText(code: String): String = when (code) {
        "unknown_zone" -> getString(R.string.verify_reassign_unknown_zone)
        "zone_unbound" -> getString(R.string.verify_reassign_zone_unbound)
        "unknown_reported_tag" -> getString(R.string.verify_reassign_tag_unreported)
        "already_resolved" -> getString(R.string.verify_reassign_already_resolved)
        "duplicate_zone_name" -> getString(R.string.verify_reassign_duplicate_name)
        "id_in_use" -> getString(R.string.verify_reassign_id_in_use)
        "unknown_location" -> getString(R.string.verify_reassign_unknown_location)
        else -> getString(R.string.verify_reassign_failed, code)
    }

    /**
     * POST /operator/zones/:id/unbind. The zone the server hands back replaces the worklist row
     * exactly as [submitBind] does, and it comes back UNBOUND — so the screen falls through to
     * the bind form on the next composition, which is the honest next question. Reader mode is
     * stopped first: no card can resolve to a zone with no building, so a scan from here could
     * only ever answer 422.
     *
     * `verified_at` IS NOT TOUCHED, here or on the server. What was proved stays proved.
     */
    private fun submitUnbind(zone: WireOperatorZone) {
        unbindConfirming = false
        val building = zone.locationName ?: getString(R.string.verify_zone_no_building)
        unbindStep = UnbindStep.Submitting
        lifecycleScope.launch {
            try {
                val unbound = if (isSimulatedZone(zone)) {
                    runUnbindSimulation(zone)
                } else {
                    app.operatorApi.unbindZone(zone.id)
                }
                adapter?.disableReaderMode(this@VerifyZoneActivity)
                zones = zones.map { if (it.id == unbound.id) unbound else it }
                selectedZone = unbound
                outcome = null
                shifts = null
                shiftsError = false
                bindBuilding = null
                unbindStep = UnbindStep.Unbound(building)
                loadBindLocations()
            } catch (e: ApiFailure) {
                // The refusal an operator can act on gets a sentence; everything else a code.
                unbindStep =
                    if (e.code == "zone_has_shifts") UnbindStep.HasShifts else UnbindStep.Failed(e.code)
            } catch (_: Exception) {
                unbindStep = UnbindStep.Failed("unknown")
            }
        }
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
        // so a tag dispatched microseconds after the state changed could still land here.
        if (!operatorReady) return

        // THE ONE TAP IN THIS SCREEN THAT WRITES (decision-55 §3), and it is reachable only
        // while a reassignment is waiting for a fresh card. The write runs HERE, on the NFC
        // thread, exactly as WriteTagActivity.onTag does — app.tagWriter is that screen's
        // writer, called, not copied.
        // THE WRITE-FRESH RECOVERY (decision-58 §3), same writer, same thread, same rule: only
        // while a card is expected. Checked FIRST because it is reachable with no zone selected,
        // which the reassign branch below is not.
        if (freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused) {
            val result = app.tagWriter.write(tag, freshTagId, confirmedOverwriteOf = null)
            runOnUiThread { applyFreshWrite(result) }
            return
        }

        val awaiting = reassignStep as? ReassignStep.AwaitingCard
            ?: (reassignStep as? ReassignStep.WriteRefused)?.let { ReassignStep.AwaitingCard(it.building) }
        val zone = selectedZone
        if (awaiting != null && zone != null) {
            val result = app.tagWriter.write(tag, reassignTagId, confirmedOverwriteOf = null)
            runOnUiThread { applyReassignWrite(zone, awaiting.building, result) }
            return
        }

        val techs = tag.techList.map { it.substringAfterLast('.') }
        val uid = tag.id.joinToString(":") { "%02X".format(it) }
        // THE STOCK ROUTE FIRST, THE RAW PAGES ONLY IF IT ANSWERED NOTHING (decision-58 §2).
        val uri = readUri(tag)?.toString() ?: RawTagIo.uri(tag)
        // NO ZONE PICKED = the scan-first classification (decision-55 §2); a picked zone is the
        // test scan it always was.
        runOnUiThread { if (zone == null) handleScanFirst(techs, uid, uri) else handleRead(techs, uid, uri) }
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
            outcome = VerifyOutcome.Unreadable(techs, uid, app.tagLink.diagnose(uriString))
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
        is VerifyOutcome.Unreadable -> unreadableText(o.techs, o.uid, o.diagnosis)
        is VerifyOutcome.Failure ->
            getString(if (o.serverSide) R.string.verify_server_error else R.string.verify_network_error)
    }

    /**
     * WHY THIS CARD DID NOT RESOLVE, named (decision-58 §1) — one sentence per cause, because
     * the operator's next move differs: a card carrying a DIFFERENT HOST was written by a phone
     * on an old build (TASK-188), and the fix there is updating that phone, not this card.
     *
     * The found host rides untranslated inside a translated sentence, exactly as this screen
     * already renders raw server codes.
     */
    private fun unreadableText(techs: List<String>, uid: String, diagnosis: TagLink.Diagnosis): String =
        when (diagnosis) {
            is TagLink.Diagnosis.HostMismatch ->
                getString(R.string.verify_no_uri_host, diagnosis.found, techs.joinToString(", "), uid)
            // Found() cannot reach here — an id that parsed is an id this screen used — and is
            // rendered as the generic case rather than given a branch that cannot be seen.
            else -> getString(R.string.verify_no_uri, techs.joinToString(", "), uid)
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
