package io.github.qwadratic.nfctimesheets.core

/**
 * A failed call, classified. `status == 0` means the request never got an answer.
 * Port of APIFailure in NFCTimeSheets/NFCTimeSheets/API.swift.
 *
 * Carries a message KEY, never a message. The iOS version returns English literals and
 * records that as its ceiling; decision-8 says every user-visible string is externalised,
 * so here the resource name travels and the UI resolves it. That also means a failure
 * stored on a queued row re-localises when the phone's language changes, instead of
 * freezing whatever language was installed the day it failed.
 */
data class ApiFailure(
    val status: Int,
    val code: String,
    val field: String? = null,
) : Exception("$status $code") {

    /**
     * Retry, or give up and tell the worker?
     *
     * Retrying a 400 forever is pointless — the same bytes will be rejected the same way
     * after lunch. A 4xx means THIS payload is wrong and a human has to act; a transport
     * error, a 5xx, a 408 or a 429 means the payload may well be fine.
     *
     * 409 shift_already_open is one of two 4xx that are retryable: it means an OLDER shift of
     * ours has not been closed on the server yet. SyncPlan works in start-time order, so
     * the next pass closes that one first and this open then lands.
     *
     * 401 IS THE OTHER, AND IT WAS A PAYROLL DATA-LOSS BUG UNTIL 2026-08-20.
     *
     * A 401 says the CREDENTIAL is stale. It says nothing whatever about the payload — which
     * was measured, not argued: ops/break-taps.sh section 8 expires a live worker session on
     * production mid-shift, watches the clock-out come back 401, restores the session, replays
     * THE IDENTICAL REQUEST and gets 200. The bytes were always fine.
     *
     * Treating it as terminal meant `SyncPlan.blocksRow` returned true, `ShiftSync` called
     * `store.markFailed(..., blocked = true)`, and `SyncPlan.plan` skipped that row for ever:
     * nothing anywhere clears `sync_blocked` except markOpenSynced/markCloseSynced, and those
     * are unreachable for a row that is never planned again. Signing back in did not revive it.
     * So a shift taken in a basement, queued, and pushed after the session lapsed was hours a
     * cleaner had worked that the phone would never send — and the only sign was a red line in
     * a list.
     *
     * A worker session is 90 days, so this is not an everyday event. It does not have to be:
     * `requireWorkerSession` joins `workers` and requires `active`, so DEACTIVATING A WORKER
     * AND REACTIVATING THEM — an ordinary afternoon in the admin panel — 401s every call in
     * between, and the shift they were half-way through pushing dies with it.
     *
     * Retrying is safe, and specifically it cannot file A's hours under B: SyncPlan blocks a
     * row whose `workerId` is not the session's worker as WRONG_ACCOUNT before any step is
     * planned, and that check is untouched. Nor does it spin: the queue is only drained on
     * tap, on pull-to-refresh and when the log screen appears (ShiftSync's header) — there is
     * no background worker to loop.
     *
     * NOTE ALSO that the 401 choke point in TimeSheetViewModel drops the app to signed out and
     * tells the worker so. It always did — and it was never enough, because it deals with the
     * SESSION and this deals with the QUEUE. Signing back in restored the credential and left
     * the row blocked, which is precisely why the visible half of the handling made the
     * invisible half so easy to miss.
     *
     * `invalid_code` IS THE ONE 401 THAT STAYS TERMINAL, and the exception is not tidiness.
     * A sign-in code is single-use and rate-limited (decision-26): anything that automatically
     * retries a rejected one burns the worker's remaining attempts and then locks the phone out
     * for fifteen minutes, at the moment they are trying to get in. It is also the only 401
     * that is genuinely about the PAYLOAD — the characters they typed — rather than about a
     * credential this app already holds, which is exactly the distinction this property makes.
     */
    val isRetryable: Boolean
        get() = code == "shift_already_open" ||
            // decision-47. A zone that exists but has not yet been test-scanned by an
            // operator holding the physical card is a TEMPORARY state of the SERVER's
            // configuration, not a defect in this payload: the identical bytes succeed
            // the moment the zone goes live. Treating this as terminal reopens the exact
            // 401 payroll-loss class documented below — a tap taken offline, queued, and
            // pushed only after the zone was verified would be hours a cleaner worked
            // that the phone would never send.
            code == "zone_unverified" ||
            (status == 401 && code != "invalid_code") ||
            status == 0 || status == 408 || status == 429 || status >= 500

    /**
     * Name of the string resource shown to the worker. Says what to DO, not what broke.
     * android/checks/core-check.kt asserts every key returned here exists in
     * res/values/strings.xml, so a new server error code cannot ship as a blank line.
     */
    val messageKey: String
        get() = when (code) {
            "network" -> "err_network"
            "unknown_worker" -> "err_unknown_worker"
            "unknown_location" -> "err_unknown_location"
            // A card mounted at a door before the office resolved it in /tags/. Real,
            // expected traffic — not the generic "err_rejected" bucket — because "report
            // this shift" is the wrong instruction: nothing was ever opened.
            "tag_unbound" -> "err_tag_unbound"
            // decision-47. The zone this tag names is real, but no operator has proved
            // the physical card yet — see [isRetryable] for why this must stay retryable.
            "zone_unverified" -> "err_zone_unverified"
            "unknown_shift" -> "err_unknown_shift"
            "shift_already_open" -> "err_shift_already_open"
            "end_before_start" -> "err_end_before_start"
            "timestamp_in_future", "timestamp_out_of_range" -> "err_clock"
            // ONE SERVER CODE, TWO VERY DIFFERENT SITUATIONS. lib/auth.js answers
            // `401 unauthorized` both for a rejected X-App-Key (this build is not ours) and
            // for an absent, malformed or EXPIRED worker session. The phone cannot tell them
            // apart from the body, so the string must be true of both — it used to say only
            // "Diese App-Version wurde vom Server abgelehnt. Bitte aktualisieren.", which
            // sends a cleaner whose session simply lapsed off to update an app that is fine.
            "unauthorized" -> "err_unauthorized"
            "no_session" -> "err_no_session"
            "invalid_token" -> "err_invalid_token"
            // decision-26. The server answers this to SIX different situations — unknown,
            // malformed, expired, already redeemed, revoked, worker deactivated — with
            // one byte-identical body, so that distinguishing them is impossible. One
            // code in, one string out, and the string must not guess either.
            "invalid_code" -> "err_invalid_code"
            "too_many_attempts" -> "err_too_many_attempts"
            "missing_location" -> "err_missing_location"
            "wrong_account" -> "err_wrong_account"
            // Material requests. `unknown_request` is somebody else's row or one the
            // admin deleted; `not_found` is an UNROUTED PATH, i.e. this build is ahead
            // of the server — never a rejection of what was sent. MaterialQueue.outcome()
            // is what keeps the row queued; this only supplies the words.
            "unknown_request" -> "err_unknown_request"
            "not_found" -> "err_feature_unavailable"
            else -> if (status >= 500 || status == 0) "err_server" else "err_rejected"
        }

    companion object {
        /** Offline, DNS, timeout, TLS. Always retryable. */
        fun network(): ApiFailure = ApiFailure(status = 0, code = "network")
    }
}
