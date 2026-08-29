// THE OPERATOR SESSION DIES AND THE PHONE FINDS OUT (TASK-401).
//
//     cd android && ./checks/run.sh          (this runs as part of it)
//
// THE INCIDENT. A server-side DB wipe deleted every operator_sessions row. A phone still
// holding a pre-wipe `ts_operator` cookie kept showing a signed-in operator gate over a
// stale cached worklist — reported live as „operator interface never asked for login, showed
// old zones“. The no-prompt half of that is BY DESIGN (decision-54 §4: the gate is a cookie
// read from disk, never a request, because a stairwell has no signal). The half that was
// missing is this one: what happens on the FIRST real operator call afterwards.
//
// WHAT THIS PROVES, end to end and with no mocking of the thing under test:
//   * a REAL java.net HttpsURLConnection request, made by the REAL net/Api.kt, to a REAL
//     HTTPS server on loopback that answers a REAL 401 on a REAL operator route;
//   * the stale cookie IS SENT (otherwise the 401 would prove nothing about it);
//   * afterwards: cookie gone from the jar, the cached worklist dropped, the gate flipped
//     back to signed-out, and the rejection flow latched so an OPEN screen learns of it;
//   * a 200 leaves all of that alone (a gate that trips on success is worse than no gate);
//   * a 401 from the ENROLMENT route does NOT trip it — that one means „wrong code“, and
//     signing the operator out over a typo is the regression this pin exists to stop.
//
// Only the three JDK-free ingredients are faked: BuildConfig, android.content, and the
// on-disk jar (an in-memory CookieJar — SharedPreferences is not the thing being tested).

@file:JvmName("Operator401Check")

package io.github.qwadratic.nfctimesheets.checks

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import io.github.qwadratic.nfctimesheets.BuildConfig
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.SessionCookie
import io.github.qwadratic.nfctimesheets.net.Api
import io.github.qwadratic.nfctimesheets.net.CookieJar
import io.github.qwadratic.nfctimesheets.net.OperatorSession
import kotlinx.coroutines.runBlocking
import java.io.File
import java.net.InetSocketAddress
import java.security.KeyStore
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import kotlin.system.exitProcess

private var failed = false

private fun check(ok: Boolean, what: String) {
    if (ok) {
        println("  ok    $what")
    } else {
        System.err.println("FAIL: $what")
        failed = true
    }
}

/** The jar, in memory. Storage is net/CookieJar.kt's job and is not what is being proved. */
private class MemoryJar(private var value: String?) : CookieJar {
    override fun header(): String? = SessionCookie.header(value, SessionCookie.OPERATOR_NAME)
    override fun absorb(setCookieHeaders: List<String>) {
        when (val update = SessionCookie.read(setCookieHeaders, SessionCookie.OPERATOR_NAME)) {
            is SessionCookie.Update.Store -> value = update.value
            SessionCookie.Update.Clear -> value = null
            SessionCookie.Update.Ignore -> Unit
        }
    }
    override fun clear() { value = null }
}

/** What the fake server saw, so „the stale cookie was actually sent“ is an observation. */
private val seenCookies = mutableMapOf<String, String?>()

private fun sslContext(): SSLContext {
    val store = File("checks/.lib/operator-401.jks")
    val password = "changeit"
    if (!store.exists()) {
        store.parentFile.mkdirs()
        val keytool = File(System.getProperty("java.home"), "bin/keytool").path
        val code = ProcessBuilder(
            keytool, "-genkeypair", "-alias", "checks", "-keyalg", "RSA", "-keysize", "2048",
            "-dname", "CN=localhost", "-validity", "3650",
            "-keystore", store.path, "-storepass", password, "-keypass", password,
        ).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor()
        require(code == 0) { "keytool failed ($code) — cannot start a loopback HTTPS server" }
    }
    val keys = KeyStore.getInstance("JKS").apply {
        store.inputStream().use { load(it, password.toCharArray()) }
    }
    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        .apply { init(keys, password.toCharArray()) }
    val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        .apply { init(keys) }
    return SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, tmf.trustManagers, null) }
}

