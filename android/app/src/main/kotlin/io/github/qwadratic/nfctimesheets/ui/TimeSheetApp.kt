package io.github.qwadratic.nfctimesheets.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
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
import io.github.qwadratic.nfctimesheets.core.ApiFailure
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
import io.github.qwadratic.nfctimesheets.nfc.VerifyZoneActivity
import io.github.qwadratic.nfctimesheets.nfc.WriteTagActivity
import io.github.qwadratic.nfctimesheets.sync.SyncScheduler
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
                is SessionState.SignedOut -> SignInScreen(model, state.reasonKey, openIntent)
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
private fun SignInScreen(model: TimeSheetViewModel, reasonKey: String?, openIntent: (Intent) -> Unit) {
    // Signing out does NOT delete a queued shift — it belongs to the worker who logged it
    // and goes out when that worker signs back in. So the count has to be on THIS screen,
    // or somebody hands the phone back believing their hours went with it (TASK-225).
    val pending by model.log.collectAsStateWithLifecycle()
    val busy by model.signingIn.collectAsStateWithLifecycle()
    val smsBusy by model.smsBusy.collectAsStateWithLifecycle()
    val smsAvailable by model.smsAvailable.collectAsStateWithLifecycle()

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

        // AC4 (TASK-262): a genuine session expiry used to bounce here with an empty code
        // field and no explanation -- the field's own refusal line only renders after a
        // submit from THIS screen fails (CodeSignInSection gates it on `typed == attempted`,
        // which is where that rule now lives), so a reason set by dropToSignedOut() was
        // silently dropped on the very first composition, where typed="" and attempted=null
        // can never equal a real reasonKey. "err_no_session" is CLIENT-SYNTHESIZED --
        // unique to dropToSignedOut(), never echoed by the server (auth failures answer
        // "unauthorized"; /auth/code answers "invalid_code") -- so it is safe to special-case
        // on this exact key. Deliberately NOT gated by `typed == attempted`: it stops
        // rendering the instant reasonKey changes to anything else, e.g. a later failed
        // submit, which the existing gated errorKey path below already renders correctly.
        if (reasonKey == "err_no_session") {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text(
                        stringResource(R.string.err_no_session),
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                }
            }
        }

        Text(stringResource(R.string.signin_code_intro), style = MaterialTheme.typography.bodyLarge)

        PendingCard(pending.pending, signedOut = true, armed = pending.pushArmed)

        // ONE FORM, the worker's instance of it (decision-54 §5). Everything role-specific
        // is a lambda: this screen posts to /auth/code and /auth/sms/*, the operator gate
        // below posts to the /auth/operator-* twins, and neither knows the other exists.
        CodeSignInSection(
            smsAvailable = smsAvailable,
            busy = busy || smsBusy,
            // The refusal [signIn] parked on the session flow. The form decides WHEN to
            // show it (only while the field still holds the string it was about) — that
            // rule used to live here and moved in with the field it belongs to.
            refusal = reasonKey?.let { stringResource(stringIdFor(it)) },
            onSubmitCode = { typed -> model.signIn(typed) },
            onRequestSms = model::requestSmsCode,
            onVerifySms = model::verifySmsCode,
        )

        // TASK-267: everything below the button used to render unconditionally, turning
        // the first screen a new hire sees into a document. NOTHING TRUE IS DELETED --
        // signin_code_help and nfc_first_run_note both still exist verbatim, just behind
        // one disclosure instead of printed automatically.
        RevealSection(label = {
            Text(stringResource(R.string.signin_more_info), style = MaterialTheme.typography.bodyMedium)
        }) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    stringResource(R.string.signin_code_help),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // Trap 2. Nothing in the app can fix a stopped-state install from inside
                // the app, so the only useful thing is to tell the person holding the phone.
                Text(
                    stringResource(R.string.nfc_first_run_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // BEFORE any worker session exists (TASK-252's Android half - the shape iOS's
        // SettingsView bug had: a phone that is an operator's and NOTHING ELSE had no way
        // into WriteTagActivity/VerifyZoneActivity at all, because both buttons used to
        // live only on the WORKER'S post-sign-in log screen). This whole block composes
        // unconditionally on SignInScreen -- reached from SessionState.SignedOut with no
        // worker session required (TASK-267 AC4) -- and the reveal below is local Compose
        // state only, so collapsing it by default touches no auth gate.
        HorizontalDivider(Modifier.padding(top = 8.dp))
        RevealSection(label = {
            Text(
                stringResource(R.string.signin_operator_heading),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }) {
            OperatorSection(model, openIntent)
        }
    }
}

// -------------------------------------------------------------------------------------
// THE OPERATOR GATE (decision-54 §4). The two links used to open WriteTagActivity and
// VerifyZoneActivity with no login at all: each screen gated the ACTION (write, verify)
// behind an inline operator-code field of its own, but never gated BEING in the screen.
// The owner reversed that in as many words -- "don't reveal the screen at all" -- so the
// door is here now, once, and both activities were relieved of their duplicate fields.
//
// A COOKIE READ, NOT A REQUEST. `operatorReady` is the stored `ts_operator` session read
// off disk, re-read on every resume of this screen: an operator whose phone has no signal
// in a stairwell walks straight through, and one whose session died inside WriteTagActivity
// comes back to the form instead of to a button that cannot work.
// -------------------------------------------------------------------------------------
@Composable
private fun OperatorSection(model: TimeSheetViewModel, openIntent: (Intent) -> Unit) {
    val context = LocalContext.current
    val ready by model.operatorReady.collectAsStateWithLifecycle()
    val busy by model.operatorBusy.collectAsStateWithLifecycle()
    val smsAvailable by model.smsAvailable.collectAsStateWithLifecycle()
    // The refusal of the operator's OWN code, kept here and not in the ViewModel: it
    // belongs to a field on this screen and to nothing else.
    var refusal by rememberSaveable { mutableStateOf<ApiFailure?>(null) }

    // Every resume, not once: see the header. onPauseOrDispose does nothing -- there is
    // no listener to unregister, the read is a SharedPreferences field.
    LifecycleResumeEffect(Unit) {
        model.refreshOperatorReady()
        onPauseOrDispose { }
    }

    if (!ready) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                stringResource(R.string.signin_operator_gate_intro),
                style = MaterialTheme.typography.bodyMedium,
            )
            // THE SAME FORM the worker uses, six lines up -- not a lookalike. Only the
            // three lambdas differ, and each one names an /auth/operator-* route.
            CodeSignInSection(
                smsAvailable = smsAvailable,
                busy = busy,
                refusal = refusal?.let { operatorRefusalText(it) },
                onSubmitCode = { typed -> model.signInOperator(typed) { refusal = it } },
                onRequestSms = model::requestOperatorSmsCode,
                onVerifySms = model::verifyOperatorSmsCode,
            )
        }
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        OutlinedButton(
            onClick = { openIntent(Intent(context, WriteTagActivity::class.java)) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.write_open)) }
        OutlinedButton(
            onClick = { openIntent(Intent(context, VerifyZoneActivity::class.java)) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.verify_open)) }
    }
}

