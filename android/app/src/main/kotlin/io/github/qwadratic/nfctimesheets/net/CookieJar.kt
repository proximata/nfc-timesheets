package io.github.qwadratic.nfctimesheets.net

import android.content.Context

/**
 * The worker session cookie, and only that cookie.
 *
 * The server sets `ts_worker=<token>; Path=/; Max-Age=<90d>; HttpOnly; Secure;
 * SameSite=Strict` (server/lib/auth.js). It is the ONLY statement of who the caller is
 * (decision-22), so it has to survive process death — a worker signs in about once a
 * quarter, not once per shift.
 *
 * ponytail: a two-value store rather than java.net.CookieManager + a custom CookieStore.
 * We have exactly one cookie, from exactly one host, over https only. CEILING: a second
 * cookie, or a server that starts rotating the token mid-session, needs a real store.
 * UPGRADE PATH: implement CookieHandler.setDefault(CookieManager(persistentStore, ...))
 * and delete this file; nothing outside Api.kt touches it.
 *
 * SECURITY NOTE, stated so nobody "improves" it later: this lands in the app's private
 * SharedPreferences, which is app-sandboxed and excluded from cloud backup below. It is
 * NOT encrypted at rest. That matches what the iOS app gets from HTTPCookieStorage. On a
 * rooted or unlocked-bootloader device it is readable — which is why the server keeps a
 * revocation row (POST /auth/logout deletes it) and why DELETE /admin/workers/:id already
 * kills every session.
 */
interface CookieJar {
    /** Value for the `Cookie:` request header, or null when signed out. */
    fun header(): String?

    /** Read `Set-Cookie` off a response. */
    fun absorb(setCookieHeaders: List<String>)

    fun clear()
}

class PrefsCookieJar(context: Context) : CookieJar {
    private val prefs = context.applicationContext
        .getSharedPreferences("session", Context.MODE_PRIVATE)

    override fun header(): String? =
        prefs.getString(KEY, null)?.takeIf { it.isNotEmpty() }?.let { "$NAME=$it" }

    override fun absorb(setCookieHeaders: List<String>) {
        for (raw in setCookieHeaders) {
            val first = raw.substringBefore(';').trim()
            if (!first.startsWith("$NAME=")) continue
            val value = first.removePrefix("$NAME=")
            // Max-Age=0 is the server clearing the cookie (logout, or a rejected session).
            val cleared = value.isEmpty() || Regex("""(?i)max-age=0\b""").containsMatchIn(raw)
            prefs.edit().apply {
                if (cleared) remove(KEY) else putString(KEY, value)
            }.apply()
        }
    }

    override fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val NAME = "ts_worker"
        const val KEY = "ts_worker"
    }
}
