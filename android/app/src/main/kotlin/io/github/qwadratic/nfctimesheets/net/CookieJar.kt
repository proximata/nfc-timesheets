package io.github.qwadratic.nfctimesheets.net

import android.content.Context
import io.github.qwadratic.nfctimesheets.core.SessionCookie

/**
 * The worker session cookie, and only that cookie.
 *
 * The server sets `ts_worker=<token>; Path=/; Max-Age=<90d>; HttpOnly; Secure;
 * SameSite=Strict` (server/lib/auth.js). It is the ONLY statement of who the caller is
 * (decision-22), so it has to survive process death — a worker enrols once (decision-26)
 * and then the phone is killed and restarted by the OS all day, including on the tap
 * that launches the app from the stopped state.
 *
 * SharedPreferences is written to disk, so it survives that; a field would not, and
 * would turn every low-memory kill into a re-enrolment phone call. What the cookie MEANS
 * is decided in core/SessionCookie.kt, which android/checks can run; this class is only
 * the two lines of storage under it.
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

/**
 * @param name which cookie this jar holds — `ts_worker` (a cleaner) or `ts_operator` (the
 *        person who mounts tags). SEPARATE JARS, SEPARATE FILES, on purpose: an operator's
 *        phone must not be able to send a worker cookie on the same request, and the
 *        cheapest way to guarantee that is for the two never to meet in one store.
 * @param file the SharedPreferences file. Distinct per cookie, so signing out of one does
 *        not touch the other and a corrupted one cannot take both down.
 */
class PrefsCookieJar(
    context: Context,
    private val name: String = SessionCookie.NAME,
    file: String = "session",
) : CookieJar {
    private val prefs = context.applicationContext
        .getSharedPreferences(file, Context.MODE_PRIVATE)

    override fun header(): String? = SessionCookie.header(prefs.getString(name, null), name)

    override fun absorb(setCookieHeaders: List<String>) {
        when (val update = SessionCookie.read(setCookieHeaders, name)) {
            // commit(), not apply(): a session that only exists in an in-flight async
            // write is lost if the process dies before it lands, and the next launch
            // asks the worker for a code they no longer have. This runs on the IO
            // dispatcher inside Api.send() and writes one short string.
            is SessionCookie.Update.Store -> prefs.edit().putString(name, update.value).commit()
            SessionCookie.Update.Clear -> clear()
            SessionCookie.Update.Ignore -> Unit
        }
    }

    override fun clear() {
        prefs.edit().remove(name).commit()
    }
}
