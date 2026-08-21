package io.github.qwadratic.nfctimesheets.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.material3.DatePicker
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
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
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import io.github.qwadratic.nfctimesheets.BuildConfig
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.core.EnrolmentCode
import io.github.qwadratic.nfctimesheets.core.MaterialEntry
import io.github.qwadratic.nfctimesheets.core.MaterialQueue
import io.github.qwadratic.nfctimesheets.core.MaterialStatus
import io.github.qwadratic.nfctimesheets.core.PendingWork
import io.github.qwadratic.nfctimesheets.core.QueuedMaterialRequest
import io.github.qwadratic.nfctimesheets.core.RunningShift
import io.github.qwadratic.nfctimesheets.core.ShiftSignal
import io.github.qwadratic.nfctimesheets.core.WireMaterialRequest
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.data.LocalShift
import io.github.qwadratic.nfctimesheets.nfc.NfcReadiness
import io.github.qwadratic.nfctimesheets.nfc.ScanActivity
import io.github.qwadratic.nfctimesheets.nfc.WriteTagActivity
import io.github.qwadratic.nfctimesheets.sync.SyncScheduler
import io.github.qwadratic.nfctimesheets.update.UpdateReadiness
import io.github.qwadratic.nfctimesheets.update.UpdateState
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
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
    // Signing out does NOT delete a queued shift — it belongs to the worker who logged it
    // and goes out when that worker signs back in. So the count has to be on THIS screen,
    // or somebody hands the phone back believing their hours went with it (TASK-225).
    val pending by model.log.collectAsStateWithLifecycle()
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

        PendingCard(pending.pending, signedOut = true, armed = pending.pushArmed)

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
    val log by model.log.collectAsStateWithLifecycle()
    val materials by model.materials.collectAsStateWithLifecycle()
    val arrivals = materials.unseenArrivals.size

    // THE LOCK. While a shift runs the navigation bar is shorter: Verlauf goes, because
    // nothing in it is time-critical. Material and Einstellungen NEVER go, because a
    // worker standing in a building needs to ask for supplies and a handed-over phone must
    // be signable-out (decision-26). The resolver is not a tab: it is a card on the log
    // screen, shown in every state (decision-10).
    //
    // This is WORK DISCIPLINE and not a security boundary. The rule lives in the pure
    // ShiftSignal.visibleTabs, which core-check asserts can never return a set without
    // MATERIALS and SETTINGS in it.
    val tabs = ShiftSignal.visibleTabs(shiftRunning = log.open != null)

    // Saved by NAME, not by index: the index of a tab changes when the lock removes one,
    // and a saved index would silently reopen a different screen after a rotation.
    var selectedName by rememberSaveable { mutableStateOf(ShiftSignal.Tab.LOG.name) }
    // The worker was on Verlauf when the shift started. Falling back to the log screen is
    // the whole point - they are not left staring at a tab that no longer exists.
    val current = tabs.firstOrNull { it.name == selectedName } ?: ShiftSignal.Tab.LOG

    // Coming back from the background: repost a notification the worker swiped away and
    // notice a permission that was flipped in Settings while the app was not running.
    LifecycleResumeEffect(Unit) {
        model.onForeground()
        onPauseOrDispose { }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = current == tab,
                        onClick = { selectedName = tab.name },
                        icon = {
                            // The count of things sitting in the warehouse that nobody has
                            // told this worker about. A NUMBER and not a dot, and spoken
                            // rather than only coloured.
                            //
                            // It only ever moves while the app is open: there is no push in
                            // this system (decision-23), and the material screen says so.
                            if (tab == ShiftSignal.Tab.MATERIALS && arrivals > 0) {
                                val spoken = pluralStringResource(
                                    R.plurals.a11y_material_badge, arrivals, arrivals,
                                )
                                Badge(
                                    modifier = Modifier.semantics { contentDescription = spoken },
                                ) { Text("$arrivals") }
                            }
                        },
                        label = { Text(stringResource(tabLabel(tab))) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            // Explicit and exhaustive, no `else`: a fifth tab added to ShiftSignal.Tab
            // fails to compile here rather than silently rendering Einstellungen.
            when (current) {
                ShiftSignal.Tab.LOG -> LogScreen(model, nfcReadiness, openIntent)
                ShiftSignal.Tab.MATERIALS -> MaterialScreen(model)
                ShiftSignal.Tab.HISTORY -> HistoryScreen(model)
                ShiftSignal.Tab.SETTINGS -> SettingsScreen(model, openIntent)
            }
        }
    }
}

