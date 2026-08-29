package io.github.qwadratic.nfctimesheets.nfc

import android.content.Context
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone
import org.json.JSONObject

/**
 * The last successful GET /operator/zones answer, verbatim.
 *
 * WHY THIS EXISTS. Picking a zone off the worklist is the first step of the test scan
 * (decision-47 §6.4), and it has to work with the card already in hand: an operator
 * standing in a stairwell in front of the door they just mounted a card at is exactly the
 * phone with no signal, and a picker that needs a fresh network round trip to open is a
 * picker that cannot be used at the one moment it is needed. `GET /roster`
 * (data/ShiftStore.kt) already caches for the same reason; this is that idiom applied to
 * the operator side.
 *
 * RAW BYTES, NOT A RE-SERIALISED LIST. The envelope is stored exactly as the server sent
 * it and re-parsed with the SAME [Wire.operatorZones] the live call uses, so there is no
 * second hand-written encoder to drift out of step with the decoder — the scar
 * `core/Wire.kt`'s own header names for a camelCase reinvention of the wire contract.
 *
 * A STALE LIST IS A LABEL, NEVER A GATE. Nothing downstream trusts `verifiedAt` read from
 * here for anything but display: the verify call itself always resolves the card through
 * the live server (`v.activePlace`), so a cache that is a day old can show the wrong
 * status text but can never stamp the wrong zone or skip a check.
 */
class OperatorZoneCache(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("operator_zones", Context.MODE_PRIVATE)

    /** Persist the exact envelope just fetched. */
    fun write(envelope: JSONObject) {
        prefs.edit().putString(KEY, envelope.toString()).apply()
    }

    /** The last cached worklist, oldest first (server order), or empty if never fetched. */
    fun read(): List<WireOperatorZone> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return runCatching { Wire.operatorZones(JSONObject(raw)) }.getOrDefault(emptyList())
    }

    /**
     * Forget it. Called from net/OperatorSession on a 401: a worklist fetched with a session
     * the server has thrown away must not outlive the cookie that fetched it — it may be
     * another operator's zones, and the next sign-in refetches in one request anyway.
     */
    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "zones_json"
    }
}
