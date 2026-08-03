package io.github.qwadratic.nfctimesheets.net

import io.github.qwadratic.nfctimesheets.BuildConfig
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.CloseShiftRequest
import io.github.qwadratic.nfctimesheets.core.EnrolmentRequest
import io.github.qwadratic.nfctimesheets.core.OpenShiftRequest
import io.github.qwadratic.nfctimesheets.core.ResolveShiftRequest
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireLocation
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.core.WireWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/**
 * The transport. `java.net.HttpURLConnection` on purpose: six endpoints, no interceptors,
 * no auth refresh dance, no multipart. OkHttp/Retrofit would be a dependency and a
 * codegen step to save about forty lines.
 *
 * NO ENDPOINT HERE IS NEW. Every path, field and status below already exists and is
 * already served (server/routes/app.js, server/routes/auth.js). Android must not require
 * a server change; if it seems to, that is a design bug on this side.
 *
 * @param cookies where the ts_worker session lives. Identity is the cookie and NOTHING
 *        else (decision-22) — no route below takes a worker id, in a body or in a query,
 *        and none must ever be added.
 * @param onSessionRejected fired ONCE from the single response choke point on any 401.
 *        The session is expired, revoked, or the worker was deactivated in the admin
 *        panel. Dropping to signed-out here means no call site can retry a request that
 *        can never succeed.
 */
