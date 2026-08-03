package io.github.qwadratic.nfctimesheets.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.data.LocalShift
import io.github.qwadratic.nfctimesheets.nfc.NfcReadiness
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.WeekFields
import java.util.Locale

/**
 * The whole app is one of four screens, chosen by the SERVER's answer to "who is this?"
 * (decision-22). There is no path from the ineligible or unconfigured screen into the
 * tabs — not a button, not a swipe — because the tabs are not composed at all.
 */
@Composable
fun TimeSheetApp(
    model: TimeSheetViewModel,
    nfcReadiness: () -> NfcReadiness,
    openIntent: (Intent) -> Unit,
) {
    TimeSheetsTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            when (val state = model.session.collectAsStateWithLifecycle().value) {
                SessionState.Unknown -> Centered {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text(stringResource(R.string.loading_session))
                }
                is SessionState.SignedOut -> SignInScreen(model, state.reasonKey)
                is SessionState.Ineligible -> IneligibleScreen(model, state.email)
                is SessionState.SignedIn -> SignedInScaffold(model, nfcReadiness, openIntent)
            }
        }
    }
}

// -------------------------------------------------------------------------------------
// Signed out. The sign-in mechanism is decision-26 and is still PROPOSED, so this build
// has none. It says so. It does NOT show a button that cannot work: a worker who taps a
// tag and sees a friendly screen while nothing is filed is unpaid work nobody notices.
// -------------------------------------------------------------------------------------
@Composable
private fun SignInScreen(model: TimeSheetViewModel, reasonKey: String?) {
    val configured = remember { model.isSignInConfigured }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState())
            .padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.semantics { heading() },
        )
        Text(stringResource(R.string.signin_subtitle), style = MaterialTheme.typography.bodyLarge)

        if (!configured) {
            Text(
                stringResource(R.string.signin_unconfigured_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
            Text(stringResource(R.string.signin_unconfigured_body))
            Text(
                stringResource(R.string.signin_unconfigured_detail),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Button(
                onClick = model::signIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp), // touch target floor
            ) { Text(stringResource(R.string.signin_subtitle)) }
        }

        if (reasonKey != null) {
            Text(
                stringResource(stringIdFor(reasonKey)),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        // Trap 2. Nothing in the app can fix a stopped-state install from inside the app,
        // so the only useful thing is to tell the person holding the phone.
        Text(
            stringResource(R.string.nfc_first_run_note),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * A DEAD END, deliberately. The only way forward is a human one: the worker reads the
 * address to their manager, who puts it in the worker record. With Apple's Hide My Email
 * that address is a per-app relay nobody could have registered in advance, which is
 * exactly why it has to be on screen and why there is no approval queue to build.
 */
@Composable
private fun IneligibleScreen(model: TimeSheetViewModel, email: String?) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState()) // taller than the screen at large font sizes
            .padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            stringResource(R.string.ineligible_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        Text(stringResource(R.string.ineligible_body))

        if (email != null) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        stringResource(R.string.ineligible_email_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        email,
                        style = MaterialTheme.typography.bodyLarge,
                        // Read as one item and SPELLED OUT: "j7k2p" said as a word is
                        // useless to someone dictating it down a phone line.
                        modifier = Modifier.clearAndSetSemantics {
                            contentDescription = spelledOut(email)
                        },
                    )
                }
            }
        }

        OutlinedButton(onClick = model::signOut, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.sign_out))
        }
    }
}

/** Local part letter by letter, domain as words. A relay address is noise before the @. */
private fun spelledOut(email: String): String {
    val at = email.indexOf('@')
    if (at < 0) return email.toCharArray().joinToString(" ")
    return email.substring(0, at).toCharArray().joinToString(" ") + " at " + email.substring(at + 1)
}

// -------------------------------------------------------------------------------------
// Signed in
// -------------------------------------------------------------------------------------
@Composable
private fun SignedInScaffold(
    model: TimeSheetViewModel,
    nfcReadiness: () -> NfcReadiness,
    openIntent: (Intent) -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf(R.string.tab_log, R.string.tab_history, R.string.tab_settings)
                    .forEachIndexed { index, label ->
                        NavigationBarItem(
                            selected = tab == index,
                            onClick = { tab = index },
                            icon = {},
                            label = { Text(stringResource(label)) },
                        )
                    }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            when (tab) {
                0 -> LogScreen(model, nfcReadiness, openIntent)
                1 -> HistoryScreen(model)
                else -> SettingsScreen(model)
            }
        }
    }
}

