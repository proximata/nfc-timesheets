package io.github.qwadratic.nfctimesheets.nfc

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
 */
object KnownTags {

    /**
     * Serial (uppercase hex, colon-separated, as printed by any reader) -> location UUID.
     *
     * 04:A1:A8:52:AE:5C:80 is the Mifare Ultralight EV1 already mounted at HOIV,
     * Arsenalstraße 11 (slug `hoiv-arsenalstrasse-11`). Verified against production on
     * 2026-08-11; the location row is active.
     */
    private val BY_SERIAL: Map<String, String> = mapOf(
        "04:A1:A8:52:AE:5C:80" to "c3c37d4a-ca0a-42c5-b248-9704b9907ec7",
    )

    /**
     * Location UUID for a tag serial, or null when the serial is unknown — which is the
     * normal case and never an error. Input is normalised so a caller may pass any casing
     * or separator style ("04a1a852ae5c80", "04-a1-a8-...").
     */
    fun locationIdFor(serial: String?): String? {
        if (serial.isNullOrBlank()) return null
        val normalised = serial
            .uppercase()
            .filter { it.isDigit() || it in 'A'..'F' }
            .chunked(2)
            .joinToString(":")
        return BY_SERIAL[normalised]
    }
}
