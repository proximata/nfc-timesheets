package io.github.qwadratic.nfctimesheets.core

/**
 * The enrolment code, as the phone sees it (decision-26).
 *
 * A MIRROR OF `server/lib/enrolment.js` normaliseCode(), and it must stay one. The
 * server is authoritative: it normalises the string again before it hashes it, so
 * nothing here is a security control. What this buys is the two things the server
 * cannot do from Vienna:
 *
 *   1. It does not spend one of the worker's few rate-limited attempts on a string that
 *      could not possibly be a code. The limiter is LOAD-BEARING on a 100_000-value space
 *      (5 failures, then 30s doubling to 15 min), so a fat-fingered paste must not push
 *      a tired cleaner into a lockout at a door.
 *   2. It lets the button be disabled until the input is plausibly a code, which is the
 *      only feedback the worker may safely be given — see below.
 *
 * IT MUST NEVER BE MORE PERMISSIVE THAN THE SERVER. If it accepted something the server
 * rejects, the worker gets a lockout instead of an answer. If it accepted something the
 * server normalises DIFFERENTLY, they get "code not accepted" for a code that is correct.
 * android/checks/core-check.kt reads the alphabet, the length and the input cap straight
 * out of server/lib/enrolment.js and fails if the two drift.
 *
 * NO REASON IS EVER GIVEN. "Too short" and "bad character" are silent here for the same
 * reason the server collapses unknown / expired / already-used / revoked into one byte
 * identical 401: any distinction confirms something about a live code. The UI shows one
 * message, always.
 *
 * THE ALPHABET IS DIGITS ONLY — `0123456789`, five of them, no dash (decision-63,
 * TASK-319). It used to be 8 characters of Crockford base32 with O->0 and I,L->1 aliased
 * on the way in; with no letters left there is nothing to alias, so THAT STEP IS GONE.
 * Anything that is not a digit is dropped, because people type the hyphen, and spaces,
 * and sometimes a non-breaking space out of a chat app.
 */
object EnrolmentCode {

    /** Canonical length. 10^5 = 100_000; the arithmetic is in server/lib/enrolment.js. */
    const val LENGTH = 5

    /**
     * Longest input worth looking at, matching the server's cap. Applied to the RAW
     * string, before separators are stripped, exactly as the server does it.
     */
    const val MAX_INPUT = 64

    private val CANONICAL = Regex("^[0-9]{$LENGTH}$")
    private val NOT_DIGIT = Regex("[^0-9]")

    /**
     * Whatever was typed -> the canonical 5-digit code, or null.
     *
     * null is the only failure signal, and the caller must treat it exactly like a
     * server rejection.
     *
     * No case folding and no aliasing: the alphabet has no letters left for either to
     * touch, and the server's own normaliseCode() is now exactly this one strip. Non-digits
     * are STRIPPED, not rejected, so a pasted "1-2345" or "12 345" still works.
     */
    fun normalise(input: String): String? {
        if (input.length > MAX_INPUT) return null
        val canonical = input.replace(NOT_DIGIT, "")
        return if (CANONICAL.matches(canonical)) canonical else null
    }
}
