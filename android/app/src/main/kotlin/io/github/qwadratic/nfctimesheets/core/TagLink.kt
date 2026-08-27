package io.github.qwadratic.nfctimesheets.core

import java.net.URI
import java.net.URLDecoder

/**
 * The NFC tag carries an App Link, never a hardware UID (decision-5):
 *
 *     https://<ts.tagHost>/t?l=<location uuid>
 *
 * The host is deliberately NOT spelled out here. It is typed once, in
 * android/branding.properties, and a second copy in source is how an App Link silently
 * stops matching the tags already glued to the walls. android/checks fails on any
 * occurrence of the live host anywhere under app/src.
 *
 * Byte-for-byte the same URI the iOS app already reads off those tags. Zero tag rewrites. This is a direct port of NFCTimeSheets/NFCTimeSheets/TagLink.swift and
 * the negative cases in NFCTimeSheets/checks/tag-link-check.swift are ported verbatim
 * into android/checks/core-check.kt.
 *
 * The identifier is a UUID and NOT the human-readable slug (decision-21): the slug is
 * guessable and a guessable id on a tag lets anyone enumerate every building the company
 * cleans. The slug must never appear in a tag URI.
 *
 * `host` is a constructor argument, not a constant, for two reasons: it comes from the
 * white-label surface (BuildConfig.TAG_HOST <- branding.properties), and it keeps this
 * file free of every Android import so the check can compile and run it on a plain JVM.
 *
 * EXACTLY ONE HOST, EVER. There used to be a `legacyHosts` widening here for tags written
 * under an older host string; it is gone on purpose — see decision-40's amendment removing
 * the legacy-host allowance. Whatever `ts.tagHost` names is the only host this class will
 * ever accept. A card carrying any other host, past or future, is not one of ours until it
 * is rewritten.
 *
 * https only, our exact path, a canonical uuid, and authority compared with URI.getHost() so
 * userinfo tricks still lose. Tags are unlocked (decision-15).
 */
class TagLink(host: String) {
    private val host = host.lowercase()

    /**
     * Location UUID carried by a tag link, lowercased. `null` = not one of our tags.
     *
     * TRUST BOUNDARY. Tags are left UNLOCKED as migration insurance (decision-15), so
     * anyone with a phone can rewrite one to carry whatever they like — a different
     * host, a slug, a SQL fragment, a link to their own server. Nothing that is not a
     * well-formed UUID on our exact host over https ever reaches the wire.
     */
    fun locationId(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            return null // malformed input off an attacker-writable tag; drop it
        }

        if (uri.scheme?.lowercase() != "https") return null
        // URI.getHost() strips any userinfo, so https://<our host>@evil.example.com/t
        // compares as "evil.example.com" and is rejected. Never switch this to a string
        // prefix test — that is the whole trick.
        if (uri.host?.lowercase() != host) return null

        // The server serves both /t and /t/ rather than redirecting (a redirect breaks
        // the App-Link/universal-link handoff), so accept both here too.
        var path = uri.path ?: return null
        if (path.length > 1 && path.endsWith("/")) path = path.dropLast(1)
        if (path != PATH) return null

        return normalizedUuid(queryValue(uri.rawQuery, "l"))
    }

    /**
     * WHY A CARD DID NOT RESOLVE — for OPERATOR ERROR COPY ONLY (decision-58 §1).
     *
     * [locationId] collapses every failure into one null, which is right at a trust boundary
     * and useless at a door: "wrong host" (an iPhone still on an old build, TASK-188) and
     * "nothing parseable at all" need different next actions from the person holding the card.
     * This names which happened. It decides NOTHING — every caller that acts on a card still
     * goes through [locationId], unchanged.
     */
    fun diagnose(raw: String?): Diagnosis {
        locationId(raw)?.let { return Diagnosis.Found(it) }
        if (raw.isNullOrBlank()) return Diagnosis.Malformed
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            return Diagnosis.Malformed
        }
        // URI.getHost(), never a prefix test — same userinfo trap [locationId] documents.
        val found = uri.host?.lowercase() ?: return Diagnosis.Malformed
        if (found != host) return Diagnosis.HostMismatch(found)
        // Our host, but the scheme, path or uuid is not ours. One case, because the operator's
        // next move is the same for all three: write a fresh card.
        return Diagnosis.Malformed
    }

    /** What [diagnose] found. Never a decision, only a sentence. */
    sealed interface Diagnosis {
        data class Found(val locationId: String) : Diagnosis

        /** A real URL, on a host that is not ours. [found] is what the card actually carries. */
        data class HostMismatch(val found: String) : Diagnosis
        data object Malformed : Diagnosis
    }

    /**
     * The tag link this build would write for a location — the inverse of [locationId].
     *
     * Only for ADOPTED tags (see nfc/KnownTags), which carry no URL of their own and so
     * need one synthesised before they can rejoin the ordinary ACTION_VIEW path. Returns
     * null for anything that is not a well-formed UUID, so a bad table entry cannot inject
     * a URL: round-tripping through [locationId] must give the same value back, and if it
     * would not, this returns nothing at all.
     *
     * Always the CURRENT host, never a legacy one: this synthesises a link, and nothing new
     * should ever be minted under a host we have stopped using.
     */
    fun uriFor(locationId: String?): URI? {
        val id = normalizedUuid(locationId) ?: return null
        return try {
            URI("https://$host$PATH?l=$id")
        } catch (_: Exception) {
            null
        }
    }

    /** First `name=` value in a raw query string, percent-decoded. */
    private fun queryValue(rawQuery: String?, name: String): String? {
        if (rawQuery.isNullOrEmpty()) return null
        for (pair in rawQuery.split('&')) {
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            if (pair.substring(0, eq) != name) continue
            return try {
                // `+` is escaped to %2B BEFORE decoding, so URLDecoder cannot turn it into
                // a space. URLDecoder implements application/x-www-form-urlencoded, where
                // `+` MEANS space; a URI query does not, and Swift's URLComponents leaves
                // it alone. Without this, "?l=+<uuid>" decodes to " <uuid>", trims clean
                // and is ACCEPTED here while iOS rejects it - Android putting a shift on
                // the wire off a tag the iPhone in the next stairwell refuses. Tags are
                // unlocked (decision-15), so this is a trust boundary, not a nicety.
                URLDecoder.decode(pair.substring(eq + 1).replace("+", "%2B"), Charsets.UTF_8.name())
            } catch (_: Exception) {
                null
            }
        }
        return null
    }

    companion object {
        const val PATH: String = "/t"

        /**
         * Canonical 8-4-4-4-12 hex, lowercased. Mirrors server/lib/validate.js UUID_RE
         * and Swift's `UUID(uuidString:)`.
         *
         * Deliberately NOT java.util.UUID.fromString: that parser is lenient and happily
         * accepts "1-1-1-1-1", which the server then rejects with 400 invalid_uuid. A
         * client that sends garbage the server refuses is a client that loses shifts.
         */
        private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

        fun normalizedUuid(raw: String?): String? {
            val trimmed = raw?.trim() ?: return null
            if (!UUID_RE.matches(trimmed)) return null
            return trimmed.lowercase()
        }
    }
}