fun main() {
    val ssl = sslContext()
    // The app talks https and only https (net/Api.kt's `base`), so the check does too rather
    // than relaxing the transport to make itself easier to write.
    HttpsURLConnection.setDefaultSSLSocketFactory(ssl.socketFactory)
    HttpsURLConnection.setDefaultHostnameVerifier { _, _ -> true }

    val server = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.httpsConfigurator = HttpsConfigurator(ssl)
    // THE WIPED SERVER: every operator route answers 401, exactly as it does for a session
    // row that no longer exists (server/lib/auth.js).
    for (path in listOf("/operator/zones", "/operator/tags", "/auth/operator-code")) {
        server.createContext(path) { exchange ->
            seenCookies[path] = exchange.requestHeaders.getFirst("Cookie")
            val body = """{"error":"unauthorized"}""".toByteArray()
            exchange.sendResponseHeaders(401, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
    }
    // ...and one that is fine, to prove the gate does not trip on success.
    server.createContext("/operator/locations") { exchange ->
        val body = """{"locations":[]}""".toByteArray()
        exchange.sendResponseHeaders(200, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
    }
    server.start()
    BuildConfig.API_HOST = "127.0.0.1:${server.address.port}"

    println("operator-401-check: a real 401 from a real operator route, over the real Api")

    // ---- the healthy call first: 200 must change nothing --------------------------------
    run {
        val jar = MemoryJar("stale-token-from-before-the-wipe")
        var cacheCleared = false
        val session = OperatorSession(jar) { cacheCleared = true }
        val api = Api(jar, session::reject)
        check(session.ready(), "before: the stored cookie reads as a signed-in operator")
        runBlocking { api.operatorLocations() }
        check(jar.header() != null, "200: the cookie survives an ordinary successful call")
        check(!cacheCleared, "200: the cached worklist survives it too")
        check(session.ready() && !session.rejected.value, "200: the gate stays open")
    }

    // ---- the wipe: GET /operator/zones, the worklist refresh that reported the bug -------
    run {
        val jar = MemoryJar("stale-token-from-before-the-wipe")
        var cacheCleared = false
        val session = OperatorSession(jar) { cacheCleared = true }
        val api = Api(jar, session::reject)
        check(session.ready(), "before: gate open, worklist would render (the reported state)")

        val failure = runCatching { runBlocking { api.operatorZones() } }.exceptionOrNull()
        check(failure is ApiFailure && failure.status == 401, "the worklist refresh 401s")
        check(
            seenCookies["/operator/zones"]?.contains(SessionCookie.OPERATOR_NAME) == true,
            "the stale ts_operator cookie WAS sent (so the 401 is about it)",
        )
        check(jar.header() == null, "after: the refused cookie is gone from the jar")
        check(cacheCleared, "after: the cached worklist was dropped with it")
        check(session.rejected.value, "after: the rejection latched for an ALREADY-OPEN screen")
        check(!session.ready(), "after: the gate is CLOSED — the sign-in screen comes back")

        // Signing in again is the only way back, and it un-latches the flow.
        jar.absorb(listOf("${SessionCookie.OPERATOR_NAME}=fresh-token; Path=/; Max-Age=7776000"))
        check(session.ready() && !session.rejected.value, "a new sign-in re-opens the gate")
    }

    // ---- POST /operator/tags — the write-report call site, same recovery ------------------
    run {
        val jar = MemoryJar("stale-token-from-before-the-wipe")
        val session = OperatorSession(jar)
        val api = Api(jar, session::reject)
        runCatching { runBlocking { api.reportTag("11111111-1111-1111-1111-111111111111") } }
        check(!session.ready() && session.rejected.value, "the tag report recovers identically")
    }

    // ---- the enrolment 401 is NOT a dead session ------------------------------------------
    run {
        val jar = MemoryJar("stale-token-from-before-the-wipe")
        val session = OperatorSession(jar)
        val api = Api(jar, session::reject)
        runCatching { runBlocking { api.operatorEnrol("ABCD-EFGH") } }
        check(
            session.ready() && !session.rejected.value,
            "a 401 from /auth/operator-code (wrong CODE) does NOT sign anybody out",
        )
    }

    server.stop(0)

    if (failed) {
        System.err.println("operator-401-check: FAILED")
        exitProcess(1)
    }
    println("operator-401-check: OK")
}