/**
 * An operator's refused ENROLMENT CODE, in words. decision-26's "no reason is ever given"
 * holds for the operator code exactly as it does for the worker's, so every 4xx collapses
 * into the same sentence; only "no connection" is separate, because that one is not about
 * the code at all. The SMS half of the same form maps its own failures through
 * [smsErrorText] — those ARE distinguishable server-side and always were.
 */
@Composable
private fun operatorRefusalText(failure: ApiFailure): String =
    if (failure.status == 0) {
        stringResource(R.string.err_signin_offline)
    } else {
        stringResource(R.string.err_invalid_code)
    }

/**
 * A ONE-WAY reveal (TASK-267), never a re-collapsing accordion: [CodeSignInSection] holds
 * its own rememberSaveable phone/code/sentTo state, and a toggle that could go back to
 * collapsed would risk silently discarding a mid-flow OTP entry. No acceptance criterion
 * here asks for a collapse-back control, so the smallest safe shape is the right one --
 * there is no existing disclosure component anywhere in this codebase to reuse instead.
 */
@Composable
private fun RevealSection(label: @Composable () -> Unit, content: @Composable () -> Unit) {
    var revealed by rememberSaveable { mutableStateOf(false) }
    if (revealed) {
        content()
    } else {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable(role = Role.Button) { revealed = true },
            contentAlignment = Alignment.CenterStart,
        ) { label() }
    }
}

