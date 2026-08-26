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
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone
import io.github.qwadratic.nfctimesheets.core.WireZoneVerifyResult
import io.github.qwadratic.nfctimesheets.core.Zones
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
 * signal.
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
    private var operatorCode by mutableStateOf("")
    private var enrolFailed by mutableStateOf(false)
    private var busy by mutableStateOf(false)

    private var zones by mutableStateOf<List<WireOperatorZone>>(emptyList())
    private var zonesLoading by mutableStateOf(false)
    private var zonesError by mutableStateOf(false)

    private var selectedZone by mutableStateOf<WireOperatorZone?>(null)
    private var checking by mutableStateOf(false)
    private var outcome by mutableStateOf<VerifyOutcome?>(null)

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
                stringResource(R.string.verify_needs_operator),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            if (enrolFailed) {
                Text(stringResource(R.string.err_invalid_code), color = MaterialTheme.colorScheme.error)
            }
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
                        Text("${z.locationName} \u00b7 ${z.name}")
                        Text(
                            if (z.isVerified) {
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
            stringResource(R.string.verify_selected, zone.name, zone.locationName),
            style = MaterialTheme.typography.titleMedium,
        )
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

        OutlinedButton(
            onClick = ::changeZone,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_change_zone)) }
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
        if (!operatorReady || selectedZone == null) return
        val nfc = adapter ?: return
        if (!nfc.isEnabled) return
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        nfc.enableReaderMode(this, ::onTag, flags, null)
    }

    private fun selectZone(zone: WireOperatorZone) {
        selectedZone = zone
        outcome = null
        checking = false
        startReaderMode()
    }

    private fun changeZone() {
        adapter?.disableReaderMode(this)
        selectedZone = null
        outcome = null
        checking = false
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
                val result = app.operatorApi.verifyZone(target.id, placeUuid)
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
        if (zones.isEmpty()) zones = app.operatorZones.read()
    }

    private suspend fun refreshZones() {
        zonesLoading = true
        try {
            val envelope = app.operatorApi.operatorZones()
            app.operatorZones.write(envelope)
            zones = Wire.operatorZones(envelope)
            zonesError = false
        } catch (_: Exception) {
            zonesError = true
        } finally {
            zonesLoading = false
        }
    }

    private fun enrolOperator() {
        val code = EnrolmentCode.normalise(operatorCode) ?: return
        busy = true
        enrolFailed = false
        lifecycleScope.launch {
            try {
                app.operatorApi.operatorEnrol(code)
                operatorCode = ""
                operatorReady = app.operatorCookies.header() != null
                loadZonesFromCache()
                lifecycleScope.launch { refreshZones() }
                startReaderMode()
            } catch (_: Exception) {
                // decision-26: no reason is ever given for a rejected code, here either.
                enrolFailed = true
            }
            busy = false
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

    private companion object {
        val dateTimeFormat: DateTimeFormatter =
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())
    }
}
