package io.github.qwadratic.nfctimesheets

import android.app.Application
import io.github.qwadratic.nfctimesheets.core.SessionCookie
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.nfc.OperatorZoneCache
import io.github.qwadratic.nfctimesheets.nfc.PendingTagReport
import io.github.qwadratic.nfctimesheets.nfc.TagWriter
import io.github.qwadratic.nfctimesheets.data.CacheVersion
import io.github.qwadratic.nfctimesheets.data.FlagCache
import io.github.qwadratic.nfctimesheets.data.MaterialStore
import io.github.qwadratic.nfctimesheets.data.MaterialSync
import io.github.qwadratic.nfctimesheets.data.ShiftStore
import io.github.qwadratic.nfctimesheets.data.ShiftSync
import io.github.qwadratic.nfctimesheets.data.WorkerCache
import io.github.qwadratic.nfctimesheets.net.Api
import io.github.qwadratic.nfctimesheets.net.CookieJar
import io.github.qwadratic.nfctimesheets.net.OperatorSession
import io.github.qwadratic.nfctimesheets.net.PrefsCookieJar
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Object graph. Eight objects, constructed by hand.
 *
 * ponytail: no Hilt, no Koin. CEILING: this is the size at which hand-wiring stops being
 * obviously cheaper — the next collaborator with its own lifecycle is the point to
 * reconsider. UPGRADE PATH: whatever DI arrives constructs the same objects; nothing
 * below is a framework type.
 */
class TimeSheetsApplication : Application() {

    /**
     * AN UPDATE INVALIDATES CACHED SERVER READS, AND NOTHING ELSE (decision-62).
     *
     * The bug this closes is real and was hit twice: this app's operator gate served a
     * cached worklist that outlived a server-side DB wipe, and iOS had the same shape with
     * a stale flag (TASK-276). The owner asked for "delete local app data and refetch";
     * what is implemented is the narrower, standard thing, because a blanket wipe would
     * take the un-syncable state with it — a queued shift tapped in a basement, a tag
     * report written offline, a queued material request, and the session cookie, which
     * cannot be re-derived and whose loss costs a fresh enrolment code from the office.
     *
     * WHAT IS DROPPED HERE: the cached operator worklist, and only it. It is the one cached
     * READ in this app that is not already re-fetched on every launch — VerifyZoneActivity
     * shows it as an offline pre-fill and then always re-fetches, so an operator who is
     * ONLINE never notices this line ran, and one who is offline on the first open after an
     * update sees an empty picker instead of a list that may describe zones the server no
     * longer has. `clear()` is the same call net/OperatorSession makes on a 401, and the
     * refill is the same GET /operator/zones the screen already makes.
     *
     * WHAT IS ALREADY TRUE AND SO IS NOT REPEATED HERE: the roster snapshot
     * (GET /roster) and the flag map (GET /flags) are re-fetched unconditionally on EVERY
     * launch, by TimeSheetViewModel.restoreSession -> refresh(), which is the same call
     * pull-to-refresh makes. A version bump therefore cannot show a stale one, and
     * DELETING them here would be strictly worse: the refetch swallows network failure by
     * design, so a phone that updates and is then opened in a basement would lose the
     * building names and the zone/serial map it needs to resolve a card, in exchange for
     * nothing. decision-62's own title is refetch beats reset.
     *
     * WHAT IS DELIBERATELY NOT TOUCHED: `cookies`, `operatorCookies`, `store` (the shift
     * table is this phone's own WRITE log, not a cached read), `materials`,
     * `pendingTagReport`, and the SQLite schema — which keeps using its ordinary versioned
     * migration path, as decision-62 §2 requires.
     *
     * Constructing `operatorZones` here does defeat its `by lazy` on a cleaner's phone,
     * but only on the ONE launch after an update, and only to open a SharedPreferences
     * file and remove a key.
     */
    override fun onCreate() {
        super.onCreate()
        if (CacheVersion(this).bumpAndCheck(BuildConfig.VERSION_CODE)) {
            operatorZones.clear()
        }
    }

    /**
     * Parses tag URIs against THIS build's host, and ONLY this build's host — no legacy
     * widening (decision-40's amendment). The API base stays TAG_HOST alone regardless.
     */
    val tagLink: TagLink by lazy { TagLink(BuildConfig.TAG_HOST) }

    val cookies: CookieJar by lazy { PrefsCookieJar(this) }

