package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone
import io.github.qwadratic.nfctimesheets.core.WireReassignedZone
import io.github.qwadratic.nfctimesheets.core.WireTagClassification
import io.github.qwadratic.nfctimesheets.core.WireZoneShiftPage
import io.github.qwadratic.nfctimesheets.core.WireZoneVerifyResult
import org.json.JSONObject

/**
 * DEBUG BUILDS ONLY. There is a file with this exact name and package in `src/release/`
 * whose [verifyTapSimulations] returns an empty list and contains none of the scenarios
 * below — same split as `nfc/WriteSimulation.kt`, checked the same way against the compiled
 * dex, not the source: `android/checks/release-artefact.sh`.
 *
 * WHY THIS EXISTS. NFC hardware does not work on an emulator: there is no field, no card,
 * and `enableReaderMode` never fires. [VerifyZoneActivity]'s outcome rendering — a match, a
 * mismatch, the grandfathered building card, an unreadable card — would otherwise be
 * unexercisable anywhere except a client's building with a client's cards.
 *
 * A MUCH SHALLOWER MOCK THAN [WriteSimulation], and deliberately so. Writing a tag has to
 * fake actual NDEF bytes and a platform decode, because `TagWriter` genuinely round-trips
 * them. Verifying one does not: past the point where a tag is read, all this screen ever
 * has is a URI string and a UID string (see [VerifyZoneActivity.handleRead]), so a
 * simulation only has to supply THOSE — the real resolution logic and the real network call
 * to `POST /operator/zones/:id/verify` run exactly as they would for a genuine tap. It
 * simulates the tag, not the answer.
 *
 * NEVER A NETWORK-FAILURE SCENARIO HERE. A transport failure is not a fact about a TAG, and
 * faking one would mean the debug build's outcome rendering for it is proven against a
 * canned exception rather than the real `java.net.HttpURLConnection` path every other
 * failure in this file goes through. Exercise it by disconnecting the emulator's network
 * instead — the real transport, no mock required.
 */
data class VerifyTapSimulation(
    val label: String,
    val techs: List<String>,
    val uid: String,
    /** What `readUri()` would have returned, already stringified. null = no NDEF URI. */
    val uriString: String?,
)

/**
 * The building in production. A card carrying this id is the one grandfathered by
 * decision-47 — it must MISMATCH here (a building has no zone to verify), the same way it
 * must resolve at all on a cleaner's tap.
 */
private const val HOIV_LOCATION = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"

fun verifyTapSimulations(
    selected: WireOperatorZone,
    all: List<WireOperatorZone>,
    tagLink: TagLink,
): List<VerifyTapSimulation> {
    val scenarios = mutableListOf(
        VerifyTapSimulation(
            label = "SIMULATED: die Karte dieser Zone \u2014 sollte freischalten",
            techs = listOf("SIMULATED"),
            uid = "SI:MU:LA:TE:D0",
            uriString = tagLink.uriFor(selected.id)?.toString(),
        ),
        VerifyTapSimulation(
            label = "SIMULATED: die HOIV-Gebaeude-Karte (kein Zonen-Tag) \u2014 sollte NICHT passen",
            techs = listOf("SIMULATED"),
            uid = "SI:MU:LA:TE:D1",
            uriString = tagLink.uriFor(HOIV_LOCATION)?.toString(),
        ),
        VerifyTapSimulation(
            label = "SIMULATED: eine leere oder unlesbare Karte",
            techs = listOf("SIMULATED"),
            uid = "SI:MU:LA:TE:D2",
            uriString = null,
        ),
    )
    // Only offered when a second zone actually exists to borrow a card from.
    all.firstOrNull { it.id != selected.id }?.let { other ->
        scenarios.add(
            1,
            VerifyTapSimulation(
                label = "SIMULATED: die Karte der Zone \u201e${other.name}\u201c \u2014 sollte NICHT passen",
                techs = listOf("SIMULATED"),
                uid = "SI:MU:LA:TE:D3",
                uriString = tagLink.uriFor(other.id)?.toString(),
            ),
        )
    }
    return scenarios
}

// ---- decision-54 §§3/7: the bind form and the zone page, without a server ----------------

