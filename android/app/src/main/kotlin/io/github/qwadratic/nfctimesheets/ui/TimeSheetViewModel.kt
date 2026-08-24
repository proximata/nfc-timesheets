package io.github.qwadratic.nfctimesheets.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.EnrolmentCode
import io.github.qwadratic.nfctimesheets.core.MaterialEntry
import io.github.qwadratic.nfctimesheets.core.MaterialQueue
import io.github.qwadratic.nfctimesheets.core.PendingWork
import io.github.qwadratic.nfctimesheets.core.RunningShift
import io.github.qwadratic.nfctimesheets.core.ShiftSignal
import io.github.qwadratic.nfctimesheets.core.RemoteRelease
import io.github.qwadratic.nfctimesheets.core.TapInbox
import io.github.qwadratic.nfctimesheets.core.WireMaterialRequest
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.core.WireWorker
import io.github.qwadratic.nfctimesheets.core.Zones
import io.github.qwadratic.nfctimesheets.data.LocalShift
import io.github.qwadratic.nfctimesheets.notify.ShiftSignals
import io.github.qwadratic.nfctimesheets.sync.SyncScheduler
import io.github.qwadratic.nfctimesheets.update.UpdateState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * The whole app is one of three screens, chosen by the SERVER's answer to "who is this?"
 * (decision-22). There is no path from [SignedOut] into the tabs, because the tabs are
 * not built at all in that state.
 *
 * There is no "authenticated but not a worker" state on Android and there cannot be one:
 * the only way in is an enrolment code the admin issued FOR a named worker (decision-26),
 * so a redeemed code is a worker by construction. That state exists on iOS because Apple
 * will happily authenticate someone nobody hired.
 */
sealed interface SessionState {
    data object Unknown : SessionState
    /** @param reasonKey string resource name, or null before the first attempt. */
    data class SignedOut(val reasonKey: String? = null) : SessionState
    data class SignedIn(val worker: WireWorker) : SessionState
}

data class LogState(
    val shifts: List<LocalShift> = emptyList(),
    val locationNames: Map<String, String> = emptyMap(),
    val unresolved: List<WireShift> = emptyList(),
    val busy: Boolean = false,
    /**
     * A location switch the worker must be told about: (site left, site arrived at).
     * Names are nullable because the roster cache may not have arrived yet — a missing
     * NAME is cosmetic and the UI substitutes "unknown location"; refusing to show the
     * notice at all would hide an auto-closed shift.
     */
    val switchNotice: Pair<String?, String?>? = null,
    /**
     * WHAT THIS PHONE IS STILL HOLDING (TASK-225). On the screen, in German, with the time
     * of the last attempt — because a queued tap that only exists in a log is the same bug
     * in a different place, and because the one thing a cleaner cannot be asked to do is
     * find out at month end that eight hours were never filed.
     */
    val pending: PendingWork.Summary = PendingWork.NOTHING,
    /**
     * Whether the PLATFORM is currently holding the delivery job — asked of JobScheduler
     * every time [pending] is recomputed, never remembered by us.
     *
     * It defaults to true because "nothing is waiting" is the ordinary state and the card
     * that reads this is hidden then anyway. It matters only when something IS waiting:
     * false there means the sentence „wird automatisch gesendet … auch wenn die App
     * geschlossen ist" is a LIE on this phone, and [PendingCard] must print the other
     * sentence instead. The app shipped once with every schedule() silently refused for a
     * missing permission, and no screen and no check could say so.
     */
    val pushArmed: Boolean = true,
) {
    val open: LocalShift? get() = shifts.firstOrNull { it.isOpen }
    val recent: List<LocalShift> get() = shifts.filter { !it.isOpen }.take(5)
}

/**
 * Material requests, worker side. Entirely separate from [LogState] on purpose: nothing
 * about materials may ever be able to delay or block a clock-in, and two flows cannot
 * accidentally await each other.
 *
 * @param featureUnavailable the server answered 404 not_found — these routes are not
 *        deployed yet. NOT an error: queued rows are kept untouched and go out later.
 */
data class MaterialState(
    val entries: List<MaterialEntry> = emptyList(),
    val unseenArrivals: List<WireMaterialRequest> = emptyList(),
    val featureUnavailable: Boolean = false,
    val busy: Boolean = false,
)

/**
 * „Meine Stunden“ (TASK-189): a read-only mirror of GET /shifts/mine, entirely separate
 * from [LogState] — same discipline as [MaterialState]: NONE of this is reachable from
 * handleTap, refresh() or the launch path, and this screen is never on the tap path.
 *
 * No cache, no persistence: [Loaded] holding stale content is impossible by construction
 * because every load resets to [Loading] first (see [TimeSheetViewModel.loadMyHours]),
 * so “nothing stale shown without being labelled stale” is not a caveat bolted onto a
 * cache, it is just what this state machine does.
 */
