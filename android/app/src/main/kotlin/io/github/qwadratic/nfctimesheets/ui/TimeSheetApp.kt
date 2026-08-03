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
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.core.EnrolmentCode
import io.github.qwadratic.nfctimesheets.core.MaterialEntry
import io.github.qwadratic.nfctimesheets.core.MaterialQueue
import io.github.qwadratic.nfctimesheets.core.MaterialStatus
import io.github.qwadratic.nfctimesheets.core.QueuedMaterialRequest
import io.github.qwadratic.nfctimesheets.core.WireMaterialRequest
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
 * The whole app is one of three screens, chosen by the SERVER's answer to "who is this?"
 * (decision-22). There is no path from the sign-in screen into the tabs — not a button,
 * not a swipe — because the tabs are not composed at all.
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
                is SessionState.SignedIn -> SignedInScaffold(model, nfcReadiness, openIntent)
            }
        }
    }
}

// -------------------------------------------------------------------------------------
// Signed out. ONE FIELD, and nothing else (decision-26).
//
// The worker has just been read an 8-character code down the phone by the admin, who
// issued it for them by name. They type it once, ever. So this screen has no account
// creation, no provider buttons, no password, no "forgot" link and no second field --
// every one of those would be a thing to get wrong while standing in a stairwell.
// -------------------------------------------------------------------------------------
@Composable
private fun SignInScreen(model: TimeSheetViewModel, reasonKey: String?) {
    // rememberSaveable: a rotation, or Android tearing the activity down behind a
    // notification, must not eat the characters already typed. It is deliberately NOT in
    // the ViewModel and NOT on disk -- a bearer credential does not get persisted by us.
    var typed by rememberSaveable { mutableStateOf("") }
    // What was in the field when the last refusal came back. The message belongs to THAT
    // string, so it disappears the moment they start correcting it — a field that stays
    // red while you retype tells you nothing and looks broken.
    var attempted by rememberSaveable { mutableStateOf<String?>(null) }
    val busy by model.signingIn.collectAsStateWithLifecycle()
    // The refusal that is currently on screen, or null. Non-null exactly when there IS a
    // reason AND the field still holds the string it was about.
    val errorKey = reasonKey?.takeIf { typed == attempted }
    val showError = errorKey != null
    val submit = {
        if (!busy) {
            attempted = typed
            model.signIn(typed)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState()) // taller than the screen at 200% font
            .padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.semantics { heading() },
        )
        Text(stringResource(R.string.signin_code_intro), style = MaterialTheme.typography.bodyLarge)

        OutlinedTextField(
            value = typed,
            // Capped at the same length the server will even look at. Everything else is
            // accepted as typed and sorted out by EnrolmentCode.normalise() on submit:
            // rewriting the text under the cursor is how input fields fight their user.
            onValueChange = { typed = it.take(EnrolmentCode.MAX_INPUT) },
            singleLine = true,
            isError = showError,
            label = { Text(stringResource(R.string.signin_code_label)) },
            // ONE message for every refusal. Unknown, malformed, expired, already used,
            // revoked, worker deactivated -- the server makes all six byte-identical on
            // purpose (decision-26) and this screen must not invent a distinction it
            // does not have. Only "no connection" is separate, because that one is not
            // about the code at all.
            //
            // It goes IN the supporting text, not next to the field: that is what
            // associates it with the input for TalkBack, so "Anmeldecode, ungültig" is
            // followed by what to do about it instead of by silence. Assertive because
            // the worker is looking at the keyboard, not at the field.
            supportingText = {
                if (errorKey != null) {
                    Text(
                        stringResource(stringIdFor(errorKey)),
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                } else {
                    Text(stringResource(R.string.signin_code_hint))
                }
            },
            keyboardOptions = KeyboardOptions(
                // Upper case because that is how the code was written down and read out,
                // so what is on screen matches what is on the admin's screen. It is only
                // cosmetic -- normalise() folds case anyway, so the shift key cannot
                // cost anyone an attempt.
                capitalization = KeyboardCapitalization.Characters,
                // The one thing that MUST be off. Autocorrect on an 8-character
                // non-word will happily replace it with a German noun mid-typing, and
                // the worker would have no idea why a correct code keeps failing.
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Go,
            ),
            keyboardActions = KeyboardActions(onGo = { submit() }),
            // Plain text, NOT a password field: the whole point is that they can check
            // what they typed against what was said to them.
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp),
        )

        Button(
            onClick = submit,
            enabled = !busy,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp), // touch target floor
        ) {
            Text(stringResource(if (busy) R.string.signin_submitting else R.string.signin_submit))
        }

        Text(
            stringResource(R.string.signin_code_help),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // Trap 2. Nothing in the app can fix a stopped-state install from inside the app,
        // so the only useful thing is to tell the person holding the phone.
        Text(
            stringResource(R.string.nfc_first_run_note),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
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
    val materials by model.materials.collectAsStateWithLifecycle()
    val arrivals = materials.unseenArrivals.size
    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf(R.string.tab_log, R.string.tab_material, R.string.tab_history, R.string.tab_settings)
                    .forEachIndexed { index, label ->
                        NavigationBarItem(
                            selected = tab == index,
                            onClick = { tab = index },
                            icon = {
                                // The count of things sitting in the warehouse that
                                // nobody has told this worker about. A NUMBER and not a
                                // dot, and spoken rather than only coloured.
                                //
                                // It only ever moves while the app is open: there is no
                                // push in this system (decision-23), and the material
                                // screen says so in words.
                                if (index == MATERIAL_TAB && arrivals > 0) {
                                    val spoken = pluralStringResource(
                                        R.plurals.a11y_material_badge, arrivals, arrivals,
                                    )
                                    Badge(
                                        modifier = Modifier.semantics { contentDescription = spoken },
                                    ) { Text("$arrivals") }
                                }
                            },
                            label = { Text(stringResource(label)) },
                        )
                    }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            when (tab) {
                0 -> LogScreen(model, nfcReadiness, openIntent)
                MATERIAL_TAB -> MaterialScreen(model)
                2 -> HistoryScreen(model)
                else -> SettingsScreen(model)
            }
        }
    }
}