/**
 * TWO ZONES THAT DO NOT EXIST, added to the worklist so the two branches decision-54 added to
 * this screen are reachable at all. On an emulator `GET /operator/zones` answers nothing (no
 * session, no server), so without these the screen never gets past "no zones" and neither the
 * bind form nor the zone page can be seen before a client's stairwell.
 *
 * ONE UNBOUND AND ONE BOUND, because that is precisely the fork [VerifyZoneActivity.selectZone]
 * takes: unbound goes to the building picker and starts no reader mode, bound goes to the test
 * scan as it always did.
 *
 * AND A THIRD, BOUND, WITH HISTORY (TASK-277), which exists for exactly one reason: unbind has
 * two outcomes and both have to be reachable without a database. The plain bound zone unbinds
 * and drops to the building picker; this one answers 409 zone_has_shifts and stays where it is.
 * The difference is a property of the ZONE, not a toggle on the screen — same reasoning as
 * [isSimulatedZone]'s.
 *
 * THE IDS ARE REAL UUIDS and not the word "simulated": [TagLink.uriFor] returns null for
 * anything that is not one, so a pretty placeholder here would silently produce a card with no
 * URI and turn every tap scenario above into "unreadable".
 */
private const val SIM_ZONES_JSON = """
{"zones":[
  {"id":"5111d0de-0000-4000-8000-0000000000c1","location_id":null,"location_name":null,
   "name":"SIMULATED: Zone ohne Gebaeude","tag_serial":null,
   "tag_deployed_at":"2026-08-20T09:00:00Z","verified_at":null},
  {"id":"5111d0de-0000-4000-8000-0000000000c2","location_id":"5111d0de-0000-4000-8000-0000000000a1",
   "location_name":"SIMULATED: Stiegengasse 3","name":"SIMULATED: Zone mit Gebaeude",
   "tag_serial":null,"tag_deployed_at":"2026-08-20T09:00:00Z","verified_at":null},
  {"id":"5111d0de-0000-4000-8000-0000000000c3","location_id":"5111d0de-0000-4000-8000-0000000000a1",
   "location_name":"SIMULATED: Stiegengasse 3","name":"SIMULATED: Zone mit Schichten",
   "tag_serial":null,"tag_deployed_at":"2026-08-20T09:00:00Z","verified_at":null}
]}
"""

/** The one simulated zone whose unbind is REFUSED — see [runUnbindSimulation]. */
private const val SIM_ZONE_WITH_SHIFTS = "5111d0de-0000-4000-8000-0000000000c3"

fun simulatedZones(): List<WireOperatorZone> = Wire.operatorZones(JSONObject(SIM_ZONES_JSON))

/**
 * Is this row one of ours? The screen asks before every network call it would otherwise make
 * for the selected zone — bind, verify, shifts — because a simulated zone has no row on any
 * server and the real calls would answer 401 or 404 and prove nothing.
 *
 * BY IDENTITY, not by a flag on the screen: a mode the screen is in is a mode it can be left
 * in, and "still simulating" over a REAL zone is exactly the accident this whole source-set
 * split exists to make impossible.
 */
fun isSimulatedZone(zone: WireOperatorZone): Boolean =
    simulatedZones().any { it.id == zone.id } || zone.id in reassignedSimulatedZones

/**
 * The zones a SIMULATED reassignment minted (decision-55 §3). Kept because the new zone's id is
 * the card that was just "written" — a fresh uuid, so it cannot be in [SIM_ZONES_JSON] — and
 * without it the very next thing the screen does on that zone (a test scan, then its shifts)
 * would go to the real server and answer 401. Process-lifetime only, debug source set only.
 */
private val reassignedSimulatedZones = mutableSetOf<String>()

/** The buildings the bind picker offers: the write flow's fixture, not a second copy of it. */
fun simulatedBindLocations(): List<WireOperatorLocation> = simulatedLocations()

/**
 * `POST /operator/zones/:id/bind`, answered here. Returns the zone WITH the building and with
 * `verified_at` still null — not decoration: the real route CLEARS the stamp on a bind
 * (decision-54 §3), so a fixture that came back verified would hide the very state the screen
 * has to handle next, which is "bound, now go and prove the card".
 */
fun runBindSimulation(zone: WireOperatorZone, location: WireOperatorLocation): WireOperatorZone =
    Wire.operatorZone(
        JSONObject(
            "{\"id\":${JSONObject.quote(zone.id)}" +
                ",\"location_id\":${JSONObject.quote(location.id)}" +
                ",\"location_name\":${JSONObject.quote(location.name)}" +
                ",\"name\":${JSONObject.quote(zone.name)}" +
                ",\"tag_serial\":null,\"tag_deployed_at\":\"2026-08-20T09:00:00Z\",\"verified_at\":null}",
        ),
    )

/**
 * `POST /operator/zones/:id/unbind`, answered here — BOTH answers, decided by which simulated
 * zone is selected (TASK-277).
 *
 * "SIMULATED: Zone mit Schichten" throws the server's own 409, because that refusal is the
 * half a reviewer cannot otherwise see: it comes from a composite FK in migration 013, needs a
 * real shift row to trigger, and is the one outcome the screen must render as a sentence
 * instead of a code. Every other simulated zone unbinds cleanly and lands back in the building
 * picker.
 *
 * `verified_at` IS CARRIED THROUGH UNCHANGED, unlike [runBindSimulation] which clears it: the
 * real route deliberately does not clear it on an unbind, and a fixture that did would teach
 * the screen the opposite of the rule.
 */