sealed interface MyHoursState {
    data object Loading : MyHoursState
    data class Loaded(val shifts: List<WireShift>) : MyHoursState
    /** @param offline true for ApiFailure.status == 0 (DNS/timeout/TLS/no network). */
    data class Failed(val offline: Boolean) : MyHoursState
}

class TimeSheetViewModel(private val app: TimeSheetsApplication) : ViewModel() {

    // THE TWO init{} LAUNCHES BELOW USED TO LIVE HERE, ABOVE EVERY PROPERTY THEY TOUCH —
    // A REAL CRASH, ON EVERY LAUNCH, ON A GALAXY S20 ULTRA (and reproduced on an emulator
    // the same way): `viewModelScope` dispatches on Dispatchers.Main.immediate, which runs
    // a coroutine body INLINE, synchronously, while still on the constructing thread, up
    // to its first real suspension point. `_smsAvailable.value = …` reached that
    // assignment before the class had executed `_smsAvailable`'s OWN initializer 69 lines
    // further down — Kotlin runs init{} blocks and property initializers in strict
    // TEXTUAL order, and a property is null (for an object type) until its own line runs.
    // Stack trace was `NullPointerException … MutableStateFlow.setValue … on a null
    // object reference` at this exact line. The init{} block is relocated below, after
    // every property it or [dropToSignedOut] touches — see there.

    /** One mailbox for every way a tap can arrive. See core/TapInbox.kt. */
    private val inbox = TapInbox()

    private val _pendingTap = MutableStateFlow<String?>(null)

    /**
     * Mirrors the inbox so Compose can observe it. The consumer lives INSIDE the log
     * screen, which only exists once the session has resolved — so a tap that launched
     * the app waits in the inbox instead of being dropped while the UI is still a
     * spinner. That drop is the bug that lost the iOS owner's first real tap.
     */
    val pendingTap: StateFlow<String?> = _pendingTap.asStateFlow()

    /** @return false when this was a duplicate delivery of one physical tap. */
    fun acceptTap(locationId: String): Boolean {
        val accepted = inbox.accept(locationId)
        if (accepted) _pendingTap.value = inbox.pendingLocationId
        return accepted
    }

    fun consumePendingTap() {
        inbox.take()?.let(::handleTap)
        _pendingTap.value = null
    }

    private val _session = MutableStateFlow<SessionState>(SessionState.Unknown)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    private val _log = MutableStateFlow(LogState())
    val log: StateFlow<LogState> = _log.asStateFlow()

    private val _materials = MutableStateFlow(MaterialState())
    val materials: StateFlow<MaterialState> = _materials.asStateFlow()

    /** „Meine Stunden“ (TASK-189). Its own StateFlow, never read or written by
     *  [LogState]/handleTap/armSignals/writeTap — see [loadMyHours]. */
    private val _myHours = MutableStateFlow<MyHoursState>(MyHoursState.Loading)
    val myHours: StateFlow<MyHoursState> = _myHours.asStateFlow()

    /** A material pass is in flight. Two overlapping passes could post the same row twice. */
    private var materialPassRunning = false

    private val _signingIn = MutableStateFlow(false)

    /** Drives the sign-in button's disabled/busy state. Not persisted: it is one call. */
    val signingIn: StateFlow<Boolean> = _signingIn.asStateFlow()

    // ---- SMS sign-in (decision-48 §6.6, this iteration) ----------------------------
    //
    // A SECOND FRONT DOOR ONTO THE SAME SESSION, never a parallel screen architecture: a
    // successful [verifySmsCode] calls the exact same [adopt] + [refresh] + [startMaterials]
    // sequence [signIn] does, below, because POST /auth/sms/verify mints the identical
    // worker_sessions row POST /auth/code does (server/routes/auth.js's own note).

    private val _smsAvailable = MutableStateFlow(false)

    /**
     * False until the launch-time capability read answers true. THE SIGN-IN SCREEN MUST
     * NOT COMPOSE THE SMS SECTION AT ALL WHILE THIS IS FALSE — not disabled, not hidden by
     * styling, not present. See ui/TimeSheetApp.kt's SignInScreen.
     */
    val smsAvailable: StateFlow<Boolean> = _smsAvailable.asStateFlow()

    private val _smsBusy = MutableStateFlow(false)

    /** Drives the SMS section's disabled/busy state. Own flag: sending a code and typing
     *  an enrolment code above it are unrelated actions and must not disable each other. */
    val smsBusy: StateFlow<Boolean> = _smsBusy.asStateFlow()

    // ---- self-update (this iteration) -----------------------------------------------
    //
    // READ ONLY FROM SETTINGS. Nothing below is reachable from handleTap, refresh() or
    // the material paths — an update is never the reason a clock-in or clock-out is
    // slow, delayed or blocked. See update/UpdateManager.kt's own header.

    private val _update = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val update: StateFlow<UpdateState> = _update.asStateFlow()

    /** The polling loop for whichever download is currently in flight, if any. Cancelled
     *  and replaced whenever a NEW download starts, so two overlapping polls never race
     *  to write [_update]. */
    private var updatePollJob: Job? = null