// -------------------------------------------------------------------------------------
// THE ONE CODE-ENTRY FORM (decision-54 §5). Phone field + „SMS senden" + ONE code field +
// ONE submit button, used by the worker's sign-in screen AND by the operator gate above.
//
// TWO CREDENTIALS, ONE FIELD, AND THE FIELD DOES NOT ASK WHICH. A live SMS challenge
// (`sentTo != null`) makes it a 6-digit OTP field; otherwise it is the 8-character
// Crockford enrolment code. That is a LAYOUT unification and nothing more: the two remain
// genuinely different credentials with two different security arguments on the server
// (lib/enrolment.js's and lib/sms.js's arithmetic blocks are untouched), and every refusal
// keeps the sentence it always had — decision-26's "no reason is ever given" for the
// enrolment code, smsErrorText's five named cases for the SMS flow.
//
// WHAT IS PARAMETERISED IS THE ROLE, AND ONLY AS LAMBDAS. This composable names no route,
// no cookie jar and no ViewModel method: the worker's caller wires /auth/code and
// /auth/sms/*, the operator's wires the /auth/operator-* twins, and neither can reach the
// other's — the same wiring-not-a-rule discipline VerifyZoneActivity's header describes.
//
// THE SMS HALF STILL COMPOSES ONLY BEHIND THE SERVER'S OWN ANSWER (decision-48 §6.6): a
// build whose capability read is false, still pending, or failed offline draws no phone
// field and no send button at all — not a disabled one, not a greyed one. The code field
// below is complete and correct with or without it, which is why the flag is the SMS
// half's own condition and never the form's.
// -------------------------------------------------------------------------------------
@Composable
private fun CodeSignInSection(
    smsAvailable: Boolean,
    busy: Boolean,
    refusal: String?,
    onSubmitCode: (String) -> Unit,
    onRequestSms: (String, (ApiFailure?) -> Unit) -> Unit,
    onVerifySms: (String, String, (ApiFailure?) -> Unit) -> Unit,
) {
    // rememberSaveable: a rotation, or Android tearing the activity down behind a
    // notification, must not eat the characters already typed. Deliberately NOT in the
    // ViewModel and NOT on disk -- a bearer credential does not get persisted by us.
    var typed by rememberSaveable { mutableStateOf("") }
    // What was in the field when the last refusal came back. The message belongs to THAT
    // string, so it disappears the moment they start correcting it — a field that stays
    // red while you retype tells you nothing and looks broken.
    var attempted by rememberSaveable { mutableStateOf<String?>(null) }
    var phone by rememberSaveable { mutableStateOf("") }
    // Non-null once a request has been ACCEPTED for this exact string. Clearing it (typing
    // a different number, or pressing "change number") is the only way back to phone entry,
    // so the code field can never be an OTP field next to a number nothing was sent to.
    var sentTo by rememberSaveable { mutableStateOf<String?>(null) }
    var phoneFailure by rememberSaveable { mutableStateOf<ApiFailure?>(null) }
    var codeFailure by rememberSaveable { mutableStateOf<ApiFailure?>(null) }

    val target = sentTo
    val otpMode = target != null
    // The caller's refusal, shown only while the field still holds the string it was about.
    val enrolRefusal = refusal?.takeIf { typed == attempted }
    val codeError = codeFailure?.let { smsErrorText(it) } ?: enrolRefusal

    val submit = {
        if (!busy && typed.isNotBlank()) {
            if (target != null) {
                if (typed.length == OTP_LENGTH) {
                    onVerifySms(target, typed) { failure -> if (failure != null) codeFailure = failure }
                }
            } else {
                attempted = typed
                onSubmitCode(typed)
            }
        }
    }

    if (smsAvailable) {
        // Its own self-describing question, so the phone field is discoverable without
        // prior knowledge. Composed HERE and not by the caller: it belongs to the SMS half,
        // which is the half that may be absent.
        Text(stringResource(R.string.signin_sms_intro), style = MaterialTheme.typography.bodyMedium)
        val send = {
            if (!busy && phone.isNotBlank()) {
                onRequestSms(phone) { failure ->
                    if (failure == null) {
                        sentTo = phone
                        // The field changes meaning under the cursor, so whatever is in it
                        // is now the wrong shape. Cleared rather than filtered down to its
                        // digits: a half-typed enrolment code truncated to six characters
                        // would look like an OTP somebody typed.
                        typed = ""
                        attempted = null
                        phoneFailure = null
                    } else {
                        phoneFailure = failure
                    }
                }
            }
        }
        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it; phoneFailure = null },
            singleLine = true,
            isError = phoneFailure != null,
            enabled = !otpMode,
            label = { Text(stringResource(R.string.signin_sms_phone_label)) },
            // ONE message, in words, associated with the field for TalkBack, colour never
            // the only signal — the same rule the code field below follows.
            supportingText = {
                val failure = phoneFailure
                if (failure != null) {
                    Text(smsErrorText(failure), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                } else {
                    Text(stringResource(R.string.signin_sms_phone_hint))
                }
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { send() }),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp),
        )
        if (target == null) {
            OutlinedButton(
                onClick = send,
                enabled = !busy && phone.isNotBlank(),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                Text(stringResource(if (busy) R.string.signin_sms_sending else R.string.signin_sms_send))
            }
        } else {
            Text(
                stringResource(R.string.signin_sms_code_intro, target),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }

    OutlinedTextField(
        value = typed,
        // TWO FILTERS, ONE FIELD, decided by which credential is live. In OTP mode: digits
        // only, capped at 6 — an OTP has no alphabet to alias (decision-48 §6: copied off a
        // notification, never spoken aloud). Otherwise: capped at the same length the server
        // will even look at and accepted exactly as typed, because EnrolmentCode.normalise()
        // sorts out case, spaces and hyphens on submit and rewriting the text under the
        // cursor is how input fields fight their user.
        onValueChange = {
            typed = if (otpMode) it.filter(Char::isDigit).take(OTP_LENGTH) else it.take(EnrolmentCode.MAX_INPUT)
            codeFailure = null
        },
        singleLine = true,
        isError = codeError != null,
        label = {
            Text(stringResource(if (otpMode) R.string.signin_sms_code_label else R.string.signin_code_label))
        },
        // ONE message for every refusal of the enrolment code. Unknown, malformed, expired,
        // already used, revoked, worker deactivated -- the server makes all six
        // byte-identical on purpose (decision-26) and this form must not invent a
        // distinction it does not have. Only "no connection" is separate, because that one
        // is not about the code at all.
        //
        // It goes IN the supporting text, not next to the field: that is what associates it
        // with the input for TalkBack, so "Anmeldecode, ungültig" is followed by what to do
        // about it instead of by silence. Assertive because the person is looking at the
        // keyboard, not at the field.
        supportingText = {
            if (codeError != null) {
                Text(codeError, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
            } else {
                Text(stringResource(if (otpMode) R.string.signin_sms_code_hint else R.string.signin_code_hint))
            }
        },
        keyboardOptions = if (otpMode) {
            KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go)
        } else {
            KeyboardOptions(
                // Upper case because that is how the code was written down and read out,
                // so what is on screen matches what is on the admin's screen. It is only
                // cosmetic -- normalise() folds case anyway, so the shift key cannot cost
                // anyone an attempt.
                capitalization = KeyboardCapitalization.Characters,
                // The one thing that MUST be off. Autocorrect on an 8-character non-word
                // will happily replace it with a German noun mid-typing, and the worker
                // would have no idea why a correct code keeps failing.
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Go,
            )
        },
        keyboardActions = KeyboardActions(onGo = { submit() }),
        // Plain text, NOT a password field: the whole point is that they can check what
        // they typed against what was said to them, or against the SMS still on screen.
        //
        // SMS AUTOFILL, and ONLY in OTP mode (decision-54 §6): the platform offers the code
        // straight out of the notification. The enrolment code must never carry this hint —
        // it does not arrive by SMS, and an autofill prompt over it would offer a stale OTP
        // for a field that is not one. ContentType.SmsOtpCode is stable in the pinned
        // Compose UI (androidx.compose.ui.autofill), so the SMS User Consent API — a Play
        // Services dependency, a BroadcastReceiver and an app-hash in the message — is not
        // needed and is not added.
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(
                if (otpMode) Modifier.semantics { contentType = ContentType.SmsOtpCode } else Modifier,
            ),
    )

    Button(
        onClick = submit,
        enabled = !busy && if (otpMode) typed.length == OTP_LENGTH else typed.isNotBlank(),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp), // touch target floor
    ) {
        Text(
            stringResource(
                when {
                    otpMode && busy -> R.string.signin_sms_verifying
                    otpMode -> R.string.signin_sms_verify
                    busy -> R.string.signin_submitting
                    else -> R.string.signin_submit
                },
            ),
        )
    }

    if (otpMode) {
        TextButton(
            onClick = { sentTo = null; typed = ""; attempted = null; codeFailure = null },
            enabled = !busy,
        ) {
            Text(stringResource(R.string.signin_sms_change_number))
        }
    }
}

