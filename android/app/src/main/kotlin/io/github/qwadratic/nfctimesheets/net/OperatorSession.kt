package io.github.qwadratic.nfctimesheets.net

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * WHAT A 401 ON THE OPERATOR'S COOKIE MEANS, in ONE place.
 *
 * The gate itself stays exactly what decision-54 §4 made it: a COOKIE READ FROM DISK, never
 * a request — an operator in a stairwell with no signal must still get into the worklist,
 * and a gate that needs the network is a gate that fails shut where it is used. Nothing
 * here weakens that, and nothing here ever calls the server.
 *
 * WHAT IT ADDS is the other half of that bargain, which was missing. Offline-first says
 * „believe the disk until the server contradicts you“; there was no code for the
 * contradiction. After the server-side wipe deleted every operator_sessions row, a phone
 * holding a pre-wipe `ts_operator` cookie kept answering „signed in“ for ever: the cookie
 * was still on disk, so [ready] was true, and every operator call 401'd into a per-call-site
 * catch that painted „could not load“ — indistinguishable from being in a basement. The
 * operator sat on a dead screen full of stale zones with nothing telling them to sign in.
 *
 * So: the FIRST 401 from a request that actually carried the cookie is the contradiction,
 * and it lands here, from [Api]'s single response choke point — not from four call sites
 * (VerifyZoneActivity's worklist refresh, its verify/bind/unbind/reassign, WriteTagActivity's
 * report and resolve-zone), which is what four copies of this check would have become.
 *
 * NOT the worker's session, ever, in either direction (TimeSheetsApplication's note): the two
 * identities have separate jars and separate [Api] instances precisely so one cannot sign the
 * other out. A cleaner mid-shift is untouched by anything in this file.
 *
 * @param cookies the OPERATOR jar (`ts_operator`). Cleared on rejection — a token the server
 *        has already refused is worth nothing, and leaving it on disk is exactly what made
 *        the dead screen survive a restart.
 * @param onRejected side work the app wants done with it; the app passes the cached worklist's
 *        clear. A list fetched with a session the server has thrown away must not outlive it:
 *        it is „a label never a gate“ (nfc/OperatorZoneCache) but a label for the wrong
 *        operator is still a lie on a screen.
 */
class OperatorSession(
    private val cookies: CookieJar,
    private val onRejected: () -> Unit = {},
) {
    private val _rejected = MutableStateFlow(false)

    /**
     * Latches true on the first rejection and stays there until someone signs in again.
     * Observed by the screens that are ALREADY OPEN — the gate they read on resume cannot
     * help an operator standing in front of a card with the screen in their hand.
     */
    val rejected: StateFlow<Boolean> = _rejected.asStateFlow()

    /** Called from [Api]'s choke point on any 401 of a session-bearing operator request. */
    fun reject() {
        cookies.clear()
        onRejected()
        _rejected.value = true
    }

    /**
     * The gate, unchanged: is the cookie on disk. Signing in again is what un-latches
     * [rejected] — and it is un-latched HERE rather than by the sign-in call sites so a
     * path that mints a cookie without telling this class cannot leave the flag stuck on.
     */
    fun ready(): Boolean {
        val ready = cookies.header() != null
        if (ready) _rejected.value = false
        return ready
    }
}