    // Placed HERE, after every property either launch touches (see the note at the top of
    // this class for why the position is load-bearing, not stylistic).
    init {
        // A 401 from ANY path, not only from refresh() (parity row 4). One collector, one
        // choke point, immediate — the same shape iOS's API.send() has always had.
        viewModelScope.launch {
            app.sessionRejected.collect { rejected -> if (rejected) dropToSignedOut() }
        }
        // THE APP'S ONE PUBLIC CAPABILITY READ, at launch, silently — same idiom as
        // checkForUpdateSilently(): no spinner, no screen anywhere waits on it. Runs
        // regardless of session state because the ONE screen that needs the answer,
        // SignInScreen, is exactly the screen a phone with no session yet is showing.
        //
        // ANY FAILURE — offline, an old server that predates the route, a timeout — is
        // swallowed here and read as false. This is the fail-closed half of the flag:
        // a phone that could not confirm SMS is configured must behave exactly like a
        // phone on a build where the flag is off, never like one where it is on.
        viewModelScope.launch {
            _smsAvailable.value = runCatching { app.api.capabilities() }.getOrDefault(false)
        }
    }

    // ---- session -------------------------------------------------------------------

    /**
     * Cached worker FIRST, server's verdict SECOND. The order matters both ways:
     * optimistic first so a cold start in a stairwell opens the app instead of flashing
     * a sign-in screen it cannot complete; server second because the server is
     * authoritative — a worker deactivated in the admin panel is signed out on their
     * next launch (decision-22).
     *
     * A NETWORK FAILURE IS NOT A SIGN-OUT. The phone is in a basement, not revoked. Only
     * a 401 (session gone) or a 403 (not a worker) changes the state downwards.
     */
    fun restoreSession() {
        viewModelScope.launch {
            // Never enrolled, or signed out. Ask nothing and say nothing: a fresh install
            // that greets a new worker with "Sie wurden abgemeldet" above the code field
            // is telling them something that did not happen, and the 401 it would take to
            // find that out is a round trip we already know the answer to.
            // WHAT IS STILL ON THIS PHONE, read before anything else and independently of
            // the session. A signed-out phone that is holding a queued shift must SAY so on
            // the sign-in screen — signing out does not delete the row, and a person who
            // thinks it vanished cannot ask anybody about it.
            _log.value = _log.value.copy(
                pending = io { app.store.pendingSummary() },
                pushArmed = io { SyncScheduler.isScheduled(app) },
            )

            if (app.cookies.header() == null) {
                _session.value = SessionState.SignedOut()
                return@launch
            }

            app.workers.read()?.let { _session.value = SessionState.SignedIn(it) }

            try {
                adopt(app.api.session())
            } catch (failure: ApiFailure) {
                when (failure.status) {
                    401 -> dropToSignedOut()
                    // Offline or 5xx: keep whatever we had. If that was nothing, the
                    // sign-in screen is correct — there is no identity to work with.
                    else -> if (_session.value is SessionState.Unknown) {
                        _session.value = SessionState.SignedOut()
                    }
                }
            }
            if (_session.value is SessionState.SignedIn) {
                // RE-ARM THE BACKGROUND PUSH AT LAUNCH, BUT ONLY IF THERE IS SOMETHING TO
                // DELIVER. A force-stop cancels every job the app has (sync/SyncScheduler.kt
                // names that ceiling); this is the recovery from it, and it is also what
                // schedules the job for the first time on a phone updating from a build that
                // had no background push at all.
                //
                // THE GUARD IS NOT A TIDY-UP, and the case it fixes is the OFFLINE one —
                // which is the only case this whole feature exists for. Measured on a
                // device, force-stopped first so the job state starts at "unknown":
                //
                //   build      launch ONLINE, empty queue   launch OFFLINE, empty queue
                //   0.5.0 / 7  unknown                      WAITING ← armed for nothing
                //   0.5.1 / 8  unknown                      unknown ← nothing armed
                //
                // Online the unconditional arm is invisible: the job's only constraint is
                // already met, so the platform runs it immediately, it finds an empty queue
                // and finishes. OFFLINE nothing runs it, so it sits waiting for a signal
                // that will give it nothing to do — and a basement is where this app gets
                // opened. It contradicts SyncScheduler's own contract („a phone with an
                // empty queue schedules nothing at all and costs no battery") and it costs
                // something real: a job that wakes on a network and finds nothing to do,
                // several times a day, across twenty phones, is the profile EMUI and MIUI
                // put in the RESTRICTED bucket — and a restricted app runs no jobs at all,
                // which would take the delivery this iteration is about down with it.
                //
                // Nothing is lost by the guard: refresh() below re-arms whatever its
                // foreground pass could not deliver, on the same predicate, and the boot
                // receiver already used it. Caught by demo/prove-offline-push.mjs § 0,
                // whose baseline is „no job is pending over an empty queue" and which had
                // to be run twice, on a launched app, before it could say so.
                io { if (app.store.pendingSummary().waiting > 0) SyncScheduler.ensure(app) }
                refresh()
                // At LAUNCH, not when the material tab is opened: the tab badge is the
                // only thing telling a worker something is waiting for them at the
                // warehouse, and a badge that only appears once you have looked is not a
                // badge. Its own coroutine, so it cannot delay the log.
                startMaterials()
                // Silent, own coroutine, same reasoning: a worker who visits Settings for
                // an unrelated reason (signing out) already sees whether a fix is
                // waiting, without a manual check — and nothing here can delay the log.
                checkForUpdateSilently()
            }
        }
    }