/** Digits in an OTP (server/lib/sms.js). The enrolment code's own length is EnrolmentCode.LENGTH. */
private const val OTP_LENGTH = 6

/**
 * Every ApiFailure [requestSmsCode]/[verifySmsCode][TimeSheetViewModel] can produce, mapped
 * to a sentence that is honest about THIS flow — never a raw code, and never the code
 * field's own copy, which names an admin-ISSUED credential this screen does not use.
 *
 * `invalid_code` and `invalid_phone` deliberately do NOT go through [stringIdFor]/
 * [ApiFailure.messageKey]: that shared mapper answers the SAME server code for the
 * enrolment-code field's own wrong-code case with "ask your admin for a new one", which is
 * wrong advice here — an OTP is requested again by the WORKER, not reissued by an admin.
 * `too_many_attempts` and a transport failure ARE the same words in both flows, so those
 * two reuse the shared resources directly rather than forking a duplicate string.
 */
@Composable
private fun smsErrorText(failure: ApiFailure): String = when {
    failure.status == 0 -> stringResource(R.string.err_signin_offline)
    failure.code == "sms_not_configured" -> stringResource(R.string.sms_not_configured_note)
    failure.code == "invalid_phone" -> stringResource(R.string.sms_invalid_phone)
    failure.code == "invalid_code" -> stringResource(R.string.sms_invalid_code)
    // decision-51. The number is real input, not a rejected shape, so it gets its own
    // sentence rather than falling into the generic err_rejected bucket — and it must
    // never say what invalid_code says: nobody re-issues this, the worker's admin has to
    // add the number first.
    failure.code == "unknown_phone" -> stringResource(R.string.sms_unknown_phone)
    failure.code == "too_many_attempts" -> stringResource(R.string.err_too_many_attempts)
    else -> stringResource(stringIdFor(failure.messageKey))
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
    // decision-57 §3. Default FALSE, and FALSE is today's screen exactly.
    val funTheme by model.funShiftScreen.collectAsStateWithLifecycle()
    var showResolver by remember { mutableStateOf(false) }
    // decision-56's two dialogs. Both start closed and both are one confirmation away from
    // the call: neither action may be a single accidental tap (decision-56 §4).
    var showManualStart by remember { mutableStateOf(false) }
    var showManualStop by remember { mutableStateOf(false) }

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
            unresolved = log.unresolved,
            onResolve = { showResolver = true },
            notice = log.switchNotice,
            onDismissNotice = model::dismissSwitchNotice,
            pending = log.pending,
            pushArmed = log.pushArmed,
            readiness = readiness,
            openIntent = openIntent,
            onStop = { showManualStop = true },
            funTheme = funTheme,
        )
        if (showResolver) {
            ResolveDialog(model, log.unresolved) { showResolver = false }
        }
        if (showManualStop) {
            ManualStopDialog(
                model = model,
                locationName = model.siteName(open.locationId),
            ) { showManualStop = false }
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
            // WRITE A TAG / THE TEST SCAN (decision-45, decision-47), and since decision-54
            // §4 behind the operator gate rather than loose on the screen: a signed-in WORKER
            // is not an operator, and the two links used to be reachable by anyone who got
            // this far. Same [OperatorSection] as the sign-in screen — not a lookalike — so
            // there is exactly one place in the app that launches either activity, and a
            // cleaner holding a phone to a wall is never one mis-tap away from a screen that
            // OVERWRITES the tag they are standing at. Nothing behind either button can open
            // or close a shift — android/checks/verify-no-shift-check.sh pins that.
            item { OperatorSection(model, openIntent) }
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
                                dateOnly(log.unresolved.minBy { it.startTime }.startTime),
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

        // START WITHOUT A TAG (decision-56). A TextButton, under the scan button and above
        // everything else: deliberately the quietest control on the screen, because the
        // product is still the tap and this is the fallback for a broken or missing card.
        // Shown on EVERY phone, including one with no NFC chip at all — that phone is
        // exactly the one that cannot scan and previously could not clock in.
        item {
            TextButton(
                onClick = { showManualStart = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.manual_start_open)) }
        }

        item { SectionHeading(R.string.log_recent_section) }
        if (log.recent.isEmpty()) {
            item { Text(stringResource(R.string.log_recent_empty), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(log.recent, key = { it.clientUuid }) { ShiftRow(it, model.siteName(it.locationId)) }

        item {
            // Clocking in happens by holding the phone to the tag: Android reads it and
            // opens the App Link. This used to say there was no in-app path to a shift and
            // that there must not be one — SUPERSEDED BY decision-56 for exactly two
            // actions, „Ohne Tag starten" above and Stop on the running screen.
            //
            // THE ORIGINAL REASONING IS WHY THE FLAGS EXIST, not something the decision
            // threw away: a second, SILENT path to the same row is how two mechanisms start
            // disagreeing about somebody's hours. So neither manual action is silent —
            // each is confirmed by the worker, validated by the server exactly as a tap is
            // (a manual start only succeeds where a tap would), and stamped manual_start /
            // manual_close on the row for ever, where the office can see it. Flagged, not
            // hidden. Everything else still has to be a tap.
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
    if (showManualStart) {
        ManualStartDialog(model) { showManualStart = false }
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
    unresolved: List<WireShift>,
    onResolve: () -> Unit,
    notice: Pair<String?, String?>?,
    onDismissNotice: () -> Unit,
    /** What this phone is still holding (TASK-225). Usually zero; never hidden when not. */
    pending: PendingWork.Summary,
    /** Whether the platform is holding the delivery job. See [PendingCard]. */
    pushArmed: Boolean,
    readiness: NfcReadiness,
    openIntent: (Intent) -> Unit,
    /** decision-56's Stop button. Opens the confirmation dialog; never closes anything. */
    onStop: () -> Unit,
    /**
     * decision-57 §3's `fun_shift_screen`, server-side, OFF by default. FALSE is
     * bit-for-bit this screen as it was before the flag existed — every colour below still
     * comes from [MaterialTheme] and nothing extra is composed.
     */
    funTheme: Boolean = false,
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
    // directly under the clock.
    //
    // decision-60 §2: the RUNNING field is now a FIXED literal from ui/Theme.kt's
    // ShiftBrand — a dark blue, the same on every phone, with or without the flag. It is
    // deliberately NOT a MaterialTheme role and NOT derived from isSystemInDarkTheme():
    // this screen has been repainted by somebody else's palette twice (Material You off
    // the wallpaper, then Material's baseline purple through an unassigned role), and a
    // constant is what makes that impossible. Which colour the constant is was never the
    // part that mattered.
    //
    // OVERDUE IS UNTOUCHED by decision-60 — it keeps the error pair, because that is the
    // one state that must never read as "fine", and it stays a colour AND a word. With
    // `fun_shift_screen` ON the field is the animated gradient's base and overdue keeps a
    // red ON-colour over it, exactly as it did over the old black.
    val container = when {
        overdue && !funTheme -> MaterialTheme.colorScheme.errorContainer
        else -> ShiftBrand.Container
    }
    val onContainer = when {
        overdue -> if (funTheme) FunShift.Overdue else MaterialTheme.colorScheme.onErrorContainer
        else -> ShiftBrand.OnContainer
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

    // The animation is a SIBLING drawn first, never a background of the content: it has to
    // sit behind the words without being able to scroll, resize or clip them. Flag OFF, the
    // Box holds exactly one child and the tree is what it always was.
    Box(Modifier.fillMaxSize().background(container)) {
    if (funTheme) FunShiftBackdrop()
    Column(
        modifier = Modifier
            .fillMaxSize()
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

        // STOP (decision-56). Next to the clock, because this is the screen a worker is on
        // when their card will not read and the shift has to end anyway.
        //
        // There WAS no button that closed a shift here, and this comment said there must not
        // be one: clocking out is a tag tap, and a second path to the same row is how two
        // mechanisms start disagreeing about somebody's hours. decision-56 supersedes that
        // for this one action and keeps the reasoning — the disagreement is prevented by
        // making the manual close impossible to confuse with a tap-out rather than by
        // forbidding it: it is confirmed in a dialog that names the building and says the
        // office will see it, and the server stamps manual_close (plus corrected_at, so the
        // worker is never asked again about a time they just confirmed). Flagged, not silent.
        //
        // OutlinedButton, not a filled one: the tap is still the way to finish, and the line
        // under it still says so.
        //
        // ITS BORDER AND ITS LABEL ARE NAMED HERE, and that is a BUG FIX, not styling (the
        // 2026-08-29 cross-platform UX audit's B1). Material resolves an OutlinedButton's
        // border and content from the colour scheme, which is chosen against the app's own
        // surfaces — not against this screen's overridden `container`. On the field above
        // the border came out invisible and the label low-contrast, so the ONE control a
        // worker reaches for when their card will not read looked disabled. Both are now
        // ShiftBrand values computed against ShiftBrand.Container (8.6:1 and 13.2:1), and
        // against FunShift.Lift, the lightest the flag-ON animation ever gets (4.6:1).
        OutlinedButton(
            onClick = onStop,
            border = BorderStroke(1.dp, ShiftBrand.Outline),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = ShiftBrand.OnContainer),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.manual_stop_open)) }

        // The single obvious way to end the shift, and still the first thing offered.
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
            // Same border/content override, same reason, as the Stop button above: this
            // one sits on the same overridden field and had the same invisible border.
            OutlinedButton(
                onClick = { openIntent(Intent(context, ScanActivity::class.java)) },
                border = BorderStroke(1.dp, ShiftBrand.Outline),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = ShiftBrand.OnContainer),
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
        if (unresolved.isNotEmpty()) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        pluralStringResource(
                            R.plurals.resolve_banner,
                            unresolved.size,
                            unresolved.size,
                            dateOnly(unresolved.minBy { it.startTime }.startTime),
                        ),
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
}

/** What the clock reads once the 8h boundary has passed. Not a running number. */
private const val OVERDUE_CLOCK = "8:00:00+"

/** H:MM:SS, ticked once a second by the caller. Locale-independent on purpose: these are
 *  digits, not prose, and Austria and every other locale read 3:07:22 the same way. */
private fun clock(start: Instant, now: Instant): String {
    val seconds = maxOf(0L, java.time.Duration.between(start, now).seconds)
    return String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
}

// -------------------------------------------------------------------------------------
// decision-56: THE TWO MANUAL DIALOGS.
//
// Neither of them decides anything. Every refusal on screen is the SERVER's, resolved
// through the same [stringIdFor] key the tap path resolves — an unbound zone, an unverified
// place and a shift already open read here exactly as they read after a tap, because they
// ARE the same answer to the same route (decision-56 §2: validation is unchanged).
// -------------------------------------------------------------------------------------

/**
 * „Ohne Tag starten". Pick a building, confirm, POST /shifts/open with manual=true.
 *
 * The list is the ALREADY-CACHED roster (no fetch, no new endpoint). An empty list means
 * this phone has never completed a refresh; it says so rather than offering nothing.
 */
@Composable
private fun ManualStartDialog(model: TimeSheetViewModel, onClose: () -> Unit) {
    val buildings = model.buildings()
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var errorKey by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun start(simulation: ManualSimulation? = null) {
        val id = selectedId ?: return
        busy = true
        errorKey = null
        model.manualOpen(id, simulation) { failure ->
            busy = false
            if (failure == null) onClose() else errorKey = failure.messageKey
        }
    }

    Dialog(onDismissRequest = { if (!busy) onClose() }) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.manual_start_title),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() },
                )
                Text(stringResource(R.string.manual_start_intro))
                if (buildings.isEmpty()) {
                    Text(
                        stringResource(R.string.manual_start_no_buildings),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                for ((id, name) in buildings) {
                    OutlinedButton(
                        onClick = { selectedId = id },
                        enabled = !busy,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    ) {
                        // Marked in the LABEL, same as ui/BuildingPicker: a column of
                        // buttons with one control that looks different reads as doing
                        // something different.
                        Text(if (selectedId == id) "\u2713 $name" else name)
                    }
                }

                errorKey?.let {
                    Text(
                        stringResource(stringIdFor(it)),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                }

                // THE CONFIRMATION. Disabled until a building is chosen, so the dialog
                // cannot be dismissed into a shift nobody named.
                Button(
                    onClick = { start() },
                    enabled = !busy && selectedId != null,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.manual_start_confirm)) }
                TextButton(
                    onClick = onClose,
                    enabled = !busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.manual_cancel)) }

                // DEBUG BUILDS ONLY. manualOpenSimulations() is defined twice — once in
                // src/debug/ with these scenarios, once in src/release/ returning an empty
                // list and containing none of the code. On a release build this loop has
                // nothing to iterate and the buttons do not exist.
                for (simulation in manualOpenSimulations()) {
                    OutlinedButton(
                        onClick = { start(simulation) },
                        enabled = !busy && selectedId != null,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("\u25b6 ${simulation.label}") }
                }
            }
        }
    }
}

