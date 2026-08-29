package io.github.qwadratic.nfctimesheets.data

import android.content.Context
import io.github.qwadratic.nfctimesheets.core.AppVersionGate

/**
 * The last app versionCode this phone successfully booted as (decision-62 §1).
 *
 * ponytail: plain SharedPreferences holding ONE Int. CEILING: it answers exactly one
 * question, once per process, at startup. UPGRADE PATH: none needed — if a future
 * invalidation ever has to be per-store rather than per-app, that is a different key in
 * this same file, not a mechanism.
 *
 * WHAT IT IS NOT ALLOWED TO REACH is the point of decision-62 and is enforced by the
 * caller, `TimeSheetsApplication.onCreate`: the session cookie, any pending offline WRITE
 * (a queued shift, a pending tag report, a queued material request) and the SQLite schema
 * are never touched by a version bump. Those are not re-derivable from the server — a
 * blanket wipe on every release would silently throw away work a cleaner has already done
 * and force a re-enrolment that needs a code from the office. Only cached READS go.
 */
class CacheVersion(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * Reads the stored versionCode, records [current] over it, and answers whether this is
     * the first launch after an update. See [AppVersionGate.invalidatesCaches] for the
     * three cases; the decision lives there because it is testable there.
     *
     * The write is unconditional and `commit()`, not `apply()`: this runs once, on the main
     * thread, in `Application.onCreate`, writing four bytes — and a process killed between
     * the read and an async write would re-invalidate on the next launch for ever. It is a
     * loop that would be invisible (every launch just refetches, which looks like working).
     */
    fun bumpAndCheck(current: Int): Boolean {
        val lastSeen = if (prefs.contains(KEY)) prefs.getInt(KEY, current) else null
        prefs.edit().putInt(KEY, current).commit()
        return AppVersionGate.invalidatesCaches(lastSeen, current)
    }

    private companion object {
        const val PREFS = "app-version"
        const val KEY = "last_version_code"
    }
}