    /**
     * Enrolment (decision-26). The worker types the code the admin read them; the server
     * hands back a Set-Cookie, and the app then ASKS the server who that is. The client
     * never names a worker (decision-22) — note nothing here mentions a worker id.
     *
     * THE CODE IS NEVER LOGGED, stored, or attached to a failure. It lives as [typedCode]
     * for the length of this call and as request bytes, and nowhere else. (This app has
     * no logging at all; android/checks asserts that stays true.)
     *
     * @param typedCode raw keystrokes, in whatever case, with whatever spaces and dashes.
     */
    fun signIn(typedCode: String) {
        val code = EnrolmentCode.normalise(typedCode)
        if (code == null) {
            // Refused here, with the SAME message a wrong, expired or already-used code
            // gets. Two reasons, both load-bearing: a code-shaped typo must not spend one
            // of the handful of attempts before the rate limiter locks this phone out,
            // and "that is the wrong length" is exactly the kind of hint the server goes
            // out of its way never to give.
            _session.value = SessionState.SignedOut("err_invalid_code")
            return
        }
        viewModelScope.launch {
            _signingIn.value = true
            try {
                app.api.enrol(code)
                // A queued row belonging to THIS worker goes out on its own from here on:
                // sign-in is the moment the job stops being pointless (ShiftSyncJob returns
                // "do not reschedule" while there is no cookie), so it is the moment to arm
                // it again — IF there is a row. The overwhelmingly common sign-in is a new
                // worker with an empty queue, and that phone must schedule nothing; see
                // restoreSession above for what an unconditional arm costs.
                io { if (app.store.pendingSummary().waiting > 0) SyncScheduler.ensure(app) }
                // Second call on purpose: it proves the cookie actually landed in the jar
                // and will be sent again after the process is killed. Trusting the
                // enrolment response alone would show a friendly screen over a phone that
                // files nothing.
                adopt(app.api.session())
                refresh()
                startMaterials()
            } catch (failure: ApiFailure) {
                app.workers.clear()
                _session.value = SessionState.SignedOut(
                    // A dead connection is not a bad code, and must not be described as
                    // one — nor as "we'll send it later", because there is nothing queued
                    // to send and they do have to type it again.
                    if (failure.status == 0) "err_signin_offline" else failure.messageKey,
                )
            } finally {
                _signingIn.value = false
            }
        }
    }

    /**
     * decision-48 §6.6. „SMS senden": the admin already put this worker's number on file
     * (PUT /admin/workers/:id/phone); the worker types it back and the server texts a
     * 6-digit code. Never called unless [smsAvailable] is true — [SmsSignInSection] in
     * ui/TimeSheetApp.kt is not composed otherwise, so this never fires against a build
     * that would 503.
     *
     * @param onResult the failure to show, or null on success — mirrors [resolve]'s own
     *        callback shape. Kept OUT of [_session] deliberately: that flow drives the
     *        enrolment-code field above this section, and a phone-request failure must
     *        not paint a message under a field the worker never touched.
     */
    fun requestSmsCode(typedPhone: String, onResult: (ApiFailure?) -> Unit) {
        viewModelScope.launch {
            _smsBusy.value = true
            try {
                app.api.smsRequest(typedPhone)
                onResult(null)
            } catch (failure: ApiFailure) {
                onResult(failure)
            } finally {
                _smsBusy.value = false
            }
        }
    }

    /**
     * „Bestätigen": the 6 digits from the SMS. On success this runs the IDENTICAL tail
     * [signIn] runs — [adopt] then a second [app.api.session] call (proves the cookie
     * landed), [refresh], [startMaterials] — because POST /auth/sms/verify mints the same
     * worker_sessions row POST /auth/code does; nothing downstream may be able to tell
     * which door was used.
     *
     * @param phone the SAME string [requestSmsCode] was called with — the challenge is
     *        keyed on it server-side.
     */
    fun verifySmsCode(phone: String, typedCode: String, onResult: (ApiFailure?) -> Unit) {
        viewModelScope.launch {
            _smsBusy.value = true
            try {
                app.api.smsVerify(phone, typedCode)
                io { if (app.store.pendingSummary().waiting > 0) SyncScheduler.ensure(app) }
                adopt(app.api.session())
                refresh()
                startMaterials()
                onResult(null)
            } catch (failure: ApiFailure) {
                onResult(failure)
            } finally {
                _smsBusy.value = false
            }
        }
    }

