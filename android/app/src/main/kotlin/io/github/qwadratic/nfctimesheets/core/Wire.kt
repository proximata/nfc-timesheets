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
     * GET /app/version (this iteration, routes/release.js). `{published:false}` decodes
     * to `null` — there is nothing to offer, and "nothing published" and "offline" are
     * deliberately indistinguishable to UpdateManager.checkForUpdate() past this point;
     * both mean "no update to show".
     */
    fun release(o: JSONObject): RemoteRelease? {
        if (!o.optBoolean("published", false)) return null
        return RemoteRelease(
            versionCode = o.getInt("version_code"),
            versionName = o.stringOrNull("version_name"),
            sha256 = o.stringOrNull("sha256"),
            notes = o.stringOrNull("notes"),
            url = o.getString("url"),
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
) {
    fun toJson(): String = Wire.obj(
        "client_uuid" to clientUuid,
        "location_uuid" to locationUuid,
        "start_time" to Wire.string(startTime),
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
) {
    fun toJson(): String = Wire.obj(
        "client_uuid" to clientUuid,
        "end_time" to Wire.string(endTime),
        "auto_closed" to autoClosed,
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
