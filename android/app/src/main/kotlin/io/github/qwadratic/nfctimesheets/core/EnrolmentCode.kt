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
 *      could not possibly be a code. The limiter is LOAD-BEARING on a 40-bit secret
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
 * THE ALPHABET is Crockford base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I, L, O, U.
 * The excluded letters are not merely absent, they are ALIASED on the way in: a worker
 * who hears "oh" and types O gets 0, and I or l gets 1. Case is folded and anything that
 * is not a letter or a digit is dropped, because people type the hyphen, and spaces, and
 * sometimes a non-breaking space out of a chat app.
 */
object EnrolmentCode {

    /** Canonical length. 32^8 = 2^40; the arithmetic is in server/lib/enrolment.js. */
    const val LENGTH = 8

    /**
     * Longest input worth looking at, matching the server's cap. Applied to the RAW
     * string, before separators are stripped, exactly as the server does it.
     */
    const val MAX_INPUT = 64

    private val CANONICAL = Regex("^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{$LENGTH}$")
    private val NOT_ALNUM = Regex("[^0-9A-Z]")

    /**
     * Whatever was typed -> the canonical 8-character code, or null.
     *
     * null is the only failure signal, and the caller must treat it exactly like a
     * server rejection.
     *
     * `uppercase()` and NOT `toUpperCase()`: the deprecated form uses the DEFAULT locale,
     * and on a Turkish phone that maps `i` to a dotted `İ`, which the strip below then
     * deletes — a correct code silently mangled on one worker's handset and nobody else's.
     * `uppercase()` is Locale.ROOT, which is what JS `toUpperCase()` does on the server.
     */
    fun normalise(input: String): String? {
        if (input.length > MAX_INPUT) return null
        val canonical = input
            .uppercase()
            .replace(NOT_ALNUM, "")
            .replace("O", "0")
            .replace("I", "1")
            .replace("L", "1")
        return if (CANONICAL.matches(canonical)) canonical else null
    }

    /**
     * `K7QF-3MZ2`. The grouping the admin panel shows and reads out, so what is on the
     * worker's screen looks like what was said down the phone. Purely cosmetic:
     * [normalise] strips the hyphen straight back off.
     */
    fun grouped(code: String): String =
        if (code.length == LENGTH) "${code.take(4)}-${code.drop(4)}" else code
}