private fun tabLabel(tab: ShiftSignal.Tab): Int = when (tab) {
    ShiftSignal.Tab.LOG -> R.string.tab_log
    ShiftSignal.Tab.MATERIALS -> R.string.tab_material
    ShiftSignal.Tab.HISTORY -> R.string.tab_history
    ShiftSignal.Tab.SETTINGS -> R.string.tab_settings
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
    //
    // THIS USED TO SAY "every resume" AND NOT DO IT. It was remember(log), so the reading
    // was cached until the shift list happened to change. The worker saw "NFC is switched
    // off", went to Settings, switched NFC ON, came back — and the banner was still there,
    // still telling them it was off, with the app now lying. The only way out was to kill
    // and relaunch the app, which nobody guesses. Re-read on ON_RESUME, which is exactly
    // the moment they come back from Settings.
    var readiness by remember { mutableStateOf(nfcReadiness()) }
    LifecycleResumeEffect(Unit) {
        readiness = nfcReadiness()
        onPauseOrDispose { }
    }
    val logContext = LocalContext.current

    // TWO SHAPES, and which one is on screen is the entire point of this work. Idle: a
    // list of recent shifts. Running: a full-bleed screen with a ticking clock, which is
    // unmistakable from across a room. The old build's whole in-shift signal was the word
    // "Läuft" on a row.
    val open = log.open
    if (open != null) {
        ShiftRunningScreen(
            model = model,
            running = RunningShift(
                locationId = open.locationId,
                locationName = model.siteName(open.locationId),
                startTime = open.startTime,
                serverAutoClosed = open.needsResolution,
            ),
            unresolvedCount = log.unresolved.size,
            onResolve = { showResolver = true },
            notice = log.switchNotice,
            onDismissNotice = model::dismissSwitchNotice,
            pending = log.pending,
            pushArmed = log.pushArmed,
            readiness = readiness,
            openIntent = openIntent,
        )
        if (showResolver) {
            ResolveDialog(model, log.unresolved) { showResolver = false }
        }
        return
    }

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

        // ABOVE the buttons and above the recent list: this is unpaid work that the server
        // has never heard of, and it outranks everything else on the screen.
        if (!log.pending.isEmpty) {
            item { PendingCard(log.pending, armed = log.pushArmed) }
        }

        // MANUAL FALLBACK, deliberately secondary. The product is the passive tap: hold the
        // phone to the wall with the app closed. But that depends on the OS dispatching the
        // tag, and on some phones it never does - silently, with nothing to debug. This
        // button removes the OS from the path by reading the tag in the foreground, and it
        // reports what it saw when a tag does not work. Hidden when there is no NFC chip at
        // all, because then there is nothing to offer.
        if (readiness != NfcReadiness.UNSUPPORTED) {
            item {
                OutlinedButton(
                    onClick = { openIntent(Intent(logContext, ScanActivity::class.java)) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.scan_open)) }
            }
            // WRITE A TAG. Deliberately here, on the log screen, and NOT on the idle screen
            // or anywhere a worker lands by accident: the operator opens the app on purpose
            // to mount tags, and a cleaner holding a phone to a wall must never be one
            // mis-tap away from a screen that OVERWRITES the tag they are standing at.
            // Nothing behind this button can open or close a shift (decision-45).
            item {
                OutlinedButton(
                    onClick = { openIntent(Intent(logContext, WriteTagActivity::class.java)) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.write_open)) }
            }
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
                stringResource(R.string.log_hint_start),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
            )
        }

        item {
            // decision-23: there is no push in this system. Promising a notification to
            // somebody who then does not get one is the difference between a late delivery
            // and a broken product. The material screen has said this since day one; the
            // log screen now does too, and so does iOS.
            Text(
                stringResource(R.string.log_no_push_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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

// -------------------------------------------------------------------------------------
// THE SHIFT SCREEN. Not a label on a row - THE screen.
//
// The failure this exists to prevent: a worker taps in at 06:02, pockets the phone, goes
// home, and nothing on that phone ever mentions the shift again. At 14:02 the server
// closes it, it leaves payroll (decision-10), and the office pays for a manual correction.
// So while a shift runs the app is unmistakable from across a room and has one subject.
//
// THE LOCK IS WORK DISCIPLINE, NOT SECURITY, and it never traps anybody: the resolver, the
// material tab, Abmelden and the help text are reachable at every moment, as labelled
// controls rather than gestures. Only Verlauf goes away. See ShiftSignal.visibleTabs.
// -------------------------------------------------------------------------------------
@Composable
private fun ShiftRunningScreen(
    model: TimeSheetViewModel,
    running: RunningShift,
    unresolvedCount: Int,
    onResolve: () -> Unit,
    notice: Pair<String?, String?>?,
    onDismissNotice: () -> Unit,
    /** What this phone is still holding (TASK-225). Usually zero; never hidden when not. */
    pending: PendingWork.Summary,
    /** Whether the platform is holding the delivery job. See [PendingCard]. */
    pushArmed: Boolean,
    readiness: NfcReadiness,
    openIntent: (Intent) -> Unit,
) {
    val context = LocalContext.current

    // One tick a second, and nothing else in the app depends on it. `produceState` so the
    // loop dies with the composable rather than outliving the screen.
    val now by produceState(initialValue = Instant.now(), running) {
        while (true) {
            value = Instant.now()
            delay(1_000)
        }
    }
    val phase = ShiftSignal.phase(running, now)
    val overdue = phase == ShiftSignal.Phase.OVERDUE
    val (hours, minutes) = ShiftSignal.elapsed(running.startTime, now)

    // Colour is the SECOND signal, never the only one: the state is spelled out in words
    // directly under the clock. Theme colours, so this is legible in dark mode and under
    // the system's high-contrast settings instead of being two hardcoded hex values.
    val container = if (overdue) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.tertiaryContainer
    }
    val onContainer = if (overdue) {
        MaterialTheme.colorScheme.onErrorContainer
    } else {
        MaterialTheme.colorScheme.onTertiaryContainer
    }

    // THE PERMISSION MOMENT. After the first successful clock-in, from the screen that is
    // already explaining what the reminder buys - never at launch and never on the tap
    // path. The gate is the pure ShiftSignal.shouldAskForNotifications and core-check pins
    // it. Nothing here can fail a tap: this composable only exists because one succeeded.
    var silenced by remember { mutableStateOf(model.outOfAppSignalsSilenced()) }
    val permission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        silenced = !granted
        if (granted) model.onForeground() // re-post now that we are allowed to
    }
    LaunchedEffect(Unit) {
        if (model.shouldAskForNotifications(Build.VERSION.SDK_INT)) {
            // Marked BEFORE launching: a worker who dismisses the dialog by tapping outside
            // it must not be asked again on the next shift.
            model.markNotificationsAsked()
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    // The "notifications are off" card has a button that leaves the app. Re-reading the
    // answer on resume is what makes the card disappear when they come back having turned
    // them on - otherwise it keeps telling somebody who just fixed it that it is broken.
    LifecycleResumeEffect(Unit) {
        silenced = model.outOfAppSignalsSilenced()
        onPauseOrDispose { }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(container)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            // At 200% font scale this content is far taller than the screen, and a locked
            // screen that clips its own instructions is worse than no lock at all.
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(if (overdue) R.string.shift_overdue_heading else R.string.shift_running_heading),
            style = MaterialTheme.typography.titleMedium,
            color = onContainer,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            running.locationName ?: stringResource(R.string.unknown_location),
            style = MaterialTheme.typography.headlineLarge,
            color = onContainer,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.shift_started_at, timeOfDay(running.startTime)),
            style = MaterialTheme.typography.bodyMedium,
            color = onContainer,
        )

        // The dominant element, and the whole reason this screen exists.
        //
        // The digits are `clearAndSetSemantics {}`: a per-second change under TalkBack is
        // unusable, and a screen whose only content is a timer is precisely where that bug
        // would be worst. The ONE spoken element is the card, whose label is recomputed
        // from (hours, minutes) and therefore changes once a minute. Changing a label is
        // not an announcement, so nothing is interrupted.
        val spoken = if (overdue) {
            stringResource(R.string.a11y_shift_overdue, running.locationName ?: stringResource(R.string.unknown_location))
        } else {
            stringResource(
                R.string.a11y_shift_elapsed,
                hours, minutes,
                running.locationName ?: stringResource(R.string.unknown_location),
            )
        }
        Card(
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = spoken },
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 28.dp, horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    // No running clock on a shift the 8h timer has closed: it would be a
                    // lie about a row that is already out of payroll until a human fixes it.
                    if (overdue) OVERDUE_CLOCK else clock(running.startTime, now),
                    style = MaterialTheme.typography.displayLarge,
                    modifier = Modifier.clearAndSetSemantics { },
                )
                Text(
                    stringResource(if (overdue) R.string.shift_overdue_body else R.string.shift_running_label),
                    style = MaterialTheme.typography.titleSmall,
                    textAlign = TextAlign.Center,
                )
            }
        }

        // The single obvious way to end the shift. There is still no button that CLOSES a
        // shift, and there must not be one: clocking out is a tag tap, and a second path to
        // the same row is how two mechanisms start disagreeing about somebody's hours.
        Text(
            stringResource(R.string.log_hint_stop),
            style = MaterialTheme.typography.titleMedium,
            color = onContainer,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        // Manual scan is NOT that second path. It still requires the worker to be at the
        // tag with the phone against it - it only moves the tag read from the OS into the
        // app, which is the whole point for an adopted tag that carries no URL and so can
        // never launch anything by itself.
        //
        // THIS BEING ABSENT WAS A REAL, SHIPPED BUG. v1.2 put the scan button on the idle
        // screen only, and this screen returns before ever reaching it - so a worker on an
        // adopted tag could START a shift and then had no way on earth to END it. It
        // happened to the first real Android tester within minutes, and the shift had to be
        // closed by hand in the admin panel. A clock-in you cannot reverse is worse than no
        // clock-in at all.
        if (readiness != NfcReadiness.UNSUPPORTED) {
            OutlinedButton(
                onClick = { openIntent(Intent(context, ScanActivity::class.java)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.scan_open)) }
        }

        // A tap that cannot be delivered is worth saying even here - especially here,
        // because this is the screen the worker is on when they try to clock out.
        if (readiness != NfcReadiness.READY) {
            NfcBanner(readiness, openIntent)
        }

        // A shift tapped in a basement is EXACTLY the shift that is on this screen, so this
        // is the most important of the three places the pending card appears — not the
        // afterthought at the bottom of a list.
        PendingCard(pending, armed = pushArmed)

        notice?.let { (from, to) ->
            val unknown = stringResource(R.string.unknown_location)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        stringResource(R.string.switch_notice, from ?: unknown, to ?: unknown),
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                    TextButton(
                        onClick = onDismissNotice,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.dismiss)) }
                }
            }
        }

        // decision-10 may NEVER be hidden by the lock.
        if (unresolvedCount > 0) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        pluralStringResource(R.plurals.resolve_banner, unresolvedCount, unresolvedCount),
                        color = MaterialTheme.colorScheme.error,
                    )
                    Button(
                        onClick = onResolve,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.resolve_title)) }
                }
            }
        }

        // Said ONCE, as a sentence, never as a modal and never as a nag. A denied
        // permission is a weaker signal, not a broken app - the screen you are reading is
        // the floor and it is unaffected.
        if (silenced) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        stringResource(R.string.shift_notifications_off),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(
                        onClick = { openIntent(appNotificationSettings(context.packageName)) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.shift_notifications_settings)) }
                }
            }
        }

        // The escape that is not a gesture. Abmelden lives one tab away in Einstellungen
        // and the material tab is next to it; this says so out loud, because a worker who
        // believes they are stuck is the failure this screen is not allowed to cause.
        Text(
            stringResource(R.string.shift_help),
            style = MaterialTheme.typography.bodySmall,
            color = onContainer,
            textAlign = TextAlign.Center,
        )
    }
}

