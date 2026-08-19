package io.github.qwadratic.nfctimesheets.core

/**
 * Pure decision logic for zones (decision-43, decision-44), and nothing else. This file
 * makes NO network calls, NO SQLite calls and NO Android calls, so android/checks can
 * prove it on a plain JVM before anything in `data/` or `ui/` calls it — the same
 * separation `SyncPlan.kt` already states as house style: "This file makes NO decisions
 * of its own... put it in SyncPlan instead."
 *
 * ZERO PORT TARGET. Zones are new on Android; NFCTimeSheets/ (iOS) has no zone concept
 * yet and this phase does not touch it.
 */
object Zones {

    /**
     * The BUILDING id a tapped place belongs to. The id space tapped off a tag or typed
     * into a shift is shared between buildings and zones (decision-43): `placeId` may
     * already be a building id, or it may be a zone id that [zones] can resolve.
     *
     * IDENTITY ON A CACHE MISS, NEVER A SENTINEL — this is load-bearing, not a
     * shortcut. A fresh install, an offline cold launch, or a roster fetch that failed
     * silently (`ShiftSync.refreshRoster` swallows that failure by design) all leave
     * [zones] empty or stale. Defaulting an unresolved id to a shared placeholder like
     * `"unknown"` would silently treat every currently-uncached PLACE as the SAME
     * building the moment the cache is empty — a same-building auto-skip firing across
     * two buildings that share nothing but an empty cache. Returning the id itself keeps
     * two different unresolved places different, and a building id that resolves
     * against nothing is already its own building id, so identity is also exactly
     * correct in the common, zone-free case every existing shift is in today.
     */
    fun buildingIdOf(placeId: String, zones: List<WireZone>): String =
        zones.firstOrNull { it.id == placeId }?.locationId ?: placeId

    /**
     * The zone whose `tag_serial` matches a scanned hardware [serial], normalised on
     * both sides so any casing or separator style a reader prints still matches. Returns
     * the zone's PLACE id (never the building id) — callers post that straight to the
     * server, which resolves it itself (decision-44 §3: "the serial never reaches the
     * server").
     *
     * Building-level tags never reach this function: they carry a URL and resolve
     * through [TagLink], not through a hardware serial.
     */
    fun zonePlaceIdForSerial(serial: String?, zones: List<WireZone>): String? {
        val normalised = normaliseSerial(serial) ?: return null
        return zones.firstOrNull { normaliseSerial(it.tagSerial) == normalised }?.id
    }

    /**
     * Uppercase hex, colon-separated — the shape `nfc/KnownTags.kt` already produced
     * before this delegated to it, and the shape the server's `zones.tag_serial` CHECK
     * constraint requires. ONE COPY: a second hand-copied normaliser is exactly the
     * scar `TagLink`'s `+`-vs-space case already left in this codebase once.
     */
    fun normaliseSerial(serial: String?): String? {
        if (serial.isNullOrBlank()) return null
        val cleaned = serial.uppercase().filter { it.isDigit() || it in 'A'..'F' }
        if (cleaned.isEmpty()) return null
        return cleaned.chunked(2).joinToString(":")
    }
}