fun runUnbindSimulation(zone: WireOperatorZone): WireOperatorZone {
    if (zone.id == SIM_ZONE_WITH_SHIFTS) throw ApiFailure(status = 409, code = "zone_has_shifts")
    return Wire.operatorZone(
        JSONObject(
            "{\"id\":${JSONObject.quote(zone.id)}" +
                ",\"location_id\":null,\"location_name\":null" +
                ",\"name\":${JSONObject.quote(zone.name)}" +
                ",\"tag_serial\":null,\"tag_deployed_at\":\"2026-08-20T09:00:00Z\"" +
                ",\"verified_at\":${zone.verifiedAt?.let { JSONObject.quote(it.toString()) } ?: "null"}}",
        ),
    )
}

/** `POST /operator/zones/:id/verify`'s 200 body: freshly stamped, never `already_verified`. */
fun runVerifySimulation(zone: WireOperatorZone): WireZoneVerifyResult =
    Wire.zoneVerifyResult(
        JSONObject(
            "{\"id\":${JSONObject.quote(zone.id)}" +
                ",\"name\":${JSONObject.quote(zone.name)}" +
                ",\"location_id\":${JSONObject.quote(zone.locationId ?: "")}" +
                ",\"location_name\":${JSONObject.quote(zone.locationName ?: "")}" +
                ",\"verified_at\":\"2026-08-26T10:15:00Z\",\"already_verified\":false}",
        ),
    )

/**
 * `GET /operator/zones/:id/shifts?page=N` — three shifts over TWO pages, and a month total
 * that matches NEITHER page.
 *
 * THE NUMBERS ARE THE TEST. `page_size` is 2 here and 50 on the server, deliberately: fifty
 * fixtures to see a second page would be fifty fixtures nobody reads, and the screen never
 * assumes the size — it echoes the server's (core/Wire.kt WireZoneShiftPage.hasNext). And
 * `total_minutes` is 615 while page 1 holds 240+195=435 and page 2 holds 180. If the screen
 * ever starts summing the rows it can see and calling that the month, this fixture makes it
 * say 435 where it should say 615 — which is the whole reason the endpoint runs a second,
 * unpaginated query (decision-54 §7) rather than letting the client add up a page.
 */
private val SHIFT_PAGES = mapOf(
    1 to """
{"month":"2026-08","page":1,"page_size":2,"matching":3,"total_minutes":615,"shifts":[
  {"worker_name":"SIMULATED: Anna B.","start_time":"2026-08-24T06:00:00Z",
   "end_time":"2026-08-24T10:00:00Z","duration_minutes":240},
  {"worker_name":"SIMULATED: Bojan K.","start_time":"2026-08-22T05:30:00Z",
   "end_time":"2026-08-22T08:45:00Z","duration_minutes":195}
]}
""",
    2 to """
{"month":"2026-08","page":2,"page_size":2,"matching":3,"total_minutes":615,"shifts":[
  {"worker_name":"SIMULATED: Carla D.","start_time":"2026-08-19T06:15:00Z",
   "end_time":null,"duration_minutes":180}
]}
""",
)

/**
 * A page past the end answers an EMPTY page rather than throwing, exactly as the route does:
 * the screen's Next button is drawn from `matching`, so this is only reachable if that
 * arithmetic breaks — and an empty list is how it would show.
 */
fun runShiftsSimulation(page: Int): WireZoneShiftPage =
    Wire.zoneShiftPage(
        JSONObject(
            SHIFT_PAGES[page]
                ?: "{\"month\":\"2026-08\",\"page\":$page,\"page_size\":2,\"matching\":3" +
                ",\"total_minutes\":615,\"shifts\":[]}",
        ),
    )

// ---- decision-55 §1: scan first, ask what the card IS ------------------------------------

/**
 * FOUR CARDS THAT ARE NOT ZONES. `GET /operator/tags/:id` answers five kinds and four of them
 * end in a sentence and nothing else — which is exactly the half no emulator can reach, because
 * producing one needs a deactivated zone row, an unresolved report, or a stranger's card.
 *
 * REAL UUIDS, for the same reason [SIM_ZONES_JSON]'s are: [TagLink.uriFor] returns null for
 * anything else, and a placeholder would turn every scenario below into "unreadable" instead of
 * the kind it is meant to show.
 */
