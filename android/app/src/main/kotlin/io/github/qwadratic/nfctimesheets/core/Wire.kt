package io.github.qwadratic.nfctimesheets.core

import org.json.JSONObject
import java.time.Instant

/**
 * The wire contract, and nothing else. `org.json` (in android.jar) + java.time only —
 * no Android, no Compose — so android/checks can compile and exercise it on a plain JVM.
 *
 * Every field name below is snake_case and written out as a literal. This is a
 * deliberate copy of the discipline in NFCTimeSheets/NFCTimeSheets/API.swift, which
 * carries this scar:
 *
 *   > The previous version of this file used camelCase names of its own invention
 *   > ("worker", "tagUID", "manualFinish") that the server had never heard of; every
 *   > POST came back 400 and was swallowed by a bare catch, so shifts piled up on the
 *   > phone forever with a clean-looking UI.
 *
 * So: no reflection, no automatic name mangling, no serialization plugin. These strings
 * are here to be diffed against server/routes/app.js by eye, and the exact request bytes
 * are pinned in android/checks/core-check.kt.
 *
 * ASYMMETRY, on purpose: we WRITE our own bytes deterministically (fixed key order, hand
 * rolled) and we READ theirs leniently (org.json, explicit field reads, null-tolerant).
 */
object Wire {

    // ---- timestamps ---------------------------------------------------------------
    // ISO-8601, UTC, fractional seconds when the instant has them:
    //   2026-07-14T03:43:11.412Z   and   2026-07-14T03:43:11Z
    // Both shapes are accepted by server/lib/validate.js timestamp(), and Postgres hands
    // whole seconds back whenever the microseconds happen to be zero, so both must decode.
    fun string(instant: Instant): String = instant.toString()

    fun instant(text: String): Instant = Instant.parse(text)

    // ---- writing ------------------------------------------------------------------

    /** Fixed key order, JSON-escaped. Values may be String, Int, Boolean or null. */
    internal fun obj(vararg fields: Pair<String, Any?>): String =
        fields.joinToString(",", "{", "}") { (key, value) -> "${quote(key)}:${literal(value)}" }

    private fun literal(value: Any?): String = when (value) {
        null -> "null"
        is String -> quote(value)
        is Boolean, is Int, is Long -> value.toString()
        else -> throw IllegalArgumentException("unsupported JSON value: ${value::class}")
    }