    /**
     * Revokes server-side FIRST so a handed-over phone cannot keep the cookie alive, then
     * drops everything locally even if that call failed — leaving the cookie would sign
     * the next person straight back in as this worker.
     *
     * Queued shifts are NOT deleted. They belong to the worker who logged them and
     * SyncPlan blocks them under any other session rather than filing them under the
     * wrong name.
     */
    fun signOut() {
        viewModelScope.launch {
            runCatching { app.api.logout() }
            app.cookies.clear()
            app.workers.clear()
            _session.value = SessionState.SignedOut()
            // NOT LogState(): the pending count survives the sign-out, because the queued
            // rows do. They belong to the worker who logged them and go out when that
            // worker signs back in — and until then the sign-in screen has to say so, or
            // somebody hands the phone back believing their hours went with it.
            _log.value = LogState(
                pending = io { app.store.pendingSummary() },
                // A signed-out phone schedules nothing on purpose (ShiftSyncJob returns
                // "do not reschedule" without a cookie), so this is FALSE here — and the
                // sign-in card says „goes out when you sign in again", not „not armed":
                // signed-out is the more specific and more useful of the two truths.
                pushArmed = io { SyncScheduler.isScheduled(app) },
            )
            ShiftSignals.arm(app, null)
            // Not the STORE, only the screen. Queued material requests belong to the
            // worker who wrote them; MaterialStore.adopt() deletes them when a DIFFERENT
            // worker signs in, and the same worker signing back in still has them.
            _materials.value = MaterialState()
        }
    }

    private fun adopt(worker: WireWorker) {
        app.workers.write(worker)
        _session.value = SessionState.SignedIn(worker)
    }

    // ---- log ----------------------------------------------------------------------

    fun refresh() {
        val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return
        viewModelScope.launch {
            _log.value = _log.value.copy(busy = true)
            // Every one of these swallows a network failure by design: refreshing must
            // never be able to lose or hide a queued row. They touch SQLite, so they run
            // off the main thread.
            val pending = withContext(Dispatchers.IO) {
                app.sync.refreshRoster()
                app.sync.adoptServerOpenShift()
                val remaining = app.sync.push(worker.id)
                // Anything the foreground pass could not deliver is handed to the platform:
                // the job wakes when there is a network, with the app closed. Idempotent,
                // and it deliberately does NOT re-schedule an already-pending job (that
                // would reset its backoff). Nothing here can fail a refresh.
                if (remaining.waiting > 0) SyncScheduler.ensure(app)
                // ASKED, not assumed, and asked AFTER ensure() so the answer describes the
                // state the worker is about to be shown. `ensure` returning Scheduled and
                // the platform holding nothing would be a contradiction; this reads the
                // platform, which is the side that gets to be right.
                remaining to SyncScheduler.isScheduled(app)
            }
            val unresolved = runCatching { app.api.unresolvedShifts() }.getOrDefault(_log.value.unresolved)
            _log.value = _log.value.copy(
                shifts = io { app.store.all() },
                locationNames = io { app.store.locationNames() },
                unresolved = unresolved,
                pending = pending.first,
                pushArmed = pending.second,
                busy = false,
            )
            // THE RECOVERY HALF OF THE ONE WIRE. adoptServerOpenShift may have just learned
            // about a shift this phone had never heard of - reinstall, new device, or a tap
            // that opened the shift before the row landed - and the notification and the
            // ladder have to come back from exactly the same call the tap path uses. A
            // shift the server closed in the meantime arms nothing at all.
            armSignals()
        }
    }

    /**
     * THE ONE WIRE (audit §4). Called from exactly two places, the tap path and the
     * recovery path, and it is the only thing that touches the OS surfaces.
     *
     * Never awaited, never throwing, and always AFTER the local row is on disk.
     */
    private fun armSignals() {
        val running = _log.value.open?.let {
            RunningShift(
                locationId = it.locationId,
                locationName = siteName(it.locationId),
                startTime = it.startTime,
                // decision-10: the server flagged it and no human has fixed it. The screen
                // and the notification must then stop showing a running clock.
                serverAutoClosed = it.needsResolution,
            )
        }
        if (running != null) ShiftSignals.markClockedIn(app)
        ShiftSignals.arm(app, running)
    }

    /**
     * Re-state the world when the app comes back to the foreground: a notification the
     * worker swiped away comes back, and a permission flipped in Settings is noticed.
     */
    fun onForeground() = armSignals()

    /** The prompt has been shown once; never ask again from inside the app. */
    fun markNotificationsAsked() = ShiftSignals.markAsked(app)

    fun shouldAskForNotifications(sdkInt: Int): Boolean = ShiftSignal.shouldAskForNotifications(
        sdkInt = sdkInt,
        hasClockedIn = ShiftSignals.hasClockedIn(app),
        alreadyAsked = ShiftSignals.wasAsked(app),
    )