/** Named because the badge and the `when` above must not drift apart. */
private const val MATERIAL_TAB = 1

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

// -------------------------------------------------------------------------------------
// Materials. "I need something", in the worker's own words.
//
// THIS SCREEN IS NOT THE PRODUCT. Clocking in is. Nothing here is on the tap path,
// nothing here is awaited by the log screen, and every failure below ends as a sentence
// on a row rather than as a blocked screen.
// -------------------------------------------------------------------------------------
@Composable
private fun MaterialScreen(model: TimeSheetViewModel) {
    val state by model.materials.collectAsStateWithLifecycle()
    val log by model.log.collectAsStateWithLifecycle()
    // rememberSaveable: a rotation, or Android tearing the activity down behind a
    // notification, must not eat what has already been typed.
    var typed by rememberSaveable { mutableStateOf("") }
    var justSaved by rememberSaveable { mutableStateOf(false) }

    // Adopt, read from disk, then push and pull. Keyed on Unit: entering the tab is the
    // poll, and the screen says out loud that this is the only time it happens.
    LaunchedEffect(Unit) { model.startMaterials() }

    val contextLocationId = log.open?.locationId

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                stringResource(R.string.material_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
        }

        // Arrived, and nobody has been told. The whole reason this screen polls.
        if (state.unseenArrivals.isNotEmpty()) {
            item { SectionHeading(R.string.material_ready_section) }
            items(state.unseenArrivals, key = { "ready-${it.id}" }) { request ->
                val what = request.itemName ?: request.body
                Card(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            stringResource(R.string.material_ready),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                        // Said as one sentence rather than as two fragments a screen
                        // reader has to join up: "Zum Abholen bereit: Glasreiniger 5 l".
                        val spokenRow = stringResource(R.string.a11y_material_ready, what)
                        Text(what, modifier = Modifier.semantics { contentDescription = spokenRow })
                        request.arrivedAt?.let {
                            Text(
                                stringResource(R.string.material_arrived_at, dateTime(it)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Button(
                            onClick = { model.markMaterialSeen(request) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.material_ack)) }
                    }
                }
            }
        }

        // Ask.
        item { SectionHeading(R.string.material_ask_section) }
        item {
            OutlinedTextField(
                value = typed,
                // Hard stop at the server's own limit rather than a 400 the worker cannot
                // read. Truncating only when it is exceeded means the cursor is never
                // moved under somebody who is still typing.
                onValueChange = {
                    typed = it.take(MaterialQueue.BODY_MAX)
                    justSaved = false
                },
                label = { Text(stringResource(R.string.material_input_label)) },
                supportingText = { Text(stringResource(R.string.material_input_hint)) },
                // Multi-line and NOT singleLine: "zwei Mopps, Glasreiniger, 3 Sack
                // Müllsäcke" is a list, and a one-line box says the wrong thing about
                // how much detail is welcome. Autocorrect stays ON here, unlike the code
                // field — this is prose in the worker's own language.
                minLines = 3,
                maxLines = 8,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    keyboardType = KeyboardType.Text,
                    imeAction = ImeAction.Default,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (typed.length > MaterialQueue.BODY_MAX - 200) {
            item {
                Text(
                    stringResource(R.string.material_char_count, typed.length, MaterialQueue.BODY_MAX),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (contextLocationId != null) {
            item {
                // CONTEXT, never a cost split (decision-6). The building is recorded
                // because it is the one thing the worker actually knows; the P&L divides
                // materials pro-rata by labour hours and never by this field.
                val name = model.siteName(contextLocationId)
                Text(
                    if (name != null) {
                        stringResource(R.string.material_for_site, name)
                    } else {
                        stringResource(R.string.material_for_current_site)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            Button(
                onClick = {
                    if (model.submitMaterial(typed)) {
                        typed = ""
                        justSaved = true
                    }
                },
                enabled = MaterialQueue.normalise(typed) != null,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.material_submit)) }
        }
        if (justSaved) {
            item {
                Text(
                    stringResource(R.string.material_saved),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
        item {
            // decision-23: the server's dependencies are pg + @sentry/node. There is no
            // APNs certificate and no FCM project, so THERE IS NO PUSH. Promising a
            // notification to somebody who then does not get one is the difference
            // between a late delivery and a broken product.
            Text(
                stringResource(R.string.material_no_push_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // Everything, newest first.
        item { SectionHeading(R.string.material_list_section) }
        if (state.featureUnavailable) {
            item {
                Text(
                    stringResource(R.string.material_unavailable_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (state.entries.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.material_list_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(state.entries, key = { it.key }) { entry ->
            when (entry) {
                is MaterialEntry.Queued -> QueuedMaterialRow(entry.row, model::siteName)
                is MaterialEntry.Sent -> SentMaterialRow(entry.row)
            }
        }

        item {
            OutlinedButton(
                onClick = model::syncMaterials,
                enabled = !state.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.log_refresh)) }
        }
    }
}

/**
 * Written, not yet acknowledged by the server. NEVER silently pretty: an unsent request
 * says it is unsent, and a blocked one says a human has to act.
 */
@Composable
private fun QueuedMaterialRow(row: QueuedMaterialRequest, siteName: (String) -> String?) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(row.body, style = MaterialTheme.typography.bodyLarge)
        row.locationId?.let { id ->
            siteName(id)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(
            dateTime(row.createdAt),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            row.errorKey?.let { stringResource(stringIdFor(it)) } ?: stringResource(R.string.sync_sending),
            style = MaterialTheme.typography.bodySmall,
            color = if (row.blocked) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider()
    }
}

/**
 * The server's copy. The status is ALWAYS rendered as words — the colour is a second
 * signal, never the only one.
 */
@Composable
private fun SentMaterialRow(row: WireMaterialRequest) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(row.body, style = MaterialTheme.typography.bodyLarge)
        row.itemName?.let { item ->
            Text(
                row.quantity?.let { stringResource(R.string.material_quantity_item, it, item) } ?: item,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        row.locationName?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            stringResource(materialStatusRes(row)),
            style = MaterialTheme.typography.bodyMedium,
            color = when {
                row.status == MaterialStatus.REJECTED -> MaterialTheme.colorScheme.error
                row.isUnseenArrival -> MaterialTheme.colorScheme.tertiary
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        row.adminNote?.takeIf { it.isNotBlank() }?.let {
            // The office's own words about this decision. It is the only explanation a
            // refused worker gets, so it is shown rather than swallowed.
            Text(
                stringResource(R.string.material_admin_note, it),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            dateTime(row.createdAt),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider()
    }
}

/**
 * An unknown status is reported as unknown. Inventing "in progress" for a value this
 * build has never seen would be a guess shown as a fact. An explicit `when` with no
 * `else`, so a sixth status added to [MaterialStatus] fails to compile here.
 */
private fun materialStatusRes(row: WireMaterialRequest): Int = when (row.status) {
    MaterialStatus.SUBMITTED -> R.string.material_status_submitted
    MaterialStatus.APPROVED -> R.string.material_status_approved
    MaterialStatus.ORDERED -> R.string.material_status_ordered
    MaterialStatus.ARRIVED ->
        if (row.seenAt == null) R.string.material_status_arrived else R.string.material_status_collected
    MaterialStatus.REJECTED -> R.string.material_status_rejected
    null -> R.string.material_status_unknown
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