    private fun quote(text: String): String {
        val sb = StringBuilder(text.length + 2).append('"')
        for (ch in text) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch == '\n' -> sb.append("\\n")
                ch == '\r' -> sb.append("\\r")
                ch == '\t' -> sb.append("\\t")
                ch < ' ' -> sb.append("\\u%04x".format(ch.code))
                else -> sb.append(ch)
            }
        }
        return sb.append('"').toString()
    }

    // ---- reading ------------------------------------------------------------------

    private fun JSONObject.stringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key, "").takeIf { it.isNotEmpty() }

    private fun JSONObject.instantOrNull(key: String): Instant? = stringOrNull(key)?.let(::instant)

    private fun JSONObject.intOrNull(key: String): Int? = if (isNull(key)) null else optInt(key).takeIf { has(key) }

    fun worker(o: JSONObject) = WireWorker(id = o.getInt("id"), name = o.optString("name", ""))

    fun location(o: JSONObject) = WireLocation(
        id = o.getString("id"),
        slug = o.optString("slug", ""),
        name = o.optString("name", ""),
    )

    /** One row of the `zones` array server/routes/app.js:roster adds (decision-44). */
    fun zone(o: JSONObject) = WireZone(
        id = o.getString("id"),
        locationId = o.getString("location_id"),
        name = o.optString("name", ""),
        tagSerial = o.stringOrNull("tag_serial"),
    )

    /**
     * GET /roster's whole envelope. `zones` is read with [JSONObject.optJSONArray], NEVER
     * `getJSONArray`: a server older than this app (pre decision-44) has no `"zones"` key
     * at all, and `getJSONArray` would throw `JSONException` on every launch against it.
     * The array is PURELY ADDITIVE (decision-44 §2) — an absent key degrades to an empty
     * list, never a crash. `workers` is deliberately not read (decision-22).
     */
    fun roster(o: JSONObject): WireRoster {
        val locations = o.getJSONArray("locations")
        val locationList = (0 until locations.length()).map { location(locations.getJSONObject(it)) }
        val zonesArray = o.optJSONArray("zones")
        val zoneList = if (zonesArray == null) {
            emptyList()
        } else {
            (0 until zonesArray.length()).map { zone(zonesArray.getJSONObject(it)) }
        }
        return WireRoster(locationList, zoneList)
    }

    /**
     * One row of GET /operator/zones (decision-47) — the operator's worklist entry.
     * NOT [zone]/[WireZone]: this carries fields a cleaner's roster must never see
     * (`tag_deployed_at`, `verified_at`) and a worker-facing name (`location_name`) the
     * roster has no use for.
     */
    fun operatorZone(o: JSONObject) = WireOperatorZone(
        id = o.getString("id"),
        // BOTH NULLABLE SINCE decision-54 §1, and read with [stringOrNull] for that reason: the
        // worklist now carries UNBOUND zones too, and an unbound zone has no building and
        // therefore no building name. `getString` here would throw on exactly the rows the bind
        // flow exists to fix — the whole worklist would fail to decode because one zone is
        // waiting to be bound.
        locationId = o.stringOrNull("location_id"),
        locationName = o.stringOrNull("location_name"),
        name = o.optString("name", ""),
        tagSerial = o.stringOrNull("tag_serial"),
        tagDeployedAt = o.instantOrNull("tag_deployed_at"),
        verifiedAt = o.instantOrNull("verified_at"),
    )

    /** One row of GET /operator/locations (decision-54 §2): two columns, and it stops there. */
    fun operatorLocation(o: JSONObject) = WireOperatorLocation(
        id = o.getString("id"),
        name = o.optString("name", ""),
    )

    /** GET /operator/locations's whole envelope: `{locations: [...]}`. */
    fun operatorLocations(o: JSONObject): List<WireOperatorLocation> {
        val array = o.getJSONArray("locations")
        return (0 until array.length()).map { operatorLocation(array.getJSONObject(it)) }
    }

    /**
     * POST /operator/tags/:id/resolve-zone's `{zone: {...}}` (decision-54 §2). `location_id`
     * is read with [stringOrNull] and NOT [JSONObject.getString]: an unbound zone is the
     * whole point of that route's optional building, so a null there is the ordinary case
     * and never a decoding fault. The route returns no `location_name` — the screen already
     * knows which building it just picked, so nothing has to be looked up to say so.
     */
    fun resolvedZone(o: JSONObject) = WireResolvedZone(
        id = o.getString("id"),
        name = o.optString("name", ""),
        locationId = o.stringOrNull("location_id"),
    )

    /**
     * GET /operator/tags/:id's whole body (decision-55 §1) — "what IS this card", asked before
     * anything has been picked off the worklist.
     *
     * THE `zone` BRANCH IS DECODED BY [operatorZone] AND NOT BY A SECOND DECODER, because the
     * route deliberately answers the SAME shape GET /operator/zones/:id does — that is the whole
     * reason the scan-first screen can hand the result straight to the zone page that already
     * exists. That body carries no `tag_serial`/`tag_deployed_at`, which [operatorZone] already
     * reads as nullable, so nothing has to be relaxed for it.
     *
     * AN UNRECOGNISED `kind` DEGRADES TO [WireTagClassification.Unknown], never a throw: a sixth
     * kind added server-side must leave an operator in a stairwell with a sentence, not a crash.
     * A "zone" with no `zone` object degrades the same way, for the same reason.
     */
    fun tagClassification(o: JSONObject): WireTagClassification = when (o.optString("kind", "")) {
        "zone" -> o.optJSONObject("zone")
            ?.let { WireTagClassification.Zone(operatorZone(it)) }
            ?: WireTagClassification.Unknown
        "building" -> WireTagClassification.Building
        "retired" -> WireTagClassification.Retired
        "tag_reported" -> WireTagClassification.TagReported
        else -> WireTagClassification.Unknown
    }

    /**
     * POST /operator/zones/:id/reassign-building's 201 body (decision-55 §3): the NEW zone plus
     * the id of the one that was retired in the same statement.
     *
     * `retired_zone_id` IS NOT COSMETIC. It is what lets the caller drop the old row from the
     * worklist it is holding, so a zone the server has just deactivated cannot keep being offered
     * as a live scan target on a phone that has not refreshed yet.
     *
     * The zone comes back with the route's OP_ZONE_COLS, which carry no `location_name` — the
     * caller substitutes the building it just picked rather than spending a round trip re-reading
     * a word it already had (the same rule WriteTagActivity's resolve-zone ending follows).
     */
    fun reassignedZone(o: JSONObject) = WireReassignedZone(
        zone = operatorZone(o.getJSONObject("zone")),
        retiredZoneId = o.stringOrNull("retired_zone_id"),
    )

    /** GET /operator/zones's whole envelope: `{zones: [...]}`. */
    fun operatorZones(o: JSONObject): List<WireOperatorZone> {
        val array = o.getJSONArray("zones")
        return (0 until array.length()).map { operatorZone(array.getJSONObject(it)) }
    }

    /**
     * POST /operator/zones/:id/verify's `{zone: {...}}` (decision-47). `verifiedAt` is
     * never null here — the route either stamps it just now or reports the earlier stamp
     * (`alreadyVerified = true`); a card that does not resolve to this zone never reaches
     * this decoder at all, because the server answers 422/404 instead of 200.
     */
    fun zoneVerifyResult(o: JSONObject) = WireZoneVerifyResult(
        id = o.getString("id"),
        name = o.optString("name", ""),
        locationId = o.getString("location_id"),
        locationName = o.optString("location_name", ""),
        verifiedAt = instant(o.getString("verified_at")),
        alreadyVerified = o.optBoolean("already_verified", false),
    )

    /**
     * One row of GET /operator/zones/:id/shifts (decision-54 §7). `durationMinutes` is read,
     * never computed: the server derives it in SQL from COALESCE(end_time, now()), so an OPEN
     * shift arrives with the time so far already in it and this phone never does date
     * arithmetic across two timestamps and a timezone.
     *
     * NO RATE AND NO MONEY, and that is the decision and not an omission (decision-6/42/43): a
     * zone is not a costing unit and this screen is not the payroll screen.
     */
    fun zoneShift(o: JSONObject) = WireZoneShift(
        workerName = o.optString("worker_name", ""),
        startTime = instant(o.getString("start_time")),
        endTime = o.instantOrNull("end_time"),
        durationMinutes = o.optDouble("duration_minutes", 0.0),
    )

    /**
     * GET /operator/zones/:id/shifts's envelope. `totalMinutes` is the WHOLE month's total,
     * computed by a second, unpaginated query server-side — it is deliberately NOT the sum of
     * [WireZoneShiftPage.shifts], because summing the 50 rows this page happens to hold and
     * calling it "the month" is the lie the second query exists to prevent.
     */
    fun zoneShiftPage(o: JSONObject): WireZoneShiftPage {
        val array = o.getJSONArray("shifts")
        return WireZoneShiftPage(
            shifts = (0 until array.length()).map { zoneShift(array.getJSONObject(it)) },
            page = o.optInt("page", 1),
            pageSize = o.optInt("page_size", 0),
            matching = o.optInt("matching", 0),
            totalMinutes = o.optDouble("total_minutes", 0.0),
        )
    }

    fun shift(o: JSONObject) = WireShift(
        id = o.getInt("id"),
        workerId = o.getInt("worker_id"),
        locationId = o.getString("location_id"),
        startTime = instant(o.getString("start_time")),
        endTime = o.instantOrNull("end_time"),
        autoClosed = o.optBoolean("auto_closed", false),
        correctedAt = o.instantOrNull("corrected_at"),
        clientUuid = o.stringOrNull("client_uuid"),
        locationSlug = o.stringOrNull("location_slug"),
        locationName = o.stringOrNull("location_name"),
    )

    /**
     * One row of GET /material-requests/mine, or the {request} of a POST.
     *
     * `status` is read as a raw string and mapped afterwards ([WireMaterialRequest.status]):
     * a sixth status added server-side must degrade to "unknown" on a phone in the field,
     * not throw and blank the list. Everything except `id`, `body`, `status` and
     * `created_at` is optional, because a request the admin has not touched has nothing
     * else filled in.
     */
    fun materialRequest(o: JSONObject) = WireMaterialRequest(
        id = o.getInt("id"),
        body = o.optString("body", ""),
        statusRaw = o.optString("status", ""),
        adminNote = o.stringOrNull("admin_note"),
        quantity = o.intOrNull("quantity"),
        orderedAt = o.instantOrNull("ordered_at"),
        arrivedAt = o.instantOrNull("arrived_at"),
        seenAt = o.instantOrNull("seen_at"),
        createdAt = instant(o.getString("created_at")),
        locationName = o.stringOrNull("location_name"),
        itemName = o.stringOrNull("item_name"),
    )
}

