package io.github.qwadratic.nfctimesheets.data

import android.content.Context
import io.github.qwadratic.nfctimesheets.core.WireWorker

/**
 * Worker id + name from the last successful GET /auth/session.
 *
 * ponytail: plain SharedPreferences, not encrypted storage. NONE OF THIS IS A SECRET —
 * the credential is the ts_worker cookie (net/CookieJar.kt). This exists so a launch in a
 * basement opens straight into the app instead of a sign-in screen that cannot reach the
 * server. CEILING: it can be stale for one launch if the admin deactivates someone while
 * their phone is offline; GET /auth/session corrects it the moment there is signal, and
 * the server rejects every write in between (requireWorkerSession re-checks `active` on
 * every request). UPGRADE PATH: none needed.
 *
 * IT IS A CACHE, NOT AN IDENTITY. Nothing derived from it is ever sent to the server
 * (decision-22); it stamps local rows and it fills a name on screen.
 */
class WorkerCache(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("session", Context.MODE_PRIVATE)

    fun read(): WireWorker? {
        val id = prefs.getInt(KEY_ID, 0)
        if (id <= 0) return null
        return WireWorker(id = id, name = prefs.getString(KEY_NAME, "").orEmpty())
    }

    fun write(worker: WireWorker) {
        prefs.edit().putInt(KEY_ID, worker.id).putString(KEY_NAME, worker.name).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_ID).remove(KEY_NAME).apply()
    }

    private companion object {
        const val KEY_ID = "worker_id"
        const val KEY_NAME = "worker_name"
    }
}