    /** True when the OS will show nothing outside the app. Said ONCE, as a sentence. */
    fun outOfAppSignalsSilenced(): Boolean = ShiftSignals.outOfAppSignalsSilenced(app)

    /** SQLite off the main thread. Small table, but a lock on the UI thread is an ANR. */
    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    /**
     * ONE TAP = ONE TOGGLE. The row is written locally FIRST — a tap in a basement still
     * counts — and pushed straight after.
     *
     * A TAP ALWAYS PRODUCES A ROW. There is deliberately no branch that returns without
     * writing one. In particular there is NO check that the location is in the local
     * roster cache: that guard existed on iOS, refused valid tags on a cold launch before
     * any roster fetch had finished, and cost the worker paid time standing at the door.
     * The SERVER is authoritative for whether a location exists (decision-19) and answers
     * 422 unknown_location, which is terminal, which blocks the row and shows it in red.
     * A missing NAME is cosmetic; a missing SHIFT is unpaid work.
     */
    fun handleTap(locationId: String) {
        val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return
        viewModelScope.launch {
            val notice = io {
                val result = writeTap(worker.id, locationId)
                // AFTER the row is on disk, off the main thread, and swallowing its own
                // failures (SyncScheduler.ensure wraps the binder call): the platform is now
                // holding a promise to deliver this tap even if the app is never opened
                // again. NOTHING HERE MAY BLOCK OR SLOW THE TAP — it is one binder call to
                // system_server, it happens after the shift already exists locally, and the
                // push itself is refresh()'s job, below, exactly as before.
                SyncScheduler.ensure(app)
                result
            }
            _log.value = _log.value.copy(
                shifts = io { app.store.all() },
                switchNotice = notice,
                pending = io { app.store.pendingSummary() },
                pushArmed = io { SyncScheduler.isScheduled(app) },
            )
            // AFTER the row is written and read back, and never before it. Everything in
            // armSignals is a signal, and a signal may never delay, throw into or fail a
            // clock-in: a denied permission and a dead network are both "arm nothing",
            // never "reject the tap". core-check.kt pins this ordering.
            armSignals()
            refresh()
        }
    }

    /** @return the (left, arrived) site names when this tap auto-closed another shift. */
    private fun writeTap(workerId: Int, locationId: String): Pair<String?, String?>? {
        val running = app.store.openShift()
        var notice: Pair<String?, String?>? = null

        if (running == null) {
            app.store.startShift(workerId, locationId)
        } else if (sameBuilding(running.locationId, locationId)) {
            app.store.closeShift(running.clientUuid, Instant.now(), autoClosed = false)
        } else {
            // The worker left the last building without tapping out and is now at a new
            // one. Auto-closing is the only non-deadlocking option: the server allows one
            // open shift per worker and they cannot walk back to the old tag.
            //
            // FLAGGED, not silent: the end time just written is the moment they arrived
            // somewhere ELSE, so the walk between sites lands on this building's labour
            // cost and no human confirmed the real finish time. auto_closed routes it
            // through the same resolution screen as an 8h timeout (decision-10), which
            // keeps the invariant that no shift reaches payroll with an unconfirmed end.
            app.store.closeShift(running.clientUuid, Instant.now(), autoClosed = true)
            app.store.startShift(workerId, locationId)
            notice = siteName(running.locationId) to siteName(locationId)
        }

        return notice
    }

    /**
     * Same BUILDING, not same raw id (decision-37's named risk, decision-43 §4). Two
     * zone taps inside one building must close-and-reopen as a tap-OUT, never be read as
     * a building switch — comparing the raw ids would do exactly that the day HOIV gets
     * its first zone. [Zones.buildingIdOf] resolves both ids against the roster-cached
     * zone table before comparing; a place absent from the cache compares as itself
     * (identity fallback), which is exactly today's zero-zone behaviour.
     */
    private fun sameBuilding(a: String, b: String): Boolean {
        val zones = app.store.zones()
        return Zones.buildingIdOf(a, zones) == Zones.buildingIdOf(b, zones)
    }

    fun dismissSwitchNotice() {
        _log.value = _log.value.copy(switchNotice = null)
    }

