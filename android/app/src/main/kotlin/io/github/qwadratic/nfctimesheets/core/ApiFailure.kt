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
    /**
     * Only ever set by 403 not_eligible: the address the identity provider actually
     * handed the server. With Apple's Hide My Email that is a relay address the admin
     * could not have known in advance, so it has to survive the error path and reach
     * the screen — the worker reads it to their manager.
     */
    val email: String? = null,
) : Exception("$status $code") {

    /**
     * Retry, or give up and tell the worker?
     *
     * Retrying a 400 forever is pointless — the same bytes will be rejected the same way
     * after lunch. A 4xx means THIS payload is wrong and a human has to act; a transport
     * error, a 5xx, a 408 or a 429 means the payload may well be fine.
     *
     * 409 shift_already_open is the one 4xx that is retryable: it means an OLDER shift of
     * ours has not been closed on the server yet. SyncPlan works in start-time order, so
     * the next pass closes that one first and this open then lands.
     */
    val isRetryable: Boolean
        get() = code == "shift_already_open" ||
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
            "unknown_shift" -> "err_unknown_shift"
            "shift_already_open" -> "err_shift_already_open"
            "end_before_start" -> "err_end_before_start"
            "timestamp_in_future", "timestamp_out_of_range" -> "err_clock"
            "unauthorized" -> "err_unauthorized"
            "no_session" -> "err_no_session"
            "invalid_token" -> "err_invalid_token"
            "not_eligible" -> "err_not_eligible"
            "too_many_attempts" -> "err_too_many_attempts"
            "sign_in_unconfigured" -> "err_sign_in_unconfigured"
            "missing_location" -> "err_missing_location"
            "wrong_account" -> "err_wrong_account"
            else -> if (status >= 500 || status == 0) "err_server" else "err_rejected"
        }

    companion object {
        /** Offline, DNS, timeout, TLS. Always retryable. */
        fun network(): ApiFailure = ApiFailure(status = 0, code = "network")
    }
}