// ---- response types ----------------------------------------------------------------

data class WireWorker(val id: Int, val name: String)

/**
 * `id` is the UUID a tag carries (decision-21). `slug` rides along for display and log
 * lines only and must never be put back into a tag URI.
 */
data class WireLocation(val id: String, val slug: String, val name: String)

/**
 * One adopted-tag serial, riding on `/roster` (decision-44). `id` is a PLACE id, same id
 * space as [WireLocation.id] (decision-43) — a shift or a synthesised tag URI may carry
 * either one. `tagSerial` is nullable in the type only because [Wire.stringOrNull] always
 * returns a nullable String; the server's CHECK constraint means a present row always has
 * one.
 */
data class WireZone(val id: String, val locationId: String, val name: String, val tagSerial: String?)

/** GET /roster's envelope: the locations that resolve, plus the zones riding along additively. */
data class WireRoster(val locations: List<WireLocation>, val zones: List<WireZone>)

/**
 * One row of GET /operator/zones (decision-47): everything the operator's phone needs to
 * pick a zone off a worklist and recognise the card that names it. `id` is the same PLACE
 * id space as [WireZone.id] (decision-43) — it is what gets POSTed straight back as
 * `place_uuid` when the card carries no URL of its own.
 */
data class WireOperatorZone(
    val id: String,
    val locationId: String?,
    val locationName: String?,
    val name: String,
    val tagSerial: String?,
    val tagDeployedAt: Instant?,
    val verifiedAt: Instant?,
) {
    val isVerified: Boolean get() = verifiedAt != null

    /**
     * NO BUILDING YET (decision-54 §1). Not a broken row: `activePlace` cannot resolve such a
     * zone at all, so there is nothing for a test scan to prove — the operator binds it first.
     */
    val isBound: Boolean get() = locationId != null
}