/**
 * Stop. Names the building, says the office will see it, then POST /shifts/close with
 * manual=true and no location.
 */
@Composable
private fun ManualStopDialog(
    model: TimeSheetViewModel,
    locationName: String?,
    onClose: () -> Unit,
) {
    var errorKey by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun stop(simulation: ManualSimulation? = null) {
        busy = true
        errorKey = null
        model.manualClose(simulation) { failure ->
            busy = false
            if (failure == null) onClose() else errorKey = failure.messageKey
        }
    }

    Dialog(onDismissRequest = { if (!busy) onClose() }) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.manual_stop_title),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    stringResource(
                        R.string.manual_stop_body,
                        locationName ?: stringResource(R.string.unknown_location),
                    ),
                )

                errorKey?.let {
                    Text(
                        stringResource(stringIdFor(it)),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                }

                Button(
                    onClick = { stop() },
                    enabled = !busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.manual_stop_confirm)) }
                TextButton(
                    onClick = onClose,
                    enabled = !busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.manual_cancel)) }

                // DEBUG BUILDS ONLY — see [ManualStartDialog] for the source-set split.
                for (simulation in manualCloseSimulations()) {
                    OutlinedButton(
                        onClick = { stop(simulation) },
                        enabled = !busy,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("\u25b6 ${simulation.label}") }
                }
            }
        }
    }
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

    // „Meine Stunden“ (TASK-189) as a plain composable toggle, NOT a bottom-nav tab and NOT
    // a new Activity: ShiftSignal.Tab, visibleTabs and SignedInScaffold's NavigationBar are
    // all untouched. Reached only by a worker already signed in who taps Einstellungen —
    // one of the two tabs ShiftSignal.visibleTabs guarantees stays visible in every shift
    // state — and then this button. None of that fires during, before or as a side effect
    // of a tag tap.
    var showMyHours by rememberSaveable { mutableStateOf(false) }
    if (showMyHours) {
        MyHoursScreen(model, onBack = { showMyHours = false })
        return
    }

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

        // „Meine Stunden“ entry point: same „about you“ grouping as signed-in-as/sign-out
        // above, before the settings sections below it. Read-only — no rate, no total, no
        // control that writes a shift (decision-19/47).
        HorizontalDivider()
        OutlinedButton(
            onClick = { showMyHours = true },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.myhours_open)) }

        HorizontalDivider()
        PushSection(model)

        // TASK-253: a plain version line, visible without any dev tooling -- the whole
        // point is turning "which build is this phone running" from a log dive into a
        // 30-second glance. NOT tied to self-update in any way (that mechanism is gone;
        // Play Store owns delivery now) -- this is the same one-line, non-interactive
        // fact iOS's SettingsView shows via Bundle.main.infoDictionary.
        HorizontalDivider()
        Text(
            stringResource(R.string.app_version_line, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * „Meine Stunden“ (TASK-189): read-only, GET /shifts/mine, same LazyColumn/heading/empty-item
 * pattern as [HistoryScreen] (the house reference for a read-only list screen), NOT
 * [LogScreen] — that screen is tap-path clutter this one must stay clear of. Fetches on
 * every entry (no caching across visits): leaving Settings' toggle off and coming back
 * destroys and recreates this composable, so [LaunchedEffect] re-fires and the state goes
 * back to [MyHoursState.Loading] before anything is shown.
 *
 * NO total, NO sum, NO aggregate anywhere — deliberately narrower than [HistoryScreen]'s
 * „Diese Woche/Gesamt“ block. NO rate, NO euro amount. NO control that writes a shift
 * (decision-19/47): this screen is read-only about the past, full stop.
 */
@Composable
private fun MyHoursScreen(model: TimeSheetViewModel, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    LaunchedEffect(Unit) { model.loadMyHours() }
    val state by model.myHours.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Explicit control, not gesture-only (house rule: labelled controls rather than
        // gestures).
        TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }
        Text(
            stringResource(R.string.myhours_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        // States the 60-day window + "from the server", distinguishing this from the
        // local Verlauf tab, which is the phone's own log of what it wrote.
        Text(
            stringResource(R.string.myhours_window),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        when (val current = state) {
            is MyHoursState.Loading -> Centered { CircularProgressIndicator() }
            is MyHoursState.Failed -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    stringResource(if (current.offline) R.string.myhours_offline else R.string.myhours_error),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
                OutlinedButton(onClick = model::loadMyHours) { Text(stringResource(R.string.log_refresh)) }
            }
            is MyHoursState.Loaded -> LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (current.shifts.isEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.myhours_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(current.shifts, key = { it.id }) { MyHoursRow(it) }
            }
        }
    }
}

/** One row: building, state word, date, start, end, duration — never a rate, never a total. */
@Composable
private fun MyHoursRow(shift: WireShift) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                shift.locationName ?: stringResource(R.string.unknown_location),
                style = MaterialTheme.typography.titleMedium,
            )
            // The word always carries the meaning on its own (AC#2/#5); colour is the
            // second signal, same rule ShiftRow already applies, only for the
            // auto-closed-unconfirmed case.
            Text(
                stringResource(myHoursStatusRes(shift)),
                style = MaterialTheme.typography.labelMedium,
                color = if (shift.needsResolution) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.tertiary
                },
            )
        }
        Text(stringResource(R.string.myhours_date, viennaDate(shift.startTime)), style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.myhours_start, viennaTime(shift.startTime)), style = MaterialTheme.typography.bodySmall)
        Text(
            shift.endTime?.let { stringResource(R.string.myhours_end, viennaTime(it)) }
                ?: stringResource(R.string.myhours_end_open),
            style = MaterialTheme.typography.bodySmall,
        )
        // Omitted — not zero, not fake — for the currently-running row: the only case with
        // endTime == null.
        shift.endTime?.let { end ->
            val seconds = java.time.Duration.between(shift.startTime, end).seconds
            Text(
                stringResource(
                    R.string.myhours_duration,
                    stringResource(R.string.duration_format, (seconds / 3600).toInt(), ((seconds % 3600) / 60).toInt()),
                ),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        HorizontalDivider()
    }
}

