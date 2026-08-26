package io.github.qwadratic.nfctimesheets.nfc

import android.content.Context
import android.nfc.NfcAdapter
import android.nfc.Tag
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
import androidx.compose.material3.OutlinedTextField
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
import io.github.qwadratic.nfctimesheets.core.EnrolmentCode
import io.github.qwadratic.nfctimesheets.core.WriteGuard
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * WRITE A TAG. The operator's screen, and the only screen in this app that changes a
 * physical object.
 *
 * THE ID IS MINTED HERE, ON THIS PHONE, BEFORE THE SERVER HAS EVER HEARD OF IT. That looks
 * backwards and is deliberate (server/db/migrations/008_reported_tags.sql): the operator is
 * in a stairwell with no signal, and a flow that needs a round trip before it can write a
 * card is a flow that fails at the one moment it is used. A uuid is not a credential — it
 * resolves to nothing at all until an admin claims it in the panel — so minting one costs
 * nothing and can never grant anything.
 *
 * ORDER, AND WHY THE REPORT IS LAST AND SOFT:
 *
 *   mint uuid -> READ tag facts -> DECIDE -> write -> READ BACK AND COMPARE -> report
 *
 * The card is already correct by the time the report is attempted. A failed report is
 * therefore an inconvenience (the office does not know yet, tap RETRY, or write it down)
 * and never a failed write — telling the operator to redo a card that is physically fine
 * would waste the card and the visit. The two states are separate on screen for that
 * reason, and the write result is never downgraded by a network error.
 *
 * NOTHING HERE OPENS OR CLOSES A SHIFT, and it cannot: it talks through
 * TimeSheetsApplication.operatorApi, which carries the `ts_operator` cookie, and no route
 * that touches a shift accepts one (decision-45).
 *
 * TWO GUARDS LIVE HERE AND NOWHERE ELSE (TASK-220). Both are about the same accident: this
 * screen used to write whatever card it saw, including a working one on a wall, and say
 * "Geschrieben und geprueft."
 *
 *   1. THE ROLE GATES THE WRITE, not just the report. Reader mode is not enabled at all
 *      without an operator session on this phone, so a phone that is not an operator's is
 *      never even handed a tag by the NFC service — the write is unreachable rather than
 *      refused. It used to be the other way round: anybody could open this screen from
 *      Erfassen and write a card, and the `ts_operator` cookie only decided whether the
 *      OFFICE was told about it afterwards.
 *   2. A CARD THAT ALREADY HOLDS ONE OF OUR IDS IS REFUSED (core/WriteGuard), and the
 *      override is not a shrug: the operator types back the last six characters of the id
 *      they are about to destroy, and that authorises that ONE card.
 *
 * NEITHER GUARD IS ON THE CLOCK-IN PATH. A cleaner's tap goes to NfcTapActivity and never
 * constructs this class, this activity's reader mode is foreground-only, and the operator
 * session is read from disk — no network call, nothing to be slow, nothing to fail.
 */
class WriteTagActivity : ComponentActivity() {

    private val app: TimeSheetsApplication get() = application as TimeSheetsApplication
    private var adapter: NfcAdapter? = null

    /**
     * The id this screen is currently offering to write. Minted once per successful write,
     * NOT per tap: a tag re-presented after a failed verify must get the SAME id, or the
     * operator ends up with two ids for one card and a reported tag that is not on any wall.
     */
    private var pendingId by mutableStateOf(UUID.randomUUID().toString())

    private var nfcState by mutableStateOf(NfcState.READY)

    private var outcome by mutableStateOf<TagWriter.Outcome?>(null)
    private var report by mutableStateOf<ReportState>(ReportState.Idle)
    private var operatorCode by mutableStateOf("")
    private var busy by mutableStateOf(false)

    /**
     * Is this phone an operator's? Read off the stored `ts_operator` cookie — from DISK,
     * never from a request: the operator is in a stairwell with no signal, and a gate that
     * needs the network is a gate that fails shut at the one moment it is used. Enrolment
     * (which does need the network) happened once, at a desk.
     */
    private var operatorReady by mutableStateOf(false)