/**
 * WHAT A SCANNED CARD IS (decision-55 §1), for a human holding it — never for a tap. The tap
 * path is `activePlace` server-side and knows nothing of these kinds; a maintainer widening one
 * must not assume it widens the other.
 *
 * ONLY [Zone] CARRIES AN ACTION. The other four exist so the phone can say something true and
 * specific instead of "not ours" — a building card, a card whose zone was retired, a card that
 * was written and reported but never named, and a card that is genuinely nobody's.
 */
sealed interface WireTagClassification {
    /** An ACTIVE zone, bound or not. The bound/unbound fork is [WireOperatorZone.isBound]. */
    data class Zone(val zone: WireOperatorZone) : WireTagClassification

    /** The grandfathered building card (decision-47). There is no operator screen for it. */
    data object Building : WireTagClassification

    /** An INACTIVE zone — what a reassignment leaves on the old card. */
    data object Retired : WireTagClassification

    /** Reported, never resolved into anything. No action is offered from the scan screen. */
    data object TagReported : WireTagClassification

    /** Not ours — and also a `tag_aliases` id, which decision-55 §1 leaves unresolved on purpose. */
    data object Unknown : WireTagClassification
}

/** POST /operator/zones/:id/reassign-building's 201 body (decision-55 §3). */
data class WireReassignedZone(val zone: WireOperatorZone, val retiredZoneId: String?)

/** One row of this month's shifts at one zone (decision-54 §7). */
data class WireZoneShift(
    val workerName: String,
    val startTime: Instant,
    val endTime: Instant?,
    val durationMinutes: Double,
)

/** One page of GET /operator/zones/:id/shifts, plus the month's total that is NOT of this page. */
data class WireZoneShiftPage(
    val shifts: List<WireZoneShift>,
    val page: Int,
    val pageSize: Int,
    val matching: Int,
    val totalMinutes: Double,
) {
    /** Is there a page after this one? Answered from the month's count, never from a guess. */
    val hasNext: Boolean get() = pageSize > 0 && page * pageSize < matching
    val hasPrevious: Boolean get() = page > 1
}