class Api(
    private val cookies: CookieJar,
    private val onSessionRejected: () -> Unit,
) {
    private val base = "https://${BuildConfig.TAG_HOST}"

    // ---- endpoints ---------------------------------------------------------------

    /** GET /auth/session — is this cookie still a worker? 401 when it is not. */
    suspend fun session(): WireWorker = Wire.worker(get("/auth/session").getJSONObject("worker"))

    /**
     * POST /auth/code — redeem an admin-issued enrolment code (decision-26). The only
     * way an Android phone gets a session, and it mints the SAME worker_sessions row
     * Sign in with Apple mints on iOS.
     *
     *   200 -> Set-Cookie: ts_worker, absorbed by the choke point below like any other
     *   401 {"error":"invalid_code"} for unknown, malformed, expired, already redeemed,
     *       revoked, or a deactivated worker — byte-identical, deliberately. Do not add
     *       a client-side guess at which one it was.
     *   429 {"error":"too_many_attempts"}
     *
     * The return value is discarded on purpose. The server does echo {worker, expires_at},
     * but the app asks GET /auth/session immediately afterwards instead: that proves the
     * cookie actually reached the jar and will be sent on the next request. Believing
     * this response and skipping that check is how a worker gets a friendly screen and
     * files nothing.
     *
     * @param code CANONICAL form from EnrolmentCode.normalise(). Never logged, never
     *        stored, never put in an error — it exists as an argument and as request
     *        bytes and nowhere else.
     */
    suspend fun enrol(code: String) {
        post("/auth/code", EnrolmentRequest(code).toJson(), sessionBearing = false)
    }

    /** POST /auth/logout — revokes the session server-side, not just locally. */
    suspend fun logout() {
        post("/auth/logout", "{}")
        cookies.clear()
    }

    /** GET /roster -> the locations that resolve. The `workers` array is deliberately not read. */
    suspend fun roster(): List<WireLocation> {
        val array = get("/roster").getJSONArray("locations")
        return (0 until array.length()).map { Wire.location(array.getJSONObject(it)) }
    }

    /**
     * POST /shifts/open — decision-19: the shift is posted at clock-IN, end_time NULL.
     * 201 new · 200 duplicate (same client_uuid) · 409 shift_already_open.
     */
    suspend fun openShift(clientUuid: String, locationId: String, startTime: Instant): WireShift =
        Wire.shift(
            post("/shifts/open", OpenShiftRequest(clientUuid, locationId, startTime).toJson())
                .getJSONObject("shift"),
        )

    /** POST /shifts/close — the second half. Idempotent on the same client_uuid. */
    suspend fun closeShift(clientUuid: String, endTime: Instant, autoClosed: Boolean): WireShift =
        Wire.shift(
            post("/shifts/close", CloseShiftRequest(clientUuid, endTime, autoClosed).toJson())
                .getJSONObject("shift"),
        )

    /**
     * GET /shifts/open — the SERVER is authoritative for "who is clocked in right now"
     * (decision-19). An app reinstall, a second device or a tap that opened the shift
     * before the local row was written must not lose a running shift.
     */
    suspend fun currentOpenShift(): WireShift? {
        val body = get("/shifts/open")
        return if (body.isNull("shift")) null else Wire.shift(body.getJSONObject("shift"))
    }

    /** GET /shifts/unresolved — auto_closed AND corrected_at IS NULL, for this session (decision-10). */
    suspend fun unresolvedShifts(): List<WireShift> {
        val array = get("/shifts/unresolved").getJSONArray("shifts")
        return (0 until array.length()).map { Wire.shift(array.getJSONObject(it)) }
    }

    /** POST /shifts/:id/resolve — the worker supplies the real finish time. */
    suspend fun resolveShift(shiftId: Int, endTime: Instant): WireShift =
        Wire.shift(
            post("/shifts/$shiftId/resolve", ResolveShiftRequest(endTime).toJson()).getJSONObject("shift"),
        )

    // ---- transport ----------------------------------------------------------------

    private suspend fun get(path: String): JSONObject = send("GET", path, null)

    private suspend fun post(path: String, body: String, sessionBearing: Boolean = true): JSONObject =
        send("POST", path, body, sessionBearing)

    /**
     * Single choke point: every response is classified before anything else sees it.
     *
     * @param sessionBearing false for the ONE route that carries no session by
     *        definition, /auth/code. Its 401 means "that is not a valid code", not "your
     *        session died", and firing [onSessionRejected] for it would latch a flag that
     *        signs the worker straight back out on the very next refresh after they
     *        finally type the code correctly.
     */
    private suspend fun send(
        method: String,
        path: String,
        body: String?,
        sessionBearing: Boolean = true,
    ): JSONObject =
        withContext(Dispatchers.IO) {
            val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                // Proves "our app", never "this person". Recoverable from any installed
                // APK with `strings`; see branding.properties.
                setRequestProperty("X-App-Key", BuildConfig.APP_KEY)
                // The server ignores this today. It costs nothing and it lets the access
                // log name the platform behind a bad payload. NOT a server change.
                setRequestProperty("X-Client", "android/${BuildConfig.VERSION_NAME}")
                setRequestProperty("Accept", "application/json")
                cookies.header()?.let { setRequestProperty("Cookie", it) }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }

            val status: Int
            val payload: String
            try {
                if (body != null) connection.outputStream.use { it.write(body.toByteArray()) }
                status = connection.responseCode
                payload = (if (status in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                cookies.absorb(connection.headerFields["Set-Cookie"].orEmpty())
            } catch (_: Exception) {
                // Offline, DNS, timeout, TLS. Always retryable — this is the basement case
                // and it must never look like a rejection.
                throw ApiFailure.network()
            } finally {
                connection.disconnect()
            }

            if (status !in 200..299) {
                // Server error bodies are {"error":"code"} (+ an optional "field").
                val parsed = runCatching { JSONObject(payload) }.getOrNull()
                if (status == HttpURLConnection.HTTP_UNAUTHORIZED && sessionBearing) onSessionRejected()
                throw ApiFailure(
                    status = status,
                    code = parsed?.optString("error").orEmpty().ifEmpty { "http_$status" },
                    field = parsed?.optString("field")?.takeIf { it.isNotEmpty() },
                )
            }

            runCatching { JSONObject(payload) }.getOrElse {
                // A 2xx we cannot parse is not a success. Treat it as a transport fault so
                // the row retries rather than being marked sent on a body we never read.
                throw ApiFailure.network()
            }
        }

    private companion object {
        const val TIMEOUT_MS = 15_000
    }
}
