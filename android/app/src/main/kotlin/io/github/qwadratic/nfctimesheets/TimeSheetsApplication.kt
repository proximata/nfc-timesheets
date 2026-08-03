package io.github.qwadratic.nfctimesheets

import android.app.Application
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.data.ShiftStore
import io.github.qwadratic.nfctimesheets.data.ShiftSync
import io.github.qwadratic.nfctimesheets.data.WorkerCache
import io.github.qwadratic.nfctimesheets.net.Api
import io.github.qwadratic.nfctimesheets.net.CookieJar
import io.github.qwadratic.nfctimesheets.net.PrefsCookieJar

/**
 * Object graph. Six objects, constructed by hand.
 *
 * ponytail: no Hilt, no Koin. CEILING: adding a seventh collaborator with its own
 * lifecycle is the point to reconsider. UPGRADE PATH: whatever DI arrives constructs the
 * same objects; nothing below is a framework type.
 */
class TimeSheetsApplication : Application() {

    /** Parses tag URIs against THIS build's host (branding.properties -> BuildConfig). */
    val tagLink: TagLink by lazy { TagLink(BuildConfig.TAG_HOST) }

    val cookies: CookieJar by lazy { PrefsCookieJar(this) }

    val store: ShiftStore by lazy { ShiftStore(this) }

    /** Last known worker, so a cold launch in a basement opens the app, not a login. */
    val workers: WorkerCache by lazy { WorkerCache(this) }

    /**
     * Set from the choke point in Api on any 401 and read by the ViewModel, which drops
     * the UI to signed-out. A plain flag rather than a broadcast: there is exactly one
     * reader and it checks on every operation anyway.
     */
    @Volatile
    var sessionRejected: Boolean = false

    val api: Api by lazy { Api(cookies) { sessionRejected = true } }

    val sync: ShiftSync by lazy { ShiftSync(api, store) }
}
