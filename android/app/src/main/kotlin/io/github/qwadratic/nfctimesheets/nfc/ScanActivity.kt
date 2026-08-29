package io.github.qwadratic.nfctimesheets.nfc

import android.app.Activity
import android.content.Intent
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.qwadratic.nfctimesheets.BuildConfig
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication
import io.github.qwadratic.nfctimesheets.core.Zones
import io.github.qwadratic.nfctimesheets.ui.TimeSheetsTheme

/**
 * EXPLICIT SCAN — the fallback for phones where the OS never dispatches the tag on its own.
 *
 * WHY THIS EXISTS. The normal path is passive: the OS reads the tag and launches us, with
 * the app closed and the worker doing nothing but holding the phone to the wall. That is
 * the product, and it stays the product. But that dispatch depends on the OS, the launcher
 * and the vendor skin all behaving, and on at least one real device it simply never fires —
 * no error, no log, nothing. This screen removes the OS from the equation: reader mode
 * hands tag reads straight to THIS activity while it is in the foreground.
 *
 * IT CONVERGES, IT DOES NOT FORK. A successful read starts the same ACTION_VIEW intent the
 * tag itself would have produced, so the URI goes through the same TagLink parser, the same
 * TapInbox and the same dedupe. There is no second clock-in path to keep in step with the
 * first, and a tag scanned here is indistinguishable downstream from a tag tapped normally.
 *
 * IT IS ALSO THE DIAGNOSTIC. When a tag does not work, this screen reports what it actually
 * saw — technologies, UID, whether there was an NDEF message, what URI was in it and whether
 * that URI was for this build's host. That distinguishes "this phone cannot read this tag at
 * all" from "it read it fine and the OS just did not route it", which is exactly the question
 * that blocked us, and which no amount of staring at a dead tap could answer.
 */
class ScanActivity : ComponentActivity() {

    private val app: TimeSheetsApplication get() = application as TimeSheetsApplication
    private var adapter: NfcAdapter? = null

    /** What the last read saw. Shown verbatim: this screen's job is to be honest, not tidy. */
    private var status by mutableStateOf<ScanStatus>(ScanStatus.Waiting)


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
                        Text(
                            text = stringResource(R.string.scan_title),
                            style = MaterialTheme.typography.headlineSmall,
                        )
                        Text(
                            text = stringResource(R.string.scan_hint),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        // liveRegion: TalkBack announces each read without the worker having
                        // to hunt for what changed while holding a phone against a wall.
                        Text(
                            text = statusText(status),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                        Button(
                            onClick = { finish() },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.scan_close)) }
                    }
                }
            }
        }
    }

    /**
     * Reader mode is foreground-only and must be torn down in onPause, or it keeps claiming
     * tag reads after the worker has left this screen.
     */
    override fun onResume() {
        super.onResume()
        val nfc = adapter
        if (nfc == null) {
            status = ScanStatus.Unsupported
            return
        }
        if (!nfc.isEnabled) {
            status = ScanStatus.Disabled
            return
        }
        // Every technology, not just NfcA: a tag we cannot parse is still worth REPORTING,
        // and SKIP_NDEF_CHECK is deliberately NOT set because the NDEF read is the point.
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        nfc.enableReaderMode(this, ::onTag, flags, null)
        status = ScanStatus.Waiting
    }

    override fun onPause() {
        super.onPause()
        adapter?.disableReaderMode(this)
    }

    /** Called off the main thread by the NFC service. */
    private fun onTag(tag: Tag) {
        val techs = tag.techList.map { it.substringAfterLast('.') }
        val uid = tag.id.joinToString(":") { "%02X".format(it) }
        val uri = readUri(tag)

        // Our own tag first: a real URL always wins over any serial table, so a tag we
        // wrote keeps working even if its serial were ever listed by mistake.
        val fromUri = app.tagLink.locationId(uri?.toString())
        // Then a roster-cached zone serial (decision-44 §4): an admin-adopted tag,
        // resolved from the server, takes priority over the compiled fallback below.
        val fromRosterZone = if (fromUri == null) Zones.zonePlaceIdForSerial(uid, app.store.zones()) else null
        // Then the compiled last-resort table. See KnownTags for what this costs, and why
        // it is NOT deleted this phase.
        val fromSerial = if (fromUri == null && fromRosterZone == null) KnownTags.locationIdFor(uid) else null
        val locationId = fromUri ?: fromRosterZone ?: fromSerial

        runOnUiThread {
            when {
                locationId != null -> {
                    status = if (fromRosterZone != null || fromSerial != null) {
                        ScanStatus.AcceptedBySerial
                    } else {
                        ScanStatus.Accepted
                    }
                    // THE CONVERGENCE. Hand a URL back through the ordinary front door so
                    // everything downstream is identical to a passive tap. A serial-matched
                    // tag has no URL of its own, so one is synthesised from the PLACE it
                    // maps to (a zone id or, from the compiled table, a building id) —
                    // which means TagLink still parses it and still gets the final say.
                    val target = if (fromRosterZone != null || fromSerial != null) {
                        app.tagLink.uriFor(fromRosterZone ?: fromSerial)?.let { Uri.parse(it.toString()) }
                    } else {
                        uri
                    }
                    startActivity(
                        Intent(Intent.ACTION_VIEW, target)
                            .setPackage(packageName)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    )
                    finish()
                }

                uri != null -> status = ScanStatus.WrongUri(uri.toString(), techs, uid)
                else -> status = ScanStatus.NoUri(techs, uid)
            }
        }
    }

    /**
     * First URI record of the NDEF message. Everything is wrapped: the tag is unlocked and
     * attacker-writable (decision-15), so a malformed record is a normal event, not a crash.
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

    private fun statusText(s: ScanStatus): String = when (s) {
        ScanStatus.Waiting -> getString(R.string.scan_waiting)
        ScanStatus.Unsupported -> getString(R.string.scan_unsupported)
        ScanStatus.Disabled -> getString(R.string.scan_disabled)
        ScanStatus.Accepted -> getString(R.string.scan_accepted)
        ScanStatus.AcceptedBySerial -> getString(R.string.scan_accepted_serial)
        is ScanStatus.NoUri -> getString(R.string.scan_no_uri, s.techs.joinToString(", "), s.uid)
        is ScanStatus.WrongUri ->
            getString(R.string.scan_wrong_uri, s.uri, BuildConfig.TAG_HOST, s.techs.joinToString(", "), s.uid)
    }

    private sealed interface ScanStatus {
        data object Waiting : ScanStatus
        data object Unsupported : ScanStatus
        data object Disabled : ScanStatus
        data object Accepted : ScanStatus
        data object AcceptedBySerial : ScanStatus
        data class NoUri(val techs: List<String>, val uid: String) : ScanStatus
        data class WrongUri(val uri: String, val techs: List<String>, val uid: String) : ScanStatus
    }
}