/**
 * One row of GET /operator/locations (decision-54 §2): everything the building picker on the
 * write and bind flows needs, which is a name to tap and an id to post. NOT [WireLocation] —
 * that carries a `slug` this list does not return and the picker has no use for.
 */
data class WireOperatorLocation(val id: String, val name: String)

/**
 * The zone POST /operator/tags/:id/resolve-zone just created. `locationId` is NULLABLE and
 * that is the decision, not an accident (decision-54 §1): an operator who skipped the
 * building leaves the zone unbound, unreachable by any tap, until somebody binds it later.
 */
data class WireResolvedZone(val id: String, val name: String, val locationId: String?)

/** The outcome of POST /operator/zones/:id/verify (decision-47). */
data class WireZoneVerifyResult(
    val id: String,
    val name: String,
    val locationId: String,
    val locationName: String,
    val verifiedAt: Instant,
    val alreadyVerified: Boolean,
)

/** The single shift shape every shift endpoint returns. */
data class WireShift(
    val id: Int,
    val workerId: Int,
    val locationId: String,
    val startTime: Instant,
    val endTime: Instant?,
    val autoClosed: Boolean,
    val correctedAt: Instant?,
    val clientUuid: String?,
    val locationSlug: String?,
    val locationName: String?,
) {
    /**
     * Derived, never stored (decision-10): the 8h timer closed it and no human has fixed
     * it yet. No third flag exists that could disagree with these two.
     */
    val needsResolution: Boolean get() = autoClosed && correctedAt == null
}

// ---- request bodies ----------------------------------------------------------------

/**
 * POST /shifts/open — decision-22: NO worker_id, not now and not ever.
 *
 * Who is clocking in is decided by the ts_worker session cookie on the server. Putting a
 * worker field back here would restore the exact hole decision-22 closed: anyone holding
 * the (publicly recoverable) app key could file hours as anyone. android/checks asserts
 * the serialised body contains no "worker" substring.
 */
data class OpenShiftRequest(
    val clientUuid: String,
    val locationUuid: String,
    val startTime: Instant,
    /**
     * decision-56: the worker picked this building off the roster instead of tapping a
     * card. The server stamps `manual_start` and the office sees the row flagged for ever;
     * validation is UNCHANGED (v.activePlace + v.requireVerifiedPlace), so a manual open
     * only ever succeeds where a real tap would.
     */
    val manual: Boolean = false,
) {
    // OMITTED when false, never sent as `"manual":false`: the tap path's bytes stay exactly
    // what they were before decision-56, which is what makes the pinned body in
    // checks/core-check.kt a real assertion about the tap rather than a copy of the new shape.
    fun toJson(): String = Wire.obj(
        *listOfNotNull(
            "client_uuid" to clientUuid,
            "location_uuid" to locationUuid,
            "start_time" to Wire.string(startTime),
            if (manual) "manual" to true else null,
        ).toTypedArray(),
    )
}

/**
 * POST /shifts/close.
 *
 * `autoClosed` is true when the APP closed the shift rather than the worker deliberately
 * tapping out — today that means they tapped a DIFFERENT building without tapping out
 * here first. The end time is then the moment they arrived somewhere else, which nobody
 * confirmed, so the server routes it through the same resolution screen as an 8h timeout.
 * A normal tap-out omits it and stays a clean, confirmed close. The server only ever
 * RAISES the flag, never clears it.
 */
data class CloseShiftRequest(
    val clientUuid: String,
    val endTime: Instant,
    val autoClosed: Boolean,
    /**
     * decision-56: the worker pressed Stop instead of tapping out. The server stamps
     * `manual_close` AND `corrected_at` in the same update — a manual close is a worker
     * confirming their own finish time in the moment, so it is already resolved and needs
     * no decision-10 follow-up. `autoClosed` stays false: that flag is the 8h timer's and
     * the different-building case's, and conflating the two would send this row back
     * through a resolution screen the worker has just answered.
     */
    val manual: Boolean = false,
) {
    // `manual` OMITTED when false — see OpenShiftRequest.toJson for why.
    fun toJson(): String = Wire.obj(
        *listOfNotNull(
            "client_uuid" to clientUuid,
            "end_time" to Wire.string(endTime),
            "auto_closed" to autoClosed,
            if (manual) "manual" to true else null,
        ).toTypedArray(),
    )
}