    /** POST /shifts/:id/resolve, then mirror the result locally (decision-10). */
    fun resolve(shift: WireShift, endTime: Instant, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                val updated = app.api.resolveShift(shift.id, endTime)
                io { app.store.applyServer(updated) }
                _log.value = _log.value.copy(
                    shifts = io { app.store.all() },
                    unresolved = _log.value.unresolved.filterNot { it.id == shift.id },
                )
                // Confirming an auto-closed shift is the one path that ends a shift WITHOUT
                // a tag tap. A notification left standing after it is exactly the "stuck
                // lock / orphaned notification" this work exists to prevent.
                armSignals()
            } catch (failure: ApiFailure) {
                onError(failure.messageKey)
            }
        }
    }

    fun siteName(locationId: String): String? = _log.value.locationNames[locationId]

    // ---- material requests ---------------------------------------------------------
    //
    // NONE of this is reachable from handleTap, refresh() or the launch path. It is
    // driven by the material tab and nothing else, so a slow or missing materials API
    // cannot cost anybody a clock-in.

    /**
     * Called when the material tab appears. Adopt (a different worker gets an empty
     * store), show what is on disk immediately, then push and pull.
     */
    fun startMaterials() {
        val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return
        viewModelScope.launch {
            io { app.materials.adopt(worker.id) }
            readMaterials()
            syncMaterials()
        }
    }

    /** Push then pull, so an arrival that lands mid-push is visible on the same refresh. */
    fun syncMaterials() {
        val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return
        if (materialPassRunning) return
        viewModelScope.launch {
            materialPassRunning = true
            _materials.value = _materials.value.copy(busy = true)
            try {
                // withContext and not io{}: these are suspend functions that touch both
                // SQLite and the network, so they need the dispatcher, not a wrapper for
                // a blocking call.
                val pushMissing = withContext(Dispatchers.IO) { app.materialSync.push(worker.id) }
                val pullMissing = withContext(Dispatchers.IO) { app.materialSync.pull(worker.id) }
                readMaterials(featureUnavailable = pushMissing || pullMissing)
            } finally {
                materialPassRunning = false
                _materials.value = _materials.value.copy(busy = false)
            }
        }
    }

    /**
     * The worker asked for something. The row is written to disk FIRST and pushed
     * afterwards, exactly like a tap: a request typed in a basement has to survive.
     *
     * @return false when there was nothing to ask for — empty, or past the server's own
     *         length cap. The screen disables the button for both, so this is the net.
     */
    fun submitMaterial(typed: String): Boolean {
        val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return false
        val body = MaterialQueue.normalise(typed) ?: return false
        viewModelScope.launch {
            // THE BUILDING, never the zone. POST /material-requests validates
            // location_uuid with v.activeLocation (buildings only, decision-6) — a raw
            // zone id from a shift that started at a zone tag would 422 unknown_location
            // and MaterialQueue.outcome() classifies that BLOCKED: terminal, a human must
            // act, and it looks like an unrelated support ticket with no obvious cause.
            val openLocationId = _log.value.open?.locationId
            val buildingId = openLocationId?.let { io { Zones.buildingIdOf(it, app.store.zones()) } }
            io { app.materials.enqueue(worker.id, body, locationId = buildingId) }
            readMaterials()
            syncMaterials()
        }
        return true
    }

    /** "I have read that it arrived." Idempotent server-side. */
    fun markMaterialSeen(request: WireMaterialRequest) {
        val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) { app.materialSync.markSeen(worker.id, request.id) }
            readMaterials()
        }
    }

    /**
     * „Meine Stunden“ (TASK-189): GET /shifts/mine for a 60-day window, recomputed fresh
     * on every call — never persisted, never cached. Called ONLY from MyHoursScreen's
     * `LaunchedEffect(Unit)`, which is keyed to that composable's own lifetime, so leaving
     * and reopening the screen always re-fires this and the old [MyHoursState.Loaded]
     * content is gone from state before the new fetch even starts.
     *
     * 60 days, not iOS's migration-reconciliation window: different caller, different
     * `since` — this covers the current and prior payroll period without a date picker.
     */
    fun loadMyHours() {
        if (_session.value !is SessionState.SignedIn) return
        _myHours.value = MyHoursState.Loading
        viewModelScope.launch {
            try {
                val since = Instant.now().minusSeconds(60 * 86_400L)
                _myHours.value = MyHoursState.Loaded(app.api.myShifts(since))
            } catch (failure: ApiFailure) {
                _myHours.value = MyHoursState.Failed(offline = failure.status == 0)
            }
        }
    }

    /** Disk -> screen. The only place [MaterialState] entries are built. */
    private suspend fun readMaterials(featureUnavailable: Boolean = _materials.value.featureUnavailable) {
        val outbox = io { app.materials.outbox() }
        val server = io { app.materials.server() }
        _materials.value = _materials.value.copy(
            entries = MaterialQueue.entries(outbox, server),
            unseenArrivals = server.filter { it.isUnseenArrival },
            featureUnavailable = featureUnavailable,
        )
    }

    // ---- self-update (this iteration) -----------------------------------------------

    /**
     * Called once after the session resolves (restoreSession). Silent: never surfaces a
     * spinner or an error outside Settings, exactly like a roster refresh failing is
     * invisible. If a download from a previous session is still in flight — or was left
     * running by a process DownloadManager kept alive after this app's own process died
     * — resumes watching it instead of asking the server again.
     */
    fun checkForUpdateSilently() {
        viewModelScope.launch {
            val resumed = withContext(Dispatchers.IO) { app.updates.resumePending() }
            if (resumed != null) {
                val (id, release) = resumed
                _update.value = UpdateState.Downloading(release, percent = null, waitingForNetwork = false)
                pollUpdateDownload(id, release)
                return@launch
            }
            _update.value = withContext(Dispatchers.IO) { app.updates.checkForUpdate() }
        }
    }

    /** The "nach Updates suchen" button. Same call as [checkForUpdateSilently], but the
     *  caller may show [UpdateState.Checking] because a human just asked for it. */
    fun checkForUpdate() {
        viewModelScope.launch {
            _update.value = UpdateState.Checking
            _update.value = withContext(Dispatchers.IO) { app.updates.checkForUpdate() }
        }
    }

    fun startUpdateDownload(release: RemoteRelease) {
        viewModelScope.launch {
            val id = withContext(Dispatchers.IO) { app.updates.enqueueDownload(release) }
            _update.value = UpdateState.Downloading(release, percent = null, waitingForNetwork = false)
            pollUpdateDownload(id, release)
        }
    }

    private fun pollUpdateDownload(id: Long, release: RemoteRelease) {
        updatePollJob?.cancel()
        updatePollJob = viewModelScope.launch {
            while (true) {
                val next = withContext(Dispatchers.IO) { app.updates.pollDownload(id, release) }
                _update.value = next
                if (next is UpdateState.ReadyToInstall || next is UpdateState.Failed) break
                delay(700)
            }
        }
    }

    /**
     * Control returned to us from the install hand-off. Read update/UpdateManager.kt's
     * own comment on [io.github.qwadratic.nfctimesheets.update.UpdateManager.installIntent]:
     * a SUCCESSFUL self-update kills this process as part of applying it, so a process
     * that is still here to run this callback is, almost always, evidence the install did
     * NOT go through — declined, or refused by the system (wrong signing key, no space).
     * Made LEGIBLE rather than left as a silent return to a screen that still says
     * "bereit zur Installation", which would look like nothing happened at all.
     */
    fun onReturnedFromInstallAttempt() {
        val current = _update.value
        if (current is UpdateState.ReadyToInstall) {
            _update.value = UpdateState.Failed(current.release, "err_update_not_installed")
        }
    }

    /** The one place ui/TimeSheetApp.kt needs an [android.content.Intent] built from
     *  update/UpdateManager — kept a one-line pass-through rather than exposing [app]
     *  itself to Compose. */
    fun installIntentFor(uri: android.net.Uri): android.content.Intent = app.updates.installIntent(uri)

    /** A 401 came back from somewhere: expired, revoked, or the worker was deactivated. */
    private fun dropToSignedOut() {
        app.sessionRejected.value = false
        app.cookies.clear()
        // A signed-out phone must not keep telling somebody they are clocked in.
        ShiftSignals.arm(app, null)
        app.workers.clear()
        _session.value = SessionState.SignedOut(ApiFailure(401, "no_session").messageKey)
    }

    class Factory(private val app: TimeSheetsApplication) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TimeSheetViewModel(app) as T
    }
}

