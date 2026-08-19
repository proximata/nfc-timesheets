package io.github.qwadratic.nfctimesheets

import android.app.Application
import io.github.qwadratic.nfctimesheets.core.TagLink
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
     * Parses tag URIs against THIS build's host, plus the hosts we once wrote onto tags
     * that are still on walls (branding.properties -> BuildConfig). The API base stays
     * TAG_HOST alone: a legacy host is a string on a tag, never somewhere we talk to.
     */
    val tagLink: TagLink by lazy { TagLink(BuildConfig.TAG_HOST, BuildConfig.LEGACY_TAG_HOSTS.toList()) }

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

    val api: Api by lazy { Api(cookies) { sessionRejected.value = true } }

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