/** What the clock reads once the 8h boundary has passed. Not a running number. */
private const val OVERDUE_CLOCK = "8:00:00+"

/** H:MM:SS, ticked once a second by the caller. Locale-independent on purpose: these are
 *  digits, not prose, and Austria and every other locale read 3:07:22 the same way. */
private fun clock(start: Instant, now: Instant): String {
    val seconds = maxOf(0L, java.time.Duration.between(start, now).seconds)
    return String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
}

private fun appNotificationSettings(packageName: String): Intent =
    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

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
 * WHAT THIS PHONE IS STILL HOLDING (TASK-225). The whole reason this composable exists is
 * that the background push can fail for a hundred reasons that are nobody's fault, and the
 * only unacceptable outcome is that it fails SILENTLY: a queued tap that only exists in a
 * log is the same bug in a different place.
 *
 * Shown on the shift screen, on the log screen and on the SIGN-IN screen — that last one is
 * not decoration: signing out does not delete a queued row, and somebody handing a phone
 * back must not believe their hours went with it.
 *
 * Colour is the SECOND signal, never the first: the blocked line says "braucht Ihre
 * Verwaltung" in words and is additionally tinted, and everything else is ordinary text.
 *
 * @param armed whether the PLATFORM is currently holding the delivery job — asked of
 *        JobScheduler, never remembered by us. When it is false the card must NOT print
 *        „wird automatisch gesendet … auch wenn die App geschlossen ist", because on this
 *        phone, right now, that sentence is false: this app shipped once with the job
 *        silently refused for a missing permission, and a screen that keeps promising
 *        automatic delivery over a dead scheduler is worse than no screen at all.
 */
