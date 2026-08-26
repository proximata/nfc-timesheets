package io.github.qwadratic.nfctimesheets

import android.app.Application
import io.github.qwadratic.nfctimesheets.core.SessionCookie
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.nfc.OperatorZoneCache
import io.github.qwadratic.nfctimesheets.nfc.PendingTagReport
import io.github.qwadratic.nfctimesheets.nfc.TagWriter
import io.github.qwadratic.nfctimesheets.data.MaterialStore
import io.github.qwadratic.nfctimesheets.data.MaterialSync
import io.github.qwadratic.nfctimesheets.data.ShiftStore
import io.github.qwadratic.nfctimesheets.data.ShiftSync
import io.github.qwadratic.nfctimesheets.data.WorkerCache
import io.github.qwadratic.nfctimesheets.net.Api
import io.github.qwadratic.nfctimesheets.net.CookieJar
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
     * `onSessionRejected` is a no-op rather than [sessionRejected]: a 401 from the tag-write
     * screen means the OPERATOR session died. Latching the worker flag over it would sign a
     * cleaner out of a running shift because somebody wrote a tag — the two identities must
     * not be able to knock each other over.
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
    val operatorApi: Api by lazy { Api(operatorCookies, { /* not the worker's session */ }) }

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

    val sync: ShiftSync by lazy { ShiftSync(api, store) }

    /**
     * Material requests. A SEPARATE database file from [store] — see MaterialStore's
     * header. `by lazy` matters here: a phone that never opens the material tab never
     * even creates the file, so a feature that is not the product costs a clock-in
     * nothing.
     */
    val materials: MaterialStore by lazy { MaterialStore(this) }

    val materialSync: MaterialSync by lazy { MaterialSync(api, materials) }
}
