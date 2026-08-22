package io.github.qwadratic.nfctimesheets.net

import io.github.qwadratic.nfctimesheets.BuildConfig
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.CloseShiftRequest
import io.github.qwadratic.nfctimesheets.core.CreateMaterialRequest
import io.github.qwadratic.nfctimesheets.core.EnrolmentRequest
import io.github.qwadratic.nfctimesheets.core.OpenShiftRequest
import io.github.qwadratic.nfctimesheets.core.PendingWork
import io.github.qwadratic.nfctimesheets.core.ResolveShiftRequest
import io.github.qwadratic.nfctimesheets.core.SmsRequestBody
import io.github.qwadratic.nfctimesheets.core.SmsVerifyBody
import io.github.qwadratic.nfctimesheets.core.VerifyZoneRequest
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireRoster
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.core.WireWorker
import io.github.qwadratic.nfctimesheets.core.WireZoneVerifyResult
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
 * @param pending what this phone is still holding, read once per request and attached as
 *        the X-Pending-* headers below (TASK-225). Defaults to "nothing", which is what
 *        the operator's Api instance reports and is true of it: an operator does not clock
 *        in (decision-45) and has no queue.
 */
class Api(
    private val cookies: CookieJar,
    private val onSessionRejected: () -> Unit,
    private val pending: () -> PendingWork.Summary = { PendingWork.NOTHING },
) {
    /**
     * THE API HOST, NEVER THE TAG HOST (decision-40).
     *
     * These were one value. A tag carries a hostname in ink on a wall and cannot be renamed;
     * a server can, and was — timesheets -> schimmer-glanz — which killed a tag that had
     * already been written and handed to a client. So the app PARSES the tag host (TagLink,
     * the manifest intent filter) and TALKS to the API host, and the two move independently.
     *
     * Nothing physical points here, so this host may be renamed, moved or replaced.
     */
    private val base = "https://${BuildConfig.API_HOST}"

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

    /**
     * GET /auth/capabilities — auth: "app" only, no session, exactly like [appVersion]: the
     * sign-in screen has to ask this BEFORE it has drawn anything, so a phone that has never
     * enrolled must still be able to call it. `sessionBearing = false` for the same reason
     * as [appVersion] — a 401 here means a bad X-App-Key, never a dead session.
     *
     * ONE FIELD (server/routes/auth.js): `{sms: boolean}`. A failure of ANY kind — offline,
     * an old server that predates this route, a timeout — is swallowed by the caller
     * (TimeSheetViewModel), which defaults to false: the sign-in screen fails CLOSED, the
     * same direction the server itself fails in when Twilio is unconfigured. Showing a
     * button on a guess would be exactly the broken control this route exists to prevent.
     */
    suspend fun capabilities(): Boolean = get("/auth/capabilities", sessionBearing = false).optBoolean("sms", false)

    /**
     * POST /auth/sms/request {phone} — decision-48 §6. `sessionBearing = false`: there is no
     * session yet, same reasoning as [enrol].
     *
     *   202 always, for a resolvable shape — IDENTICAL for a known and an unknown number,
     *       by server design; there is nothing to read out of a successful response
     *   422 {"error":"invalid_phone"}   shape only, never existence
     *   429 {"error":"too_many_attempts"}
     *   503 {"error":"sms_not_configured"}
     *
     * @param phone raw keystrokes. The server normalises (lib/validate.js identityPhone);
     *        this client does not reimplement that parser.
     */
    suspend fun smsRequest(phone: String) {
        post("/auth/sms/request", SmsRequestBody(phone).toJson(), sessionBearing = false)
    }

    /**
     * POST /auth/sms/verify {phone, code} — worker session cookie, BYTE-IDENTICAL to
     * [enrol]'s (decision-48 §6): the same createWorkerSession() call, the same ts_worker
     * cookie. The return value is discarded for the same reason [enrol]'s is: the caller
     * re-asks GET /auth/session straight afterwards, which is what proves the cookie
     * actually reached the jar and will be sent again after the process is killed.
     *
     *   200 -> Set-Cookie: ts_worker, absorbed by the choke point like any other
     *   401 {"error":"invalid_code"}   EVERY other outcome — unknown, wrong, expired, the
     *       five attempts spent — byte-identical, deliberately (mirrors [enrol]'s own note)
     *   429 {"error":"too_many_attempts"}
     *   503 {"error":"sms_not_configured"}
     *
     * @param code the 6 digits as typed. There is no EnrolmentCode-style normaliser for an
     *        OTP: it has no alphabet to alias (decision-48 §6's own reasoning — digits only,
     *        copied off a notification, never spoken aloud) so the screen strips non-digits
     *        itself before this is called.
     */
    suspend fun smsVerify(phone: String, code: String) {
        post("/auth/sms/verify", SmsVerifyBody(phone, code).toJson(), sessionBearing = false)
    }

    /**
     * GET /roster -> the locations that resolve, plus the zones riding along additively
     * (decision-44). The `workers` array is deliberately not read (decision-22).
     */
    suspend fun roster(): WireRoster = Wire.roster(get("/roster"))

    /**
     * GET /app/version — auth: "app" only, no session (server/routes/release.js). This
     * is the ONE call in this class that must survive an expired or missing worker
     * session: a phone whose session just died is exactly the phone that most needs to
     * know a fix is already out. `sessionBearing = false`: a 401 here means a bad or
     * missing X-App-Key, never an expired session, and firing [onSessionRejected] over
     * it would wrongly sign a worker out of a route their session was never checked
     * against.
     */
    suspend fun appVersion(): JSONObject = get("/app/version", sessionBearing = false)

    // ---- operator: the person who mounts tags --------------------------------------
    //
    // These two are reached through a SEPARATE Api instance holding a SEPARATE cookie jar
    // (`ts_operator`, TimeSheetsApplication.operatorApi). Nothing below opens or closes a
    // shift, and server-side nothing reachable with an operator session can — there is no
    // route under /shifts/* with auth: "operator" (server/routes/operator.js, decision-45).

    /**
     * POST /auth/operator-code — redeem an admin-issued operator enrolment code. auth: "app",
     * so `sessionBearing = false` for the same reason as /auth/code: its 401 means "that is
     * not a valid code", never "your session died", and firing [onSessionRejected] over it
     * would sign someone out of a session this route never looked at.
     */
    suspend fun operatorEnrol(code: String) {
        post("/auth/operator-code", EnrolmentRequest(code).toJson(), sessionBearing = false)
    }

    /**
     * POST /operator/tags {id} — "a tag carrying this id now physically exists".
     *
     * CALLED ONLY AFTER A VERIFIED WRITE. The id is on a card, in a building, before this
     * request is made; the request is how the office finds out. That ordering is why the
     * failure of this call is survivable and must be retried rather than treated as a failed
     * write — the card is fine, the office just does not know yet.
     *
     * Idempotent server-side (ON CONFLICT DO NOTHING + read-back), so a retry over field wifi
     * lands exactly one row. 201 new · 200 already reported · 409 id_in_use.
     */
    suspend fun reportTag(locationId: String): JSONObject =
        post("/operator/tags", JSONObject().put("id", locationId).toString()).getJSONObject("tag")

    /**
     * GET /operator/zones -> the worklist: every active zone this operator might be
     * asked to prove, plus the serial each carries so an adopted, URL-less card can be
     * matched CLIENT-SIDE (decision-44's pin — no serial travels to the server — holds
     * here byte for byte). Raw JSONObject, like the material-request calls below: the
     * caller (nfc/OperatorZoneCache) persists these exact bytes so the picker still works
     * with no signal, in the stairwell where the card actually is.
     */
    suspend fun operatorZones(): JSONObject = get("/operator/zones")

    /**
     * POST /operator/zones/:id/verify {place_uuid} -> "this card resolves to this zone;
     * the zone is now a clock-in target" (decision-47).
     *
     * CANNOT OPEN A SHIFT. Like every call in this section this goes out over whichever
     * [Api] instance the caller built it on — TimeSheetsApplication wires this class to
     * `operatorApi`, which carries `ts_operator`, and no route that touches a shift
     * accepts that cookie. There is no credential here with which to open one.
     *
     *   200 verified            {zone: {..., already_verified}}
     *   404 unknown_zone        :id is not an ACTIVE zone of an ACTIVE building
     *   422 zone_mismatch       the card resolved to a different zone, or to a BUILDING
     *   422 tag_unbound         the card was reported but no admin has resolved it yet
     *   422 unknown_location    the card is not ours, or its zone/building is inactive
     */
    suspend fun verifyZone(zoneId: String, placeUuid: String): WireZoneVerifyResult =
        Wire.zoneVerifyResult(
            post("/operator/zones/$zoneId/verify", VerifyZoneRequest(placeUuid).toJson())
                .getJSONObject("zone"),
        )

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

    // ---- material requests --------------------------------------------------------
    //
    // THESE THREE RETURN RAW JSON, unlike everything above, and that is deliberate:
    // data/MaterialStore.kt caches the server's bytes verbatim so a field the server adds
    // later needs no client migration. Wire.materialRequest() is what turns them into a
    // type, and the store calls it before it writes.
    //
    // ALL THREE ARE OPTIONAL TO THE PRODUCT. A server without them answers 404
    // {"error":"not_found"}, which MaterialQueue.outcome() reads as "not deployed yet"
    // and NOT as a rejection. Nothing here is on the clock-in path.

    /**
     * POST /material-requests {body, location_uuid?} -> 201 {request}.
     * decision-22: no worker field, here or in [CreateMaterialRequest].
     */
    suspend fun createMaterialRequest(body: String, locationId: String?): JSONObject =
        post("/material-requests", CreateMaterialRequest(body, locationId).toJson())
            .getJSONObject("request")

    /**
     * GET /material-requests/mine -> this session's worker only, newest first. There is
     * no ?worker= and there must never be one.
     */
    suspend fun myMaterialRequests(): List<JSONObject> {
        val array = get("/material-requests/mine").getJSONArray("requests")
        return (0 until array.length()).map { array.getJSONObject(it) }
    }

    /**
     * POST /material-requests/:id/seen — "I have read that it arrived". Idempotent
     * server-side (COALESCE keeps the FIRST acknowledgement), so a double tap does not
     * rewrite when the worker actually found out.
     */
    suspend fun markMaterialRequestSeen(id: Int): JSONObject =
        post("/material-requests/$id/seen", "{}").getJSONObject("request")

    // ---- transport ----------------------------------------------------------------

    private suspend fun get(path: String, sessionBearing: Boolean = true): JSONObject =
        send("GET", path, null, sessionBearing)

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
                attachPendingHeaders(this)
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

    /**
     * WHAT THIS PHONE IS STILL HOLDING, told to the office for free (TASK-225).
     *
     * A shift that never reached the server is invisible to everyone: no row, no 8h net, no
     * payroll line, and no way for a director to tell a cleaner who was off sick from a
     * phone that has been in a pocket in a basement for three days. These three headers are
     * the cheap half of that problem, and they are HEADERS and not a new endpoint for three
     * reasons that all matter:
     *
     *   - no extra round trip, therefore nothing new on the clock-in path. The numbers ride
     *     on requests the app already makes.
     *   - AN OLDER SERVER IGNORES THEM. Unknown request headers are dropped, silently, by
     *     every HTTP server there is. So an app newer than the box degrades to exactly
     *     today's behaviour instead of failing — no version negotiation, no feature flag.
     *   - the values are read from an in-memory cache (ShiftStore.pendingSummary), so this
     *     is a field read and not a query.
     *
     * NEVER THROWS. A header is a nicety; a clock-in is not. Anything that goes wrong here
     * costs the office a number, and must not cost a cleaner a shift.
     */
    private fun attachPendingHeaders(connection: HttpURLConnection) {
        runCatching {
            val summary = pending()
            connection.setRequestProperty("X-Pending-Shifts", summary.waiting.toString())
            connection.setRequestProperty("X-Pending-Blocked", summary.blocked.toString())
            // Omitted, not sent empty, when there is nothing pending: "" would have to be
            // parsed into a null on the far side, and a header that is absent says the same
            // thing without anybody writing that parser.
            summary.oldestStart?.let { connection.setRequestProperty("X-Pending-Oldest", Wire.string(it)) }
        }
    }

    private companion object {
        const val TIMEOUT_MS = 15_000
    }
}
