package io.github.qwadratic.nfctimesheets.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.TapInbox
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.core.WireWorker
import io.github.qwadratic.nfctimesheets.data.LocalShift
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * The whole app is one of four screens, chosen by the SERVER's answer to "who is this?"
 * (decision-22). There is no path from [Ineligible] or [SignedOut] into the tabs, because
 * the tabs are not built at all in those states.
 */
sealed interface SessionState {
    data object Unknown : SessionState
    /** @param reasonKey string resource name, or null after a plain cancel. */
    data class SignedOut(val reasonKey: String? = null) : SessionState
    /** Authenticated somewhere, but not a worker here. [email] is read out to the manager. */
    data class Ineligible(val email: String?) : SessionState
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
) {
    val open: LocalShift? get() = shifts.firstOrNull { it.isOpen }
    val recent: List<LocalShift> get() = shifts.filter { !it.isOpen }.take(5)
}

class TimeSheetViewModel(private val app: TimeSheetsApplication) : ViewModel() {

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

    /**
     * False until decision-26 is accepted and an [io.github.qwadratic.nfctimesheets.auth.AuthProvider]
     * is wired in. The sign-in screen must SAY so rather than offering a button that
     * cannot work — an unauthenticated build has to fail visibly, not pretend.
     */
    val isSignInConfigured: Boolean get() = app.auth.isConfigured

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
            app.workers.read()?.let { _session.value = SessionState.SignedIn(it) }

            try {
                adopt(app.api.session())
            } catch (failure: ApiFailure) {
                when (failure.status) {
                    401 -> dropToSignedOut()
                    403 -> {
                        app.workers.clear()
                        _session.value = SessionState.Ineligible(failure.email)
                    }
                    // Offline or 5xx: keep whatever we had. If that was nothing, the
                    // sign-in screen is correct — there is no identity to work with.
                    else -> if (_session.value is SessionState.Unknown) {
                        _session.value = SessionState.SignedOut()
                    }
                }
            }
            if (_session.value is SessionState.SignedIn) refresh()
        }
    }

    /**
     * The one entry point behind the sign-in seam. Whatever decision-26 picks, it ends
     * here: a Set-Cookie landed, and the app then ASKS the server who that is. The client
     * never names a worker.
     */
    fun signIn() {
        viewModelScope.launch {
            try {
                app.auth.signIn()
                adopt(app.api.session())
                refresh()
            } catch (failure: ApiFailure) {
                app.workers.clear()
                _session.value = if (failure.status == 403) {
                    SessionState.Ineligible(failure.email)
                } else {
                    SessionState.SignedOut(failure.messageKey)
                }
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
            _log.value = LogState()
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
            withContext(Dispatchers.IO) {
                app.sync.refreshRoster()
                app.sync.adoptServerOpenShift()
                app.sync.push(worker.id)
            }
            val unresolved = runCatching { app.api.unresolvedShifts() }.getOrDefault(_log.value.unresolved)
            _log.value = _log.value.copy(
                shifts = io { app.store.all() },
                locationNames = io { app.store.locationNames() },
                unresolved = unresolved,
                busy = false,
            )
            if (app.sessionRejected) dropToSignedOut()
        }
    }

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
            val notice = io { writeTap(worker.id, locationId) }
            _log.value = _log.value.copy(shifts = io { app.store.all() }, switchNotice = notice)
            refresh()
        }
    }

    /** @return the (left, arrived) site names when this tap auto-closed another shift. */
    private fun writeTap(workerId: Int, locationId: String): Pair<String?, String?>? {
        val running = app.store.openShift()
        var notice: Pair<String?, String?>? = null

        if (running == null) {
            app.store.startShift(workerId, locationId)
        } else if (running.locationId == locationId) {
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
            } catch (failure: ApiFailure) {
                onError(failure.messageKey)
            }
        }
    }

    fun siteName(locationId: String): String? = _log.value.locationNames[locationId]

    /** A 401 came back from somewhere: expired, revoked, or the worker was deactivated. */
    private fun dropToSignedOut() {
        app.sessionRejected = false
        app.cookies.clear()
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
    "err_unknown_shift" -> R.string.err_unknown_shift
    "err_shift_already_open" -> R.string.err_shift_already_open
    "err_end_before_start" -> R.string.err_end_before_start
    "err_clock" -> R.string.err_clock
    "err_unauthorized" -> R.string.err_unauthorized
    "err_no_session" -> R.string.err_no_session
    "err_invalid_token" -> R.string.err_invalid_token
    "err_not_eligible" -> R.string.err_not_eligible
    "err_too_many_attempts" -> R.string.err_too_many_attempts
    "err_sign_in_unconfigured" -> R.string.err_sign_in_unconfigured
    "err_missing_location" -> R.string.err_missing_location
    "err_wrong_account" -> R.string.err_wrong_account
    "err_rejected" -> R.string.err_rejected
    "err_server" -> R.string.err_server
    else -> R.string.err_server
}