@Composable
private fun PendingCard(pending: PendingWork.Summary, signedOut: Boolean = false, armed: Boolean = true) {
    if (pending.isEmpty) return
    val spoken = pluralStringResource(R.plurals.a11y_pending, pending.total, pending.total)
    Card(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = spoken },
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                stringResource(R.string.pending_heading),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
            Text(pluralStringResource(R.plurals.pending_count, pending.total, pending.total))

            pending.oldestStart?.let {
                Text(
                    stringResource(R.string.pending_oldest, dateTime(it)),
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            // WHEN IT LAST TRIED, always, and "never tried" is a DIFFERENT sentence rather
            // than a blank timestamp: the two mean opposite things to somebody deciding
            // whether to walk upstairs for a signal.
            Text(
                pending.lastAttemptAt?.let { stringResource(R.string.pending_last_try, dateTime(it)) }
                    ?: stringResource(R.string.pending_never_tried),
                style = MaterialTheme.typography.bodySmall,
            )

            if (pending.blocked > 0) {
                Text(
                    pluralStringResource(R.plurals.pending_blocked, pending.blocked, pending.blocked),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            // THE PROMISE, AND ONLY WHEN IT IS TRUE. Three situations, three sentences,
            // and none of them may stand in for another:
            //   signed out  — the rows are kept and go out on the next sign-in
            //   not armed   — the platform is NOT holding a job, so nothing happens by
            //                 itself; opening the app is what sends them
            //   otherwise   — the ordinary case: it goes out on its own
            val notArmed = !signedOut && !armed && pending.waiting > 0
            Text(
                stringResource(
                    when {
                        signedOut -> R.string.pending_signed_out
                        notArmed -> R.string.pending_not_armed
                        else -> R.string.pending_body
                    },
                ),
                style = MaterialTheme.typography.bodySmall,
                // Colour SECOND: the sentence already says the delivery is not scheduled.
                // The tint only makes it findable on a busy screen.
                color = if (notArmed) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )

            // The ceiling, printed. A force-stopped app runs no jobs at all until a human
            // opens it; that is true of every scheduler on Android and it is not something
            // this screen is allowed to leave out just because it is inconvenient.
            Text(
                stringResource(R.string.pending_force_stop_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
            // "Wird gesendet …" was a lie for the case that matters: a row taken in a
            // basement is not being sent, it is WAITING, and the difference is the whole
            // of TASK-225. The last attempt rides on the same line so the worker can tell
            // "the phone is trying and failing" from "the phone has not had a signal since".
            else -> {
                Text(stringResource(R.string.sync_waiting), style = MaterialTheme.typography.bodySmall)
                Text(
                    shift.lastAttemptAt?.let { stringResource(R.string.sync_last_try, timeOfDay(it)) }
                        ?: stringResource(R.string.sync_never_tried),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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
    // How many there were when this opened, so the worker can see the queue shrink.
    // decision-10 point 3 asked for this and neither platform had it (parity row 15).
    val total = rememberSaveable { shifts.size }
    val shift = shifts.firstOrNull() ?: run { onClose(); return }
    val zone = ZoneId.systemDefault()
    val startLocal = shift.startTime.atZone(zone)
    val suggested = (shift.endTime ?: shift.startTime).atZone(zone)
    val picker = rememberTimePickerState(
        initialHour = suggested.hour,
        initialMinute = suggested.minute,
        is24Hour = true, // Austria writes 14:30, not 2:30 PM
    )
    // A DATE, not only a time of day (parity row 14). The old dialog anchored the pick to
    // the shift's start date and rolled forward one day when the time was earlier, which
    // made any finish more than one calendar day after the start UNREPRESENTABLE - and
    // silently, because the roll looked like it had worked. The roll survives as the
    // SUGGESTION; the worker can now overrule it. iOS has always had date + time here.
    val datePicker = rememberDatePickerState(
        initialSelectedDateMillis = suggested.toLocalDate()
            .atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
    )
    var showDatePicker by rememberSaveable { mutableStateOf(false) }
    var errorKey by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    // The date the pickers currently agree on, as an Instant. UTC midnight in, local date
    // out: DatePicker hands back UTC-midnight millis, and reading them in a local zone
    // east of Greenwich lands on the previous day.
    fun chosenEnd(): Instant {
        val date = datePicker.selectedDateMillis
            ?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
            ?: LocalDate.from(startLocal)
        return date.atTime(LocalTime.of(picker.hour, picker.minute)).atZone(zone).toInstant()
    }

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
                if (total > 1) {
                    Text(
                        stringResource(R.string.resolve_progress, total - shifts.size + 1, total),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(stringResource(R.string.resolve_intro))
                Text(shift.locationName ?: stringResource(R.string.unknown_location))
                Text("${stringResource(R.string.resolve_started)}: ${dateTime(shift.startTime)}")
                Text(stringResource(R.string.resolve_finished))
                OutlinedButton(
                    onClick = { showDatePicker = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.resolve_date, dateOnly(chosenEnd()))) }
                TimePicker(state = picker)
                // The result, in words, before anything is sent. A picker that quietly
                // means something other than what it shows is how a night shift ends up
                // filed on the wrong day.
                Text(
                    stringResource(R.string.resolve_end_preview, dateTime(chosenEnd())),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )

                if (showDatePicker) {
                    Dialog(onDismissRequest = { showDatePicker = false }) {
                        Surface(shape = MaterialTheme.shapes.large) {
                            Column(
                                Modifier
                                    .verticalScroll(rememberScrollState())
                                    .padding(8.dp),
                            ) {
                                DatePicker(state = datePicker)
                                TextButton(
                                    onClick = { showDatePicker = false },
                                    modifier = Modifier
                                        .align(Alignment.End)
                                        .heightIn(min = 48.dp),
                                ) { Text(stringResource(R.string.resolve_date_done)) }
                            }
                        }
                    }
                }

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
                        model.resolve(shift, chosenEnd()) { key ->
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
private fun SettingsScreen(model: TimeSheetViewModel, openIntent: (Intent) -> Unit) {
    val worker = (model.session.collectAsStateWithLifecycle().value as? SessionState.SignedIn)?.worker
    val shiftRunning = model.log.collectAsStateWithLifecycle().value.open != null
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

        HorizontalDivider()
        PushSection(model)

        HorizontalDivider()
        UpdateSection(model, shiftRunning, openIntent)
    }
}

/**
 * IS THE BACKGROUND PUSH ACTUALLY ARMED (TASK-225)? Asked of the platform, printed here.
 *
 * Not for the cleaner — the cleaner gets [PendingCard], which says what is waiting and
 * what will happen to it. This is for whoever sets the phone up, and it exists because
 * this app deliberately writes no log at all: without these two lines the only way to
 * learn that `JobScheduler.schedule()` is being refused on a particular handset is a cable
 * and a computer. It shipped refused once, for a missing `ACCESS_NETWORK_STATE`, and
 * nothing anywhere could say so.
 *
 * `lastArmed` is in memory, so it is empty after a cold start until something arms the
 * job. That is correct and is why the STATE line is read from JobScheduler and only the
 * REASON comes from our own record.
 *
 * THREE STATES, NOT TWO, and the third one is why this was wrong. The app arms a job only
 * while there is something to deliver, so a healthy idle phone holds no job — and the two
 * -state version printed „NICHT EINGEPLANT. Wartende Schichten gehen erst hinaus, wenn Sie
 * die App öffnen" over it, in the error colour, describing waiting shifts that do not
 * exist. An alarm that is on whenever nothing is wrong is how the real one gets ignored.
 */
@Composable
private fun PushSection(model: TimeSheetViewModel) {
    val state = model.log.collectAsStateWithLifecycle().value
    val armed = state.pushArmed
    // The queue, not the clock: „not scheduled" is only a fault when there is a row that
    // scheduling would have moved. Same predicate the ViewModel arms on, deliberately.
    val waiting = state.pending.waiting > 0
    val refusal = SyncScheduler.lastArmed?.first as? SyncScheduler.Armed.Refused
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.settings_push_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        val faulted = waiting && !armed
        Text(
            stringResource(
                when {
                    !waiting -> R.string.settings_push_idle
                    armed -> R.string.settings_push_armed
                    else -> R.string.settings_push_not_armed
                },
            ),
            style = MaterialTheme.typography.bodyMedium,
            // Colour SECOND: „Nicht eingeplant" is already the first two words.
            color = if (faulted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // Only when there IS one, and only the platform's own words. Never a worker name,
        // never a code, never a cookie — see SyncScheduler.Armed.Refused.
        //
        // SHOWN EVEN WHEN THE QUEUE IS NOW EMPTY, on purpose. A refusal that happened while
        // a row was waiting is the single fact this screen exists to surface; hiding it the
        // moment the row drains would erase the evidence of the handset problem exactly
        // when somebody has finally gone looking for it.
        refusal?.let {
            Text(
                stringResource(R.string.settings_push_reason, it.why),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// -------------------------------------------------------------------------------------
// Self-update (this iteration). Lives ONLY here — Settings, worker-initiated, never on
// the tap or clock-out path. See update/UpdateManager.kt's own header for the whole
// design; this composable is purely a rendering of [model.update].
// -------------------------------------------------------------------------------------
@Composable
private fun UpdateSection(model: TimeSheetViewModel, shiftRunning: Boolean, openIntent: (Intent) -> Unit) {
    val state by model.update.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // Checked once when Settings first appears and nothing has asked yet — covers the
    // rare case where the silent launch-time check (TimeSheetViewModel.restoreSession)
    // has not landed by the time the worker opens this tab.
    LaunchedEffect(Unit) {
        if (state is UpdateState.Idle) model.checkForUpdate()
    }

    // A RESULT CALLBACK, not the fire-and-forget openIntent used everywhere else in this
    // file: this is the ONE navigation in the app whose OUTCOME the screen needs to read
    // back (see TimeSheetViewModel.onReturnedFromInstallAttempt for why that is possible
    // at all, and what it does and does not prove).
    val installLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { model.onReturnedFromInstallAttempt() }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.update_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            stringResource(R.string.update_current_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        when (val s = state) {
            UpdateState.Idle, UpdateState.Checking ->
                Text(stringResource(R.string.update_checking))

            UpdateState.UpToDate -> {
                Text(stringResource(R.string.update_up_to_date))
                OutlinedButton(
                    onClick = model::checkForUpdate,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.update_check_button)) }
            }

            is UpdateState.Available -> {
                Text(
                    stringResource(
                        R.string.update_available,
                        s.release.versionName ?: stringResource(R.string.update_unknown_version),
                    ),
                )
                Button(
                    onClick = { model.startUpdateDownload(s.release) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.update_download_button)) }
            }

            is UpdateState.Downloading -> Text(
                when {
                    s.waitingForNetwork -> stringResource(R.string.update_waiting_network)
                    s.percent != null -> stringResource(R.string.update_downloading, s.percent)
                    else -> stringResource(R.string.update_downloading_unknown)
                },
            )

            is UpdateState.ReadyToInstall -> {
                Text(stringResource(R.string.update_ready))
                // NEVER an interruption: a running shift is stated as unaffected, never
                // gated on or blocked by any of this.
                if (shiftRunning) {
                    Text(
                        stringResource(R.string.update_running_shift_note),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                when (UpdateReadiness.of(context)) {
                    UpdateReadiness.ALLOWED -> Button(
                        onClick = { installLauncher.launch(model.installIntentFor(s.uri)) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.update_install_button)) }

                    UpdateReadiness.BLOCKED -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            stringResource(R.string.update_install_blocked_note),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        OutlinedButton(
                            onClick = { openIntent(UpdateReadiness.settingsIntent(context)) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.update_install_blocked_button)) }
                    }
                }
            }

            is UpdateState.Failed -> {
                Text(
                    stringResource(stringIdFor(s.reasonKey)),
                    color = MaterialTheme.colorScheme.error,
                )
                OutlinedButton(
                    onClick = {
                        val release = s.release
                        if (release != null) model.startUpdateDownload(release) else model.checkForUpdate()
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.update_retry_button)) }
            }
        }
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

private val dateFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault())

private val timeFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private fun dateTime(instant: Instant): String = dateTimeFormat.format(instant)

private fun dateOnly(instant: Instant): String = dateFormat.format(instant)

private fun timeOfDay(instant: Instant): String = timeFormat.format(instant)

private fun hours(seconds: Long): String = String.format(Locale.getDefault(), "%.1f", seconds / 3600.0)