    /**
     * The location id currently on a card that the operator has EXPLICITLY confirmed
     * destroying. Null on every ordinary write. Handed to TagWriter, which compares it
     * against the id read off the card in the field, so it cannot drift onto the next card.
     * Cleared the moment a write succeeds.
     */
    private var confirmedFor by mutableStateOf<String?>(null)

    /** What the operator has typed into the confirmation box. */
    private var confirmText by mutableStateOf("")

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    private sealed interface ReportState {
        data object Idle : ReportState
        data object Sending : ReportState
        data object Sent : ReportState

        /** The card is fine; the office does not know yet. Retryable, and never fatal. */
        data class Failed(val code: String) : ReportState

        /** No operator session on this phone. The card is still fine. */
        data object NeedsOperator : ReportState
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        adapter = NfcAdapter.getDefaultAdapter(this)

        // RESTORE ACROSS A KILLED PROCESS. The card was already written and verified
        // before this process existed — nfc/PendingTagReport.kt is the only thing that
        // remembers that fact once the OS (or the operator) kills the app. Without this,
        // `outcome` and `report` reset to nothing on every fresh process and the retry
        // button this screen depends on never appears, even though the card is fine and
        // the server still does not know about it.
        app.pendingTagReport.pending()?.let { written ->
            pendingId = written.locationId
            outcome = written
        }

        setContent {
            io.github.qwadratic.nfctimesheets.ui.TimeSheetsTheme {
                Scaffold { padding ->
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(padding)
                            .padding(24.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            stringResource(R.string.write_title),
                            style = MaterialTheme.typography.headlineSmall,
                        )

                        when (nfcState) {
                            NfcState.UNSUPPORTED -> Text(stringResource(R.string.scan_unsupported))
                            NfcState.DISABLED -> Text(stringResource(R.string.scan_disabled))
                            NfcState.READY -> WriteBody()
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
    private fun WriteBody() {
        Text(stringResource(R.string.write_hint), style = MaterialTheme.typography.bodyMedium)
        Text(
            stringResource(R.string.write_pending_id, pendingId),
            style = MaterialTheme.typography.bodySmall,
        )

        // THE ROLE GATE, said out loud. The reader mode behind it is simply
        // never started, so this is an explanation and not a warning about
        // something that might still happen.
        if (!operatorReady) {
            Text(
                stringResource(R.string.write_needs_operator_to_write),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }

        // liveRegion: the operator is holding a phone against a wall and
        // cannot hunt the screen for what changed.
        Text(
            text = outcomeText(),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Text(text = reportText(), style = MaterialTheme.typography.bodySmall)

        // THE OVERRIDE FOR A MOUNTED CARD. Shown only when a card carrying
        // one of our ids has actually been presented, and it names that id:
        // an always-visible "overwrite anyway" switch is a switch that ends
        // up left on.
        val occupied = outcome as? TagWriter.Outcome.Refused.Occupied
        if (occupied != null && confirmedFor != occupied.onTag) {
            OutlinedTextField(
                value = confirmText,
                onValueChange = { confirmText = it },
                label = { Text(stringResource(R.string.write_confirm_label, occupied.token)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    confirmedFor = occupied.onTag
                    confirmText = ""
                },
                enabled = WriteGuard.confirms(occupied.onTag, confirmText),
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.write_confirm_button)) }
        }

        if (!operatorReady || report is ReportState.NeedsOperator) {
            OutlinedTextField(
                value = operatorCode,
                onValueChange = { operatorCode = it },
                label = { Text(stringResource(R.string.write_operator_code)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = ::enrolOperator,
                enabled = !busy && EnrolmentCode.normalise(operatorCode) != null,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.write_operator_enrol)) }
        }

        val written = outcome as? TagWriter.Outcome.Written
        if (written != null && report !is ReportState.Sent) {
            OutlinedButton(
                onClick = { sendReport(written.locationId) },
                enabled = !busy,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.write_report_retry)) }
        }

        // DEBUG BUILDS ONLY. writeSimulations() is defined twice — once in
        // src/debug/ with these scenarios, once in src/release/ returning an
        // empty list and containing none of the code. On a release build this
        // loop has nothing to iterate and the buttons do not exist.
        for (simulation in writeSimulations()) {
            OutlinedButton(
                onClick = {
                    apply(runSimulation(simulation, app.tagLink, pendingId, confirmedFor))
                },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("▶ ${simulation.label}") }
        }
    }

    /**
     * Reader mode, foreground only, torn down in onPause. FLAG_READER_SKIP_NDEF_CHECK is
     * NOT set: the platform's own NDEF read on discovery is what populates the capacity and
     * writability this screen refuses on, and skipping it to save a few milliseconds would
     * remove the gate.
     *
     * EXTRA_READER_PRESENCE_CHECK_DELAY is raised well above the ~125 ms default. The
     * default exists for reads, which are over in a moment; a write plus a verifying read
     * takes longer, and a presence check that fires mid-write is exactly how a card ends up
     * holding half a message.
     */
    override fun onResume() {
        super.onResume()
        val nfc = adapter
        nfcState = when {
            nfc == null -> NfcState.UNSUPPORTED
            !nfc.isEnabled -> NfcState.DISABLED
            else -> NfcState.READY
        }
        // Re-read on every resume, not once in onCreate: enrolment can have happened in
        // another screen, and a session can have been cleared while this one was in the
        // background.
        operatorReady = app.operatorCookies.header() != null
        startReaderMode()
    }

    /**
     * NO OPERATOR SESSION, NO READER MODE. The gate is the absence of the callback, not a
     * refusal inside it: with reader mode never enabled the NFC service does not deliver a
     * tag to this screen at all, so there is no code path on a non-operator phone on which
     * a card is touched.
     */
    private fun startReaderMode() {
        if (!operatorReady) return
        val nfc = adapter ?: return
        if (!nfc.isEnabled) return
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        val extras = Bundle().apply {
            putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, PRESENCE_CHECK_MS)
        }
        nfc.enableReaderMode(this, ::onTag, flags, extras)
    }

    override fun onPause() {
        super.onPause()
        adapter?.disableReaderMode(this)
    }

    /** Called off the main thread by the NFC service. The write happens right here. */
    private fun onTag(tag: Tag) {
        // Belt and braces behind the reader-mode gate: disableReaderMode is asynchronous,
        // so a tag dispatched microseconds after a session was cleared could still land
        // here. Nothing is written and nothing is said — the screen already says why.
        if (!operatorReady) return
        val result = app.tagWriter.write(tag, pendingId, confirmedOverwriteOf = confirmedFor)
        runOnUiThread { apply(result) }
    }

    private fun apply(result: TagWriter.Outcome) {
        outcome = result
        if (result is TagWriter.Outcome.Written) {
            // The confirmation is SPENT. It authorised one card; the next card presented
            // starts from refused again, which is the difference between a confirmation and
            // a mode the operator forgot they were in.
            confirmedFor = null
            confirmText = ""
            // Persisted BEFORE the report is even attempted — see nfc/PendingTagReport.kt.
            // A process death between this line and a successful report must still leave
            // the operator able to retry, not a screen that has forgotten the card exists.
            app.pendingTagReport.save(result)
            sendReport(result.locationId)
        }
    }

    /**
     * Tell the server the tag exists. NEVER blocks or downgrades the write result: by the
     * time this runs the card is written and verified, and the worst case here is that the
     * office finds out later.
     */
    private fun sendReport(locationId: String) {
        if (busy) return
        busy = true
        report = ReportState.Sending
        lifecycleScope.launch {
            report = try {
                app.operatorApi.reportTag(locationId)
                // The server now knows. Clear the persisted record FIRST: if the process
                // died between these two lines, the worst case is a harmless duplicate
                // report (POST /operator/tags is idempotent) — never a card the operator
                // was never asked to retry.
                app.pendingTagReport.clear()
                // The id has now left this phone, so the NEXT card must not reuse it.
                pendingId = UUID.randomUUID().toString()
                ReportState.Sent
            } catch (e: ApiFailure) {
                if (e.status == 401) ReportState.NeedsOperator else ReportState.Failed(e.code)
            } catch (_: Exception) {
                ReportState.Failed("unknown")
            }
            busy = false
        }
    }

    private fun enrolOperator() {
        val code = EnrolmentCode.normalise(operatorCode) ?: return
        busy = true
        lifecycleScope.launch {
            try {
                app.operatorApi.operatorEnrol(code)
                operatorCode = ""
                busy = false
                // The gate opens here, and reader mode has to be started by hand: onResume
                // already ran, and without this the operator enrols, sees nothing change,
                // and presents a card to a screen that is not listening.
                operatorReady = app.operatorCookies.header() != null
                startReaderMode()
                // Straight back to the thing the operator was trying to do.
                (outcome as? TagWriter.Outcome.Written)?.let { sendReport(it.locationId) }
                    ?: run { report = ReportState.Idle }
            } catch (e: ApiFailure) {
                report = ReportState.Failed(e.code)
                busy = false
            } catch (_: Exception) {
                report = ReportState.Failed("unknown")
                busy = false
            }
        }
    }

    private fun outcomeText(): String = when (val o = outcome) {
        null -> if (operatorReady) getString(R.string.write_waiting) else ""
        is TagWriter.Outcome.Written ->
            getString(R.string.write_ok, o.locationId, o.bytes, o.capacity, o.serial) + replacedNote(o.replaced)
        is TagWriter.Outcome.Refused.Occupied ->
            if (confirmedFor == o.onTag) {
                getString(R.string.write_confirm_armed, o.onTag)
            } else {
                getString(R.string.write_occupied, o.onTag, o.token)
            }
        is TagWriter.Outcome.Refused.TooSmall -> getString(R.string.write_too_small, o.capacity, o.needed)
        is TagWriter.Outcome.Refused.ReadOnly -> getString(R.string.write_read_only)
        is TagWriter.Outcome.Refused.NoCapacity -> getString(R.string.write_no_capacity)
        is TagWriter.Outcome.Refused.NotFormatted ->
            getString(R.string.write_not_formatted, o.techs.joinToString(", "))
        is TagWriter.Outcome.Refused.BadId -> getString(R.string.write_bad_id)
        is TagWriter.Outcome.Unverified -> getString(R.string.write_unverified, o.reason)
        is TagWriter.Outcome.Lost -> getString(R.string.write_lost)
    }

    /**
     * WHAT THIS CARD REPLACED. Blank is the ordinary case and says nothing; the other two
     * are worth a line each, and they are DIFFERENT lines — a foreign card is somebody
     * else's rubbish and costs nothing, while one of our own ids being gone may mean a door
     * somewhere has to be re-labelled.
     */
    private fun replacedNote(replaced: WriteGuard.Existing): String = when (replaced) {
        WriteGuard.Existing.Blank -> ""
        is WriteGuard.Existing.Foreign -> "\n\n" + getString(R.string.write_replaced_foreign, replaced.summary)
        is WriteGuard.Existing.Ours -> "\n\n" + getString(R.string.write_replaced_ours, replaced.locationId)
    }

    private fun reportText(): String = when (val r = report) {
        ReportState.Idle -> ""
        ReportState.Sending -> getString(R.string.write_report_sending)
        ReportState.Sent -> getString(R.string.write_report_sent)
        ReportState.NeedsOperator -> getString(R.string.write_report_needs_operator)
        is ReportState.Failed -> getString(R.string.write_report_failed, r.code)
    }

    private companion object {
        /** Milliseconds between presence checks while a tag is in the field. */
        const val PRESENCE_CHECK_MS = 1_000
    }
}