@Composable
private fun LogScreen(
    model: TimeSheetViewModel,
    nfcReadiness: () -> NfcReadiness,
    openIntent: (Intent) -> Unit,
) {
    val log by model.log.collectAsStateWithLifecycle()
    val pendingTap by model.pendingTap.collectAsStateWithLifecycle()
    var showResolver by remember { mutableStateOf(false) }

    // THE TAP CONSUMER, and the reason TapInbox exists. This effect is inside the log
    // screen, which is only composed once the session has resolved — so a tap that
    // LAUNCHED the app waits in the inbox and is drained here, and a tap that arrives
    // while the app is open re-runs the effect. One tap, handled exactly once, in both
    // orderings. Pinned by android/checks/core-check.kt.
    LaunchedEffect(pendingTap) {
        if (pendingTap != null) model.consumePendingTap()
    }

    // Checked on every resume, not once at onboarding: a worker can revoke the tag-intent
    // permission from a notification at any time and every tap then silently does nothing.
    val readiness = remember(log) { nfcReadiness() }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                stringResource(R.string.log_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
        }

        if (readiness != NfcReadiness.READY) {
            item { NfcBanner(readiness, openIntent) }
        }

        if (log.unresolved.isNotEmpty()) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            pluralStringResource(
                                R.plurals.resolve_banner,
                                log.unresolved.size,
                                log.unresolved.size,
                            ),
                            color = MaterialTheme.colorScheme.error,
                        )
                        Button(
                            onClick = { showResolver = true },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.resolve_title)) }
                    }
                }
            }
        }

        log.switchNotice?.let { (from, to) ->
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val unknown = stringResource(R.string.unknown_location)
                        Text(
                            stringResource(R.string.switch_notice, from ?: unknown, to ?: unknown),
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                        )
                        TextButton(
                            onClick = model::dismissSwitchNotice,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.resolve_later)) }
                    }
                }
            }
        }

        log.open?.let { open ->
            item { SectionHeading(R.string.log_open_section) }
            item { ShiftRow(open, model.siteName(open.locationId)) }
        }

        item { SectionHeading(R.string.log_recent_section) }
        if (log.recent.isEmpty()) {
            item { Text(stringResource(R.string.log_recent_empty), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(log.recent, key = { it.clientUuid }) { ShiftRow(it, model.siteName(it.locationId)) }

        item {
            // There is no in-app scan button and there must not be one. Clocking in
            // happens by holding the phone to the tag: Android reads it and opens the App
            // Link. A button would be a second, divergent path to the same row.
            Text(
                stringResource(if (log.open == null) R.string.log_hint_start else R.string.log_hint_stop),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
            )
        }

        item {
            OutlinedButton(
                onClick = model::refresh,
                enabled = !log.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.log_refresh)) }
        }
    }

    if (showResolver) {
        ResolveDialog(model, log.unresolved) { showResolver = false }
    }
}

@Composable
private fun NfcBanner(readiness: NfcReadiness, openIntent: (Intent) -> Unit) {
    val (title, body, action) = when (readiness) {
        NfcReadiness.UNSUPPORTED -> Triple(R.string.nfc_missing_title, R.string.nfc_missing_body, null)
        NfcReadiness.DISABLED -> Triple(R.string.nfc_off_title, R.string.nfc_off_body, R.string.nfc_off_action)
        NfcReadiness.TAG_INTENTS_BLOCKED ->
            Triple(R.string.nfc_blocked_title, R.string.nfc_blocked_body, R.string.nfc_blocked_action)
        NfcReadiness.READY -> return
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(title),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { heading() },
            )
            Text(stringResource(body))
            if (action != null) {
                Button(
                    onClick = {
                        openIntent(
                            if (readiness == NfcReadiness.DISABLED) {
                                NfcReadiness.nfcSettingsIntent()
                            } else {
                                NfcReadiness.changeTagIntentPreferenceIntent()
                            },
                        )
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(action)) }
            }
        }
    }
}

/**
 * A failed sync is NEVER invisible. `syncBlocked` means nobody is retrying and a human
 * has to act, so it says that in the error colour rather than "pending".
 */
@Composable
private fun ShiftRow(shift: LocalShift, siteName: String?) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                siteName ?: stringResource(R.string.unknown_location),
                style = MaterialTheme.typography.titleMedium,
            )
            val status = when {
                shift.isOpen -> R.string.status_running
                shift.needsResolution -> R.string.status_auto_closed
                shift.correctedAt != null -> R.string.status_corrected
                else -> null
            }
            status?.let {
                Text(
                    stringResource(it),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (shift.needsResolution) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.tertiary
                    },
                )
            }
        }

        Text(dateTime(shift.startTime), style = MaterialTheme.typography.bodySmall)
        shift.durationSeconds?.let {
            Text(
                stringResource(R.string.duration_format, (it / 3600).toInt(), ((it % 3600) / 60).toInt()),
                style = MaterialTheme.typography.bodySmall,
            )
        }

        val syncKey = shift.syncError
        when {
            syncKey != null -> Text(
                stringResource(stringIdFor(syncKey)),
                style = MaterialTheme.typography.bodySmall,
                color = if (shift.syncBlocked) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.tertiary
                },
            )
            shift.isFullySynced -> Text(stringResource(R.string.sync_sent), style = MaterialTheme.typography.bodySmall)
            else -> Text(stringResource(R.string.sync_sending), style = MaterialTheme.typography.bodySmall)
        }
        HorizontalDivider()
    }
}