    val store: ShiftStore by lazy { ShiftStore(this) }

    /** Last known worker, so a cold launch in a basement opens the app, not a login. */
    val workers: WorkerCache by lazy { WorkerCache(this) }

    /**
     * Set from the choke point in Api on ANY 401 and observed by the ViewModel, which
     * drops the UI to signed-out immediately.
     *
     * A flow and not a plain flag (parity row 4): the flag version was only ever READ at
     * the end of refresh(), so a 401 arriving from the material sync, a resolve or a
     * logout sat there unnoticed until the next refresh - the worker kept using an app
     * whose session the server had already thrown away. iOS has always posted this
     * immediately from its single send() choke point; this is Android catching up.
     */
    val sessionRejected = MutableStateFlow(false)

    /**
     * `pending = store::pendingSummary` is the ONLY new wire here (TASK-225): every request
     * this app already makes carries the X-Pending-* headers, so the office learns what this
     * phone is still holding without a new endpoint and without a second round trip. It is a
     * cached field read — see ShiftStore.pendingSummary — so nothing on the tap path got
     * slower, and Api swallows any failure of it rather than letting a header cost a shift.
     */
    val api: Api by lazy { Api(cookies, { sessionRejected.value = true }, store::pendingSummary) }

    /**
     * THE OPERATOR SIDE, DELIBERATELY A SECOND EVERYTHING.
     *
     * A second cookie jar (`ts_operator`, its own SharedPreferences file) behind a second
     * [Api]. Not a second cookie in the same jar, and not a role flag on the first one: an
     * operator does not clock in (decision-45), and the way to make that true is for no
     * request the operator's screen makes to be capable of carrying a worker cookie. There
     * is no request in this app that sends both.
     *
     * `onSessionRejected` goes to [operatorSession] and NEVER to [sessionRejected]: a 401 from
     * the tag-write screen means the OPERATOR session died. Latching the worker flag over it
     * would sign a cleaner out of a running shift because somebody wrote a tag — the two
     * identities must not be able to knock each other over. It was a no-op until TASK-401,
     * which is why a phone whose operator session the server had deleted kept showing a
     * signed-in gate over a stale worklist for ever; see net/OperatorSession.kt.
     *
     * `by lazy`: a cleaner's phone never constructs any of it.
     */
    val operatorCookies: CookieJar by lazy {
        PrefsCookieJar(this, SessionCookie.OPERATOR_NAME, file = "operator-session")
    }

    // No `pending` argument on purpose: it defaults to "nothing pending", which is TRUE of
    // an operator — an operator does not clock in (decision-45) and has no shift queue. The
    // worker's count must not ride on the operator's cookie; the two identities do not share
    // a jar and they do not share a heartbeat either.
    val operatorApi: Api by lazy { Api(operatorCookies, operatorSession::reject) }

    /**
     * The operator gate's state, and the ONE place a 401 on `ts_operator` is acted on.
     * Clears the cached worklist with the cookie: neither belongs to a session the server
     * has already refused.
     */
    val operatorSession: OperatorSession by lazy {
        OperatorSession(operatorCookies) { operatorZones.clear() }
    }

    /** Encodes and verifies the bytes that go onto a physical card. See nfc/TagWriter.kt. */
    val tagWriter: TagWriter by lazy { TagWriter(tagLink) }

    /**
     * The operator's zone worklist, cached for the stairwell (decision-47). `by lazy`:
     * a cleaner's phone never opens the verify screen and never creates this file.
     */
    val operatorZones: OperatorZoneCache by lazy { OperatorZoneCache(this) }

    /**
     * The one fact WriteTagActivity must not lose to a killed process: a card is written
     * and the server does not know yet. See nfc/PendingTagReport.kt.
     */
    val pendingTagReport: PendingTagReport by lazy { PendingTagReport(this) }

    /** decision-57 §1: the last GET /flags answer. Paints a screen, gates nothing. */
    val flags: FlagCache by lazy { FlagCache(this) }

    val sync: ShiftSync by lazy { ShiftSync(api, store, flags) }

    /**
     * Material requests. A SEPARATE database file from [store] — see MaterialStore's
     * header. `by lazy` matters here: a phone that never opens the material tab never
     * even creates the file, so a feature that is not the product costs a clock-in
     * nothing.
     */
    val materials: MaterialStore by lazy { MaterialStore(this) }

    val materialSync: MaterialSync by lazy { MaterialSync(api, materials) }
}