/** POST /shifts/:id/resolve — the worker supplies the real finish time (decision-10). */
data class ResolveShiftRequest(val endTime: Instant) {
    fun toJson(): String = Wire.obj("end_time" to Wire.string(endTime))
}

/**
 * POST /auth/code — the enrolment code, and NOTHING ELSE (decision-26).
 *
 * One field, because one field is all the server reads (server/routes/auth.js codeAuth).
 * No worker id, no name, no email, no device id: the code IS the claim, and who it
 * belongs to was decided by the admin when they issued it. Sending an id alongside it
 * would be decision-22's hole reopened in a new endpoint.
 *
 * The value here is the canonical form from EnrolmentCode.normalise(), never the raw
 * keystrokes, so the bytes are the same whichever way it was typed.
 */
data class EnrolmentRequest(val code: String) {
    fun toJson(): String = Wire.obj("code" to code)
}

/**
 * POST /operator/zones/:id/verify — the id of the zone is in the PATH, and the only body
 * field is what the phone read off the card: either a URI's uuid, or a zone id resolved
 * client-side from an adopted card's serial (decision-44's pin — no serial ever travels
 * to the server — holds here byte for byte).
 */
data class VerifyZoneRequest(val placeUuid: String) {
    fun toJson(): String = Wire.obj("place_uuid" to placeUuid)
}

/**
 * POST /operator/tags/:id/resolve-zone — the tag id is in the PATH; the body is the zone's
 * name and, OPTIONALLY, the building it belongs to.
 *
 * AN OMITTED BUILDING IS OMITTED, never sent as an explicit null. The server reads it with
 * `v.optionalUuid`, which treats absent and null alike today — but the difference is what the
 * request MEANS: "the operator did not decide yet" is the absence of a field, and writing
 * `"location_id": null` would be this client asserting a value the operator never gave. That
 * is also why this is the one request body in this file that does not hand a fixed key list
 * to [Wire.obj].
 */
data class ResolveZoneRequest(val name: String, val locationId: String?) {
    fun toJson(): String = if (locationId == null) {
        Wire.obj("name" to name)
    } else {
        Wire.obj("name" to name, "location_id" to locationId)
    }
}

/**
 * POST /operator/zones/:id/bind — the zone id is in the PATH; the body is the building, and
 * the building is REQUIRED here (decision-54 §3). Unlike [ResolveZoneRequest] there is no
 * omitted-building case: "leave it unbound" is not a bind, it is walking away and picking a
 * different zone off the worklist.
 */
data class BindZoneRequest(val locationId: String) {
    fun toJson(): String = Wire.obj("location_id" to locationId)
}

/**
 * POST /operator/zones/:id/reassign-building (decision-55 §3). The OLD zone is in the PATH; the
 * body is the card the phone has just written and reported, plus the building it now belongs to.
 *
 * BOTH FIELDS ARE REQUIRED and neither has a "leave it" case. A reassignment with no new card
 * would be an in-place UPDATE, which the composite shift FKs refuse outright, and one with no
 * building would be an unbind wearing a different name.
 */
data class ReassignBuildingRequest(val newTagId: String, val locationId: String) {
    fun toJson(): String = Wire.obj("new_tag_id" to newTagId, "location_id" to locationId)
}

/**
 * POST /auth/sms/request — the phone as typed, and NOTHING else (decision-48 §6). The
 * server normalises it (lib/validate.js identityPhone, the same shape PUT
 * /admin/workers/:id/phone uses); this client sends raw keystrokes, exactly like
 * [EnrolmentRequest] sends the raw code and lets the server be the one normaliser.
 */
data class SmsRequestBody(val phone: String) {
    fun toJson(): String = Wire.obj("phone" to phone)
}

/**
 * POST /auth/sms/verify — the phone AND the 6 digits from the SMS. Both fields, because
 * unlike [EnrolmentRequest]'s single code (unique across every worker) an OTP is unique
 * only per phone number (server/lib/sms.js § the one-time code) — the server cannot look
 * one up without knowing which challenge to check it against.
 */
data class SmsVerifyBody(val phone: String, val code: String) {
    fun toJson(): String = Wire.obj("phone" to phone, "code" to code)
}