/**
 * The one thing this whole screen exists to communicate honestly (TASK-189). Order
 * matters and mirrors [ShiftRow]'s existing `when` exactly: end_time-null is checked
 * FIRST, so a currently-running shift (which by construction has autoClosed=false,
 * correctedAt=null) can never fall into any other branch. [WireShift.correctedAt] is
 * server-guaranteed to only ever be non-null on a row that WAS auto_closed (POST
 * /shifts/:id/resolve 409s unless auto_closed AND corrected_at IS NULL — "no third flag
 * exists to disagree with them", server's own comment), so the third branch is
 * unambiguous. `else` is the one case [ShiftRow] renders as a blank line today
 * (status_closed is the one new string this screen needed).
 */
private fun myHoursStatusRes(shift: WireShift): Int = when {
    shift.endTime == null -> R.string.status_running
    shift.needsResolution -> R.string.status_auto_closed
    shift.correctedAt != null -> R.string.status_corrected
    else -> R.string.status_closed
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

// ---- „Meine Stunden“ (TASK-189) — Vienna-fixed formatting, deliberately NOT reusing
// dateFormat/timeFormat above. Those use ZoneId.systemDefault(), which is only correct on
// a phone whose system zone happens to already be Europe/Vienna — not a guarantee. The web
// admin panel is zone-locked (web/lib/shifts.ts: BUSINESS_TIME_ZONE = 'Europe/Vienna'), and
// this screen has to match it for the SAME shift, including across a DST boundary. Same
// PATTERN (ofLocalizedDate/Time + FormatStyle), only the zone argument changes — that
// argument is exactly where the drift risk lives. The three existing systemDefault() call
// sites (HistoryScreen, ShiftRunningScreen's running clock, LogScreen) are untouched: none
// of them are this task's job, and ShiftRunningScreen is tap-adjacent.
private val viennaZone: ZoneId = ZoneId.of("Europe/Vienna")

private val viennaDateFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(viennaZone)

private val viennaTimeFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(viennaZone)

private fun viennaDate(instant: Instant): String = viennaDateFormat.format(instant)

private fun viennaTime(instant: Instant): String = viennaTimeFormat.format(instant)
