package io.github.qwadratic.nfctimesheets.nfc

import android.content.Context
import io.github.qwadratic.nfctimesheets.core.WriteGuard

/**
 * The one physical fact this app must never lose: a tag WAS WRITTEN and the server does not
 * know yet.
 *
 * BEFORE THIS CLASS EXISTED, that fact lived only in [WriteTagActivity]'s `mutableStateOf`
 * fields — `outcome` and `report` — which `onCreate` re-initialises to nothing on every
 * fresh process. A process the OS kills routinely for memory, and that an operator's own
 * "swipe the app away" does too: the write itself already happened and is not lost — the
 * card is correctly written and verified by the time this class is ever consulted — but the
 * ONLY thing that told the operator "retry the report" was lost, and with it the only signal
 * that a physically-written card is not yet in `reported_tags`. It then sits on a wall,
 * unbound, until someone at a desk notices the count does not match.
 *
 * SharedPreferences, same idiom and reasoning as net/CookieJar.kt: written to disk, so it
 * survives a killed process; a field would not. `commit()`, not `apply()` — for the same
 * reason CookieJar gives: a write that exists only in flight is lost at exactly the moment
 * this class exists for, i.e. the process dying before the async write lands.
 *
 * Holds AT MOST ONE pending write, because [WriteTagActivity] only ever has one write in
 * flight — the one on screen. [WriteTagActivity.pendingId] is only replaced with a fresh
 * uuid once a report succeeds, so a second, DIFFERENT unreported write can never exist here
 * to be confused with this one; [save] overwriting a stale record is therefore always the
 * same card being retried, never two different cards colliding.
 */
class PendingTagReport(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Record a write the moment it verifies — BEFORE the report is even attempted. */
    fun save(written: TagWriter.Outcome.Written) {
        prefs.edit()
            .putString(KEY_LOCATION_ID, written.locationId)
            .putString(KEY_URI, written.uri)
            .putString(KEY_SERIAL, written.serial)
            .putInt(KEY_BYTES, written.bytes)
            .putInt(KEY_CAPACITY, written.capacity)
            // WHAT THIS CARD REPLACED, kept across the process death too. A card written
            // over a card that already carried one of our ids is the one case where the
            // office may have to go and look at a wall; a restored screen that says the
            // card was blank would be the app quietly forgetting the only interesting
            // thing about it.
            .putString(KEY_REPLACED_KIND, kindOf(written.replaced))
            .putString(KEY_REPLACED_DETAIL, detailOf(written.replaced))
            .commit()
    }

    /** The card the server still does not know about, or null — nothing pending, or reported. */
    fun pending(): TagWriter.Outcome.Written? {
        val locationId = prefs.getString(KEY_LOCATION_ID, null) ?: return null
        val uri = prefs.getString(KEY_URI, null) ?: return null
        val serial = prefs.getString(KEY_SERIAL, null) ?: return null
        return TagWriter.Outcome.Written(
            locationId = locationId,
            uri = uri,
            serial = serial,
            bytes = prefs.getInt(KEY_BYTES, -1),
            capacity = prefs.getInt(KEY_CAPACITY, -1),
            replaced = replaced(),
        )
    }

    private fun replaced(): WriteGuard.Existing {
        val detail = prefs.getString(KEY_REPLACED_DETAIL, "").orEmpty()
        return when (prefs.getString(KEY_REPLACED_KIND, KIND_BLANK)) {
            KIND_OURS -> WriteGuard.Existing.Ours(detail)
            KIND_FOREIGN -> WriteGuard.Existing.Foreign(detail)
            else -> WriteGuard.Existing.Blank
        }
    }

    /** The server now knows. Same commit()-not-apply() reasoning as [save]. */
    fun clear() {
        prefs.edit().clear().commit()
    }

    private companion object {
        fun kindOf(existing: WriteGuard.Existing): String = when (existing) {
            is WriteGuard.Existing.Ours -> KIND_OURS
            is WriteGuard.Existing.Foreign -> KIND_FOREIGN
            WriteGuard.Existing.Blank -> KIND_BLANK
        }

        fun detailOf(existing: WriteGuard.Existing): String = when (existing) {
            is WriteGuard.Existing.Ours -> existing.locationId
            is WriteGuard.Existing.Foreign -> existing.summary
            WriteGuard.Existing.Blank -> ""
        }

        const val FILE = "pending_tag_report"
        const val KEY_LOCATION_ID = "location_id"
        const val KEY_URI = "uri"
        const val KEY_SERIAL = "serial"
        const val KEY_BYTES = "bytes"
        const val KEY_CAPACITY = "capacity"
        const val KEY_REPLACED_KIND = "replaced_kind"
        const val KEY_REPLACED_DETAIL = "replaced_detail"
        const val KIND_BLANK = "blank"
        const val KIND_OURS = "ours"
        const val KIND_FOREIGN = "foreign"
    }
}