/**
 * decision-10. The 8h timer closed these at start+8h, which is a GUESS. A human has to
 * say what the real finish time was before that guess becomes payroll truth.
 *
 * Dismissible, with the banner above staying put: the iOS version learned the hard way
 * that a hard block at the door costs paid time. The pressure stays; the data loss goes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResolveDialog(model: TimeSheetViewModel, shifts: List<WireShift>, onClose: () -> Unit) {
    val shift = shifts.firstOrNull() ?: run { onClose(); return }
    val zone = ZoneId.systemDefault()
    val startLocal = shift.startTime.atZone(zone)
    val suggested = (shift.endTime ?: shift.startTime).atZone(zone)
    val picker = rememberTimePickerState(
        initialHour = suggested.hour,
        initialMinute = suggested.minute,
        is24Hour = true, // Austria writes 14:30, not 2:30 PM
    )
    var errorKey by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    stringResource(R.string.resolve_title),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() },
                )
                Text(stringResource(R.string.resolve_intro))
                Text(shift.locationName ?: stringResource(R.string.unknown_location))
                Text("${stringResource(R.string.resolve_started)}: ${dateTime(shift.startTime)}")
                Text(stringResource(R.string.resolve_finished))
                TimePicker(state = picker)

                errorKey?.let {
                    Text(
                        stringResource(stringIdFor(it)),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                }

                Button(
                    enabled = !saving,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                    onClick = {
                        saving = true
                        // The picker gives a time of day, not a date. Anchor it to the
                        // shift's own start date, and roll to the next day when the pick
                        // is earlier — a shift that starts at 22:00 and ends at 02:00 is
                        // a real night shift, and 422 end_before_start would be nonsense.
                        var end = LocalDate.from(startLocal)
                            .atTime(LocalTime.of(picker.hour, picker.minute))
                            .atZone(zone)
                        if (!end.toInstant().isAfter(shift.startTime)) end = end.plusDays(1)
                        model.resolve(shift, end.toInstant()) { key ->
                            errorKey = key
                            saving = false
                        }
                    },
                ) { Text(stringResource(if (saving) R.string.resolve_saving else R.string.resolve_save)) }

                TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.resolve_later))
                }
            }
        }
    }
}

@Composable
private fun HistoryScreen(model: TimeSheetViewModel) {
    val log by model.log.collectAsStateWithLifecycle()
    val completed = log.shifts.filter { !it.isOpen }
    val weekStart = LocalDate.now()
        .with(WeekFields.of(Locale.getDefault()).dayOfWeek(), 1)
        .atStartOfDay(ZoneId.systemDefault())
        .toInstant()

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                stringResource(R.string.history_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
        }
        item { SectionHeading(R.string.history_summary) }
        item {
            val week = completed.filter { it.startTime >= weekStart }.sumOf { it.durationSeconds ?: 0 }
            val total = completed.sumOf { it.durationSeconds ?: 0 }
            Text(
                stringResource(R.string.history_this_week) + ": " +
                    stringResource(R.string.hours_format, hours(week)),
            )
            Text(
                stringResource(R.string.history_total) + ": " +
                    stringResource(R.string.hours_format, hours(total)),
            )
        }
        item { SectionHeading(R.string.history_shifts) }
        if (log.shifts.isEmpty()) {
            item { Text(stringResource(R.string.history_empty), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(log.shifts, key = { it.clientUuid }) { ShiftRow(it, model.siteName(it.locationId)) }
    }
}

@Composable
private fun SettingsScreen(model: TimeSheetViewModel) {
    val worker = (model.session.collectAsStateWithLifecycle().value as? SessionState.SignedIn)?.worker
    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            stringResource(R.string.settings_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        // "Who are you" is not a setting a worker gets to choose (decision-22). It is the
        // server's answer, shown read-only.
        Text("${stringResource(R.string.settings_signed_in_as)}: ${worker?.name.orEmpty()}")
        Text(
            stringResource(R.string.settings_admin_note),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = model::signOut,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.sign_out)) }
        Text(
            stringResource(R.string.settings_sign_out_note),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ---- small shared pieces -------------------------------------------------------------

@Composable
private fun SectionHeading(res: Int) {
    Text(
        stringResource(res),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

private val dateTimeFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private fun dateTime(instant: Instant): String = dateTimeFormat.format(instant)

private fun hours(seconds: Long): String = String.format(Locale.getDefault(), "%.1f", seconds / 3600.0)