/**
 * String resource name -> id. ApiFailure and the queue carry resource NAMES so a stored
 * failure re-localises; this is the one place they become an id.
 *
 * An explicit `when` and not `getIdentifier()`: reflection-by-name is not shrink-safe, and
 * a typo would silently render an empty error at a door in the dark. Here it fails to
 * compile. android/checks asserts every key ApiFailure can produce appears below.
 */
fun stringIdFor(key: String): Int = when (key) {
    "err_network" -> R.string.err_network
    "err_unknown_worker" -> R.string.err_unknown_worker
    "err_unknown_location" -> R.string.err_unknown_location
    "err_tag_unbound" -> R.string.err_tag_unbound
    "err_zone_unverified" -> R.string.err_zone_unverified
    "err_unknown_shift" -> R.string.err_unknown_shift
    "err_shift_already_open" -> R.string.err_shift_already_open
    "err_end_before_start" -> R.string.err_end_before_start
    "err_clock" -> R.string.err_clock
    "err_unauthorized" -> R.string.err_unauthorized
    "err_no_session" -> R.string.err_no_session
    "err_invalid_token" -> R.string.err_invalid_token
    "err_invalid_code" -> R.string.err_invalid_code
    "err_signin_offline" -> R.string.err_signin_offline
    "err_too_many_attempts" -> R.string.err_too_many_attempts
    "err_unknown_phone" -> R.string.err_unknown_phone
    "err_missing_location" -> R.string.err_missing_location
    "err_wrong_account" -> R.string.err_wrong_account
    "err_unknown_request" -> R.string.err_unknown_request
    "err_feature_unavailable" -> R.string.err_feature_unavailable
    "err_rejected_request" -> R.string.err_rejected_request
    "err_wrong_account_request" -> R.string.err_wrong_account_request
    "err_rejected" -> R.string.err_rejected
    "err_server" -> R.string.err_server
    "err_update_failed" -> R.string.err_update_failed
    "err_update_storage_full" -> R.string.err_update_storage_full
    "err_update_corrupt" -> R.string.err_update_corrupt
    "err_update_not_installed" -> R.string.err_update_not_installed
    else -> R.string.err_server
}
