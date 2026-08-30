package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.Zones

/**
 * ADOPTED TAGS — third-party tags already stuck to walls, matched by hardware serial.
 *
 * WHY THIS EXISTS. The normal tag is one we wrote: it holds
 * `https://<host>/t?l=<location-uuid>`, the OS reads that URL and launches the app with no
 * interaction at all. That is the product. But a building can already carry a tag from some
 * previous system, and pulling it off the wall to replace it costs a site visit. The first
 * real example holds a single `application/ase.mobile` record whose entire payload is the
 * byte 0x31 — no URL, nothing we can route on. Its NDEF capacity is 46 bytes and our URL
 * needs about 64, so it CANNOT be rewritten to carry ours even though it is unlocked.
 *
 * So the tag is identified by the only stable thing it has: its serial number.
 *
 * WHAT YOU GIVE UP, and it is not small. A tag with no URL cannot wake a closed app — there
 * is no universal link for the OS to match, and no amount of app-side code changes that.
 * An adopted tag therefore ONLY works through the in-app Scan screen: the worker opens the
 * app and presses Scan. The passive "hold the phone to the wall with the app closed" flow,
 * which is the entire appeal of the product, does not apply to these tags.
 *
 * CEILING. This map is compiled into the app, so adopting another tag means a new build and
 * a new release to every phone. That is acceptable for one tag and absurd for twenty.
 *
 * UPGRADE PATH, in the order it should be taken:
 *   1. Serve the mapping from the API (a `tag_serials` table beside `locations`, fetched
 *      with the roster) so adoption becomes an admin action instead of a release.
 *   2. Better: replace adopted tags with NTAG213 during a normal cleaning round and delete
 *      this file. Passive tap comes back and the special case disappears.
 *
 * SECURITY. A serial is NOT a secret: it is broadcast unencrypted to any reader, and on many
 * tag families it can be cloned outright. This is exactly as trustworthy as the URL on our
 * own tags, which is to say not at all — decision-15 already assumes tags are unlocked and
 * attacker-writable, and the server validates the location and derives the worker from the
 * session on every clock-in. Nothing here is a new trust assumption. It must never become
 * one: do not let a serial authenticate anything.
 *
 * NOT DELETED THIS PHASE, even though it is currently EMPTY. decision-44 names this file's
 * deletion condition precisely: only once a zone in the database actually carries an adopted
 * serial AND that has been verified on the wire, never against a design document alone.
 * `nfc/ScanActivity.kt` now tries the roster-cached zone table FIRST
 * (`core/Zones.zonePlaceIdForSerial`) and falls back to [BY_SERIAL] only when the roster has
 * no answer, exactly as decision-37's retained consequence requires: "KnownTags.BY_SERIAL
 * stays as a compiled last-resort fallback... with roster-supplied serials taking priority."
 *
 * The table's one entry — a HOIV building serial, mapped to that BUILDING's own uuid — was
 * removed alongside decision-47's HOIV grandfather clause (decision-69): the owner confirmed
 * that physical card was never actually deployed in the field, so nothing is stranded by
 * emptying the table, and the entry could never have resolved a real tap again anyway —
 * `activePlace` no longer has a building branch at all, so a BUILDING uuid 422s regardless of
 * which route named it. A future adopted tag is added here the same way: serial -> the UUID
 * of whatever it should resolve to, which from now on must always be a ZONE, never a building.
 */
object KnownTags {

    /** Serial (uppercase hex, colon-separated, as printed by any reader) -> location UUID. */
    private val BY_SERIAL: Map<String, String> = mapOf()

    /**
     * Location UUID for a tag serial, or null when the serial is unknown — which is the
     * normal case and never an error. Input is normalised so a caller may pass any casing
     * or separator style ("04a1a852ae5c80", "04-a1-a8-...") through [Zones.normaliseSerial]
     * — ONE copy of this rule, not a second hand-written one drifting beside it.
     */
    fun locationIdFor(serial: String?): String? {
        val normalised = Zones.normaliseSerial(serial) ?: return null
        return BY_SERIAL[normalised]
    }
}
