package io.github.qwadratic.nfctimesheets.core

/**
 * What a response's `Set-Cookie` headers mean for the stored session — the decision
 * only, with no storage in it, so android/checks can run it on a plain JVM.
 *
 * This is the whole of session persistence that can be got wrong in logic rather than in
 * Android. Process death is NORMAL on Android and is exactly when a stopped-state tap
 * arrives, so "did we keep the cookie" is not a rare path: it is the common one. The
 * storage side is three lines of SharedPreferences in net/CookieJar.kt.
 *
 * The server sends (server/lib/auth.js):
 *   ts_worker=<token>; Path=/; Max-Age=7776000; HttpOnly; Secure; SameSite=Strict
 * and, on logout or a rejected session:
 *   ts_worker=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict
 *
 * The distinction that matters is [Ignore] vs [Clear]. A response that says nothing about
 * our cookie must leave it ALONE — treating silence as a logout would sign a worker out
 * on every ordinary 200 and cost them the shift they are standing in.
 */
object SessionCookie {

    /** The one cookie this app has. HttpOnly, so only the transport ever sees it. */
    const val NAME = "ts_worker"

    private val MAX_AGE_ZERO = Regex("""(?i)max-age=0\b""")

    sealed interface Update {
        /** A fresh session token. */
        data class Store(val value: String) : Update

        /** The server explicitly ended this session: empty value, or Max-Age=0. */
        data object Clear : Update

        /** Nothing was said about our cookie. Keep whatever is stored. */
        data object Ignore : Update
    }

    /**
     * @param setCookieHeaders every `Set-Cookie` line on one response, in order.
     * Last one that mentions our cookie wins, which is what a browser would do.
     */
    fun read(setCookieHeaders: List<String>): Update {
        var update: Update = Update.Ignore
        for (raw in setCookieHeaders) {
            val pair = raw.substringBefore(';').trim()
            if (!pair.startsWith("$NAME=")) continue
            val value = pair.removePrefix("$NAME=")
            // Max-Age is looked for in the ATTRIBUTES only, never in the whole header:
            // the token is opaque and searching it would let its own bytes decide
            // whether we stay signed in.
            val attributes = raw.substringAfter(';', "")
            update = if (value.isEmpty() || MAX_AGE_ZERO.containsMatchIn(attributes)) {
                Update.Clear
            } else {
                Update.Store(value)
            }
        }
        return update
    }

    /** Value for the `Cookie:` request header, or null when there is no session. */
    fun header(stored: String?): String? =
        stored?.takeIf { it.isNotEmpty() }?.let { "$NAME=$it" }
}