private const val SIM_TAG_BUILDING = "5111d0de-0000-4000-8000-0000000000d1"
private const val SIM_TAG_RETIRED = "5111d0de-0000-4000-8000-0000000000d2"
private const val SIM_TAG_REPORTED = "5111d0de-0000-4000-8000-0000000000d3"
private const val SIM_TAG_UNKNOWN = "5111d0de-0000-4000-8000-0000000000d4"

/**
 * The scan-first buttons, offered BEFORE any zone is picked — one per branch decision-55 §1
 * names, plus the unreadable card, which is not a kind at all: it never reaches the route,
 * because there is no id to ask about.
 *
 * THE ZONE SCENARIOS REUSE THE SIMULATED WORKLIST ROWS rather than inventing a seventh id: the
 * bound one must land on the very zone page [SIM_ZONES_JSON]'s bound row already drives, which
 * is the property AC #2 is about — one zone page, reached two ways.
 */
fun classifyTapSimulations(tagLink: TagLink): List<VerifyTapSimulation> {
    fun card(label: String, uid: String, id: String?) = VerifyTapSimulation(
        label = label,
        techs = listOf("SIMULATED"),
        uid = uid,
        uriString = id?.let { tagLink.uriFor(it)?.toString() },
    )
    val zones = simulatedZones()
    return listOf(
        card(
            "SIMULATED: Karte einer Zone MIT Gebaeude — sollte freischalten und die Zone zeigen",
            "SC:AN:00:00:01",
            zones.getOrNull(1)?.id,
        ),
        card(
            "SIMULATED: Karte einer Zone OHNE Gebaeude — sollte die Objektauswahl zeigen",
            "SC:AN:00:00:02",
            zones.getOrNull(0)?.id,
        ),
        card("SIMULATED: Gebaeude-Karte", "SC:AN:00:00:03", SIM_TAG_BUILDING),
        card("SIMULATED: Karte einer stillgelegten Zone", "SC:AN:00:00:04", SIM_TAG_RETIRED),
        card("SIMULATED: gemeldete, aber unbenannte Karte", "SC:AN:00:00:05", SIM_TAG_REPORTED),
        card("SIMULATED: fremde Karte", "SC:AN:00:00:06", SIM_TAG_UNKNOWN),
        card("SIMULATED: leere oder unlesbare Karte", "SC:AN:00:00:07", null),
    )
}

/**
 * `GET /operator/tags/:id`, answered here for the simulated ids ONLY — null for every other id,
 * which is what sends a REAL card to the real route.
 *
 * BY ID, never by a flag on the screen, exactly as [isSimulatedZone] is: a "still simulating"
 * mode left switched on over a real card is the accident this whole source-set split exists to
 * make impossible.
 *
 * The zone branches return the SAME rows [simulatedZones] puts on the worklist, so a scan-first
 * arrival and a worklist arrival land on one screen holding one object, not two copies that can
 * drift.
 */
fun simulatedClassification(id: String): WireTagClassification? {
    simulatedZones().firstOrNull { it.id == id }?.let { return WireTagClassification.Zone(it) }
    return when (id) {
        SIM_TAG_BUILDING -> WireTagClassification.Building
        SIM_TAG_RETIRED -> WireTagClassification.Retired
        SIM_TAG_REPORTED -> WireTagClassification.TagReported
        SIM_TAG_UNKNOWN -> WireTagClassification.Unknown
        else -> null
    }
}

/**
 * `POST /operator/zones/:id/reassign-building`'s 201 body (decision-55 §3), answered here.
 *
 * THE NEW ZONE IS KEYED BY THE CARD THAT WAS JUST WRITTEN and carries the OLD zone's name
 * forward, unverified and with no shifts — the route's own contract. It comes back with NO
 * `location_name`, deliberately: the real route returns OP_ZONE_COLS and does not have one
 * either, so a fixture that supplied it would hide the substitution the screen has to make.
 *
 * `retired_zone_id` is the OLD zone, which is how the screen drops it from the worklist it is
 * still holding — the one thing AC #5 is about.
 */
fun runReassignSimulation(
    zone: WireOperatorZone,
    newTagId: String,
    location: WireOperatorLocation,
): WireReassignedZone {
    reassignedSimulatedZones += newTagId
    return Wire.reassignedZone(
        JSONObject(
            "{\"zone\":{\"id\":${JSONObject.quote(newTagId)}" +
                ",\"location_id\":${JSONObject.quote(location.id)}" +
                ",\"name\":${JSONObject.quote(zone.name)}" +
                ",\"tag_serial\":null,\"tag_deployed_at\":\"2026-08-26T09:00:00Z\"" +
                ",\"verified_at\":null}" +
                ",\"retired_zone_id\":${JSONObject.quote(zone.id)}}",
        ),
    )
}
