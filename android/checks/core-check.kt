// Runnable check for everything in the Android app that does NOT need a device: tag-link
// parsing, UUID validation at the trust boundary, the exact JSON bytes on the wire, retry
// classification, the offline queue state machine, the cold-launch tap ordering, and
// string-resource parity.
//
//     cd android && ./checks/run.sh
//
// In the spirit of NFCTimeSheets/checks/: no test framework, no Gradle, no Android SDK,
// no emulator. Everything it exercises is deliberately kept free of Android imports so
// this stays possible — that constraint is why core/ looks the way it does.
//
// WHAT THIS CANNOT PROVE, and nothing on a Mac can: that a physical tag fires the intent,
// that App Links verified, that NFC dispatch reaches a stopped app. See android/README.md.

@file:JvmName("CoreCheck")

package io.github.qwadratic.nfctimesheets.checks

import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.CloseShiftRequest
import io.github.qwadratic.nfctimesheets.core.EnrolmentCode
import io.github.qwadratic.nfctimesheets.core.EnrolmentRequest
import io.github.qwadratic.nfctimesheets.core.CreateMaterialRequest
import io.github.qwadratic.nfctimesheets.core.MaterialEntry
import io.github.qwadratic.nfctimesheets.core.MaterialPushOutcome
import io.github.qwadratic.nfctimesheets.core.MaterialQueue
import io.github.qwadratic.nfctimesheets.core.MaterialStatus
import io.github.qwadratic.nfctimesheets.core.QueuedMaterialRequest
import io.github.qwadratic.nfctimesheets.core.OpenShiftRequest
import io.github.qwadratic.nfctimesheets.core.ResolveShiftRequest
import io.github.qwadratic.nfctimesheets.core.RemoteRelease
import io.github.qwadratic.nfctimesheets.core.RunningShift
import io.github.qwadratic.nfctimesheets.core.SessionCookie
import io.github.qwadratic.nfctimesheets.core.ShiftSignal
import io.github.qwadratic.nfctimesheets.core.SyncPlan
import io.github.qwadratic.nfctimesheets.core.UpdateCheck
import io.github.qwadratic.nfctimesheets.core.SyncPlan.QueuedShift
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.TapInbox
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireZone
import io.github.qwadratic.nfctimesheets.core.Zones
import org.json.JSONObject
import java.io.File
import java.time.Instant
import kotlin.system.exitProcess

private var failed = false

private fun check(ok: Boolean, what: String) {
    if (!ok) {
        System.err.println("FAIL: $what")
        failed = true
    }
}

// The host under test is read from branding.properties, not typed here: a check with its
// own copy of the operator's host stops checking anything the day the host changes.
private val brandingFile = File("branding.properties")
private val branding = java.util.Properties().apply {
    brandingFile.inputStream().use { load(it) }
}
// TWO HOSTS (decision-40). `host` is the TAG host — what is written on a card on a wall,
// permanent, and the only host in the manifest. `apiHost` is where the app TALKS, and is
// renameable. They were one value; the box was renamed and a tag went dead.
private val host = branding.getProperty("ts.tagHost").trim()
private val apiHost = branding.getProperty("ts.apiHost").trim()
// Hosts we once wrote onto tags that are still on walls. Read, never typed here, for the
// same reason as ts.tagHost — except section 1b ALSO pins the real field tags, so deleting
// an entry from branding.properties turns this check red instead of quietly narrowing it.
private val legacyHosts = (branding.getProperty("ts.legacyTagHosts") ?: "")
    .split(",").map { it.trim() }.filter { it.isNotEmpty() }
private val tags = TagLink(host, legacyHosts)

private const val UUID_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
private const val UUID_B = "6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d"

// The server, read as text. Sections 9-11 diff the client against the ACTUAL source of
// truth rather than against a copy of it that would rot the day the server changes.
// Relative to android/, which run.sh cd's to.
private val serverEnrolment = File("../server/lib/enrolment.js")
private val serverAuthRoute = File("../server/routes/auth.js")

fun main() {
    tagLink()
    retryClassification()
    wireBytes()
    wireDecoding()
    tapOrdering()
    syncPlan()
    stringResources()
    manifestAndWiring()
    zones()
    enrolmentCode()
    enrolmentAgainstServer()
    sessionPersistence()
    materialRequests()
    shiftSignal()
    updateCheck()

    if (failed) exitProcess(1)
    println("core-check: OK")
}

// ---------------------------------------------------------------------------------
// 1. Tag link. THE trust boundary: tags are unlocked (decision-15) and anyone with a
//    phone can rewrite one. Positive and negative cases ported verbatim from
//    NFCTimeSheets/checks/tag-link-check.swift so the two platforms cannot drift.
// ---------------------------------------------------------------------------------
private fun tagLink() {
    check(host.isNotEmpty(), "branding.properties carries ts.tagHost")

    check(tags.locationId("https://$host/t?l=$UUID_A") == UUID_A, "canonical link")
    check(
        tags.locationId("https://$host/t/?l=3F2504E0-4F89-11D3-9A0C-0305E82C3301") == UUID_A,
        "trailing slash + uppercase uuid -> lowercased",
    )
    check(
        tags.locationId("https://${host.uppercase()}/t?x=1&l=$UUID_A") == UUID_A,
        "host case-insensitive, extra query params ignored",
    )

    // Everything here would otherwise reach the server off an unlocked tag.
    val bad = listOf(
        "https://$host/t?l=westbahnhof" to "a SLUG, not a uuid (decision-21)",
        "https://$host/t?l=" to "empty",
        "https://$host/t" to "no l at all",
        "https://$host/t?l=3f2504e04f8911d39a0c0305e82c3301" to "unhyphenated",
        "https://$host/t?l=$UUID_A'--" to "sql-ish",
        // java.util.UUID.fromString ACCEPTS this. The server's regex does not. Using the
        // lenient parser here would queue rows the server answers 400 to, for ever.
        "https://$host/t?l=1-1-1-1-1" to "lenient-parser uuid must still be rejected",
        "https://evil.example.com/t?l=$UUID_A" to "wrong host",
        // URI userinfo trick: the string STARTS with our host but the authority is not ours.
        "https://$host@evil.example.com/t?l=$UUID_A" to "userinfo does not make it our host",
        "http://$host/t?l=$UUID_A" to "not https",
        "https://$host/admin?l=$UUID_A" to "wrong path",
        "https://$host/tag?l=$UUID_A" to "path prefix is not the path",
        "not a url at all" to "unparseable",
        // URLDecoder implements form encoding, where `+` means space. A URI query does
        // not, and Swift's URLComponents leaves `+` alone. Decoding it as a space would
        // make BOTH of these trim down to a clean uuid and be accepted here while iOS
        // rejects them - the two platforms disagreeing about a tag on a wall.
        // Verified against Swift: cat NFCTimeSheets/{Branding,TagLink,API}.swift
        //   NFCTimeSheets/checks/tag-link-check.swift | swift -
        "https://$host/t?l=+$UUID_A" to "leading + is not a space (iOS rejects it)",
        "https://$host/t?l=$UUID_A+" to "trailing + is not a space (iOS rejects it)",
    )
    for ((raw, why) in bad) {
        check(tags.locationId(raw) == null, "must reject ($why): $raw")
    }
    check(tags.locationId(null) == null, "null is not a tag")

    check(TagLink.normalizedUuid("  $UUID_A  ") == UUID_A, "surrounding whitespace trimmed")

    fieldTags()
}

// ---------------------------------------------------------------------------------
// 1b. THE TAGS THAT PHYSICALLY EXIST.
//
//     Everything above tests the parser against hosts it was handed. This tests it
//     against the URI bytes that are, right now, written on a card in a building in
//     Vienna. A hostname on a wall cannot be renamed the way a server can: the VM was
//     renamed timesheets.exe.xyz -> schimmer-glanz.exe.xyz, the tag kept its old host,
//     and the app started answering "not one of ours" to a tag that was never wrong.
//
//     decision-40 answers that by making timesheets.exe.xyz the PERMANENT tag host again,
//     so this literal is now the LIVE host rather than a legacy one. The assertion does not
//     change and must not: whichever side of the split it lands on, this exact URI has to
//     parse, because it is glued to a wall.
//
//     These literals are deliberately NOT read from branding: they are field facts, and a
//     check that derives them from the same file it is checking cannot fail. Point
//     ts.tagHost at anything else without adding the old value to ts.legacyTagHosts and
//     this section goes red — which is the entire reason it is written this way.
// ---------------------------------------------------------------------------------
private const val HOIV_LOCATION = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"

private fun fieldTags() {
    // TAG A, written with NFC Tools in July, HOIV Arsenalstraße 11. The exact bytes on the
    // card. This is the assertion the whole two-host model exists to keep green.
    check(
        tags.locationId("https://timesheets.exe.xyz/t?l=$HOIV_LOCATION") == HOIV_LOCATION,
        "the tag physically on the wall at HOIV parses (keep timesheets.exe.xyz as ts.tagHost, " +
            "or add it to ts.legacyTagHosts)",
    )
    // ...and every legacy host declared in branding parses, not just the one pinned above.
    for (legacy in legacyHosts) {
        check(
            tags.locationId("https://$legacy/t?l=$UUID_A") == UUID_A,
            "declared legacy host is accepted: $legacy",
        )
        check(
            tags.locationId("https://${legacy.uppercase()}/t/?l=${UUID_A.uppercase()}") == UUID_A,
            "legacy host gets the same case/trailing-slash handling as the live one: $legacy",
        )
    }

    // THE CURRENT HOST IS STILL THE CURRENT HOST. A legacy entry must never displace it.
    check(
        tags.locationId("https://$host/t?l=$HOIV_LOCATION") == HOIV_LOCATION,
        "a tag rewritten with the live host parses too",
    )

    // A SECOND HOST IS NOT A SECOND SHAPE. Every negative below is re-run against the
    // legacy host: widening the host set must widen NOTHING else.
    val legacy = legacyHosts.firstOrNull()
    if (legacy != null) {
        val stillRejected = listOf(
            "https://$legacy@evil.example.com/t?l=$UUID_A" to "userinfo does not make it our host",
            "http://$legacy/t?l=$UUID_A" to "legacy host over http is still not https",
            "https://$legacy/admin?l=$UUID_A" to "legacy host, wrong path",
            "https://$legacy/t?l=westbahnhof" to "legacy host, slug not uuid (decision-21)",
            "https://$legacy/t?l=1-1-1-1-1" to "legacy host, lenient-parser uuid",
            "https://evil-$legacy/t?l=$UUID_A" to "a host ENDING in ours is not ours",
            "https://$legacy.evil.example.com/t?l=$UUID_A" to "a host STARTING with ours is not ours",
        )
        for ((raw, why) in stillRejected) {
            check(tags.locationId(raw) == null, "must reject ($why): $raw")
        }
    }

    // An unrelated host is still nobody's tag, however many hosts are accepted.
    check(tags.locationId("https://evil.example.com/t?l=$UUID_A") == null, "unrelated host still rejected")

    // uriFor MINTS links, and nothing new is minted under a host we have stopped using.
    check(
        tags.uriFor(HOIV_LOCATION).toString() == "https://$host/t?l=$HOIV_LOCATION",
        "a synthesised link always carries the CURRENT host",
    )
}

// ---------------------------------------------------------------------------------
// 2. Retry classification. Retrying a 400 for ever is pointless; giving up on a 503
//    loses the shift.
// ---------------------------------------------------------------------------------
private fun retryClassification() {
    check(ApiFailure.network().isRetryable, "transport failure retryable")
    check(ApiFailure(503, "http_503").isRetryable, "5xx retryable")
    check(ApiFailure(429, "too_many_attempts").isRetryable, "429 retryable")
    check(ApiFailure(408, "http_408").isRetryable, "408 retryable")
    // The one non-obvious rule: an OLDER shift of ours is still open on the server. The
    // next pass closes it first (SyncPlan is start-time ordered) and this open then lands.
    check(ApiFailure(409, "shift_already_open").isRetryable, "409 already-open retryable")
    check(!ApiFailure(400, "invalid_uuid").isRetryable, "400 terminal")
    check(!ApiFailure(422, "unknown_worker").isRetryable, "422 terminal")
    check(!ApiFailure(404, "unknown_shift").isRetryable, "404 terminal")
    check(!ApiFailure(401, "unauthorized").isRetryable, "401 terminal")
    // A rejected enrolment code must NEVER be retried by anything automatic. It is
    // single-use and rate-limited: a retry loop would burn the worker's attempts and
    // then lock the phone out for 15 minutes.
    check(!ApiFailure(401, "invalid_code").isRetryable, "401 invalid_code terminal")

    // The whole rejection path for a tag the server does not know: 422 -> terminal ->
    // the row is blocked and shown in red with an admin-facing message. There is no
    // client-side roster guard that could pre-empt this with a worse answer, and there
    // must never be one — that guard cost the iOS owner paid time at a door.
    val unknown = ApiFailure(422, "unknown_location")
    check(!unknown.isRetryable, "422 unknown_location terminal")
    check(SyncPlan.blocksRow(unknown), "422 unknown_location blocks the row")
    check(!SyncPlan.blocksRow(ApiFailure.network()), "a network failure never blocks a row")

}

// ---------------------------------------------------------------------------------
// 3. The wire bytes. Diff these against server/routes/app.js by eye. The iOS client
//    once sent {id, worker, tagUID, start, end, manualFinish} and got 400 on every
//    single POST, silently, for weeks.
// ---------------------------------------------------------------------------------
private fun wireBytes() {
    // Same fixture instant as NFCTimeSheets/checks/tag-link-check.swift.
    val start = Instant.ofEpochMilli(1_784_000_591_412L)
    check(Wire.string(start) == "2026-07-14T03:43:11.412Z", "ISO-8601, UTC, fractional: ${Wire.string(start)}")
    check(
        Wire.string(Instant.ofEpochSecond(1_784_000_591L)) == "2026-07-14T03:43:11Z",
        "whole seconds carry no fractional part",
    )

    val open = OpenShiftRequest(UUID_B, UUID_A, start).toJson()
    check(
        open == """{"client_uuid":"$UUID_B","location_uuid":"$UUID_A","start_time":"2026-07-14T03:43:11.412Z"}""",
        "POST /shifts/open body: $open",
    )
    // decision-22. If someone "helpfully" adds a worker field back to make a server error
    // go away, this line fails first.
    check(!open.contains("worker"), "no worker identity may ride in a shift body")

    val close = CloseShiftRequest(UUID_B, start, autoClosed = false).toJson()
    check(
        close == """{"client_uuid":"$UUID_B","end_time":"2026-07-14T03:43:11.412Z","auto_closed":false}""",
        "POST /shifts/close body: $close",
    )
    check(!close.contains("worker"), "no worker identity in the close body either")

    val resolve = ResolveShiftRequest(start).toJson()
    check(resolve == """{"end_time":"2026-07-14T03:43:11.412Z"}""", "POST /shifts/:id/resolve body: $resolve")

    // POST /auth/code. ONE field. decision-22 again: the code is the whole claim, and
    // who it belongs to was decided by the admin who issued it, not by this phone.
    val enrol = EnrolmentRequest("K7QF3MZ2").toJson()
    check(enrol == """{"code":"K7QF3MZ2"}""", "POST /auth/code body: $enrol")
    check(!enrol.contains("worker"), "no worker identity may ride in an enrolment body")

    // Our own writer, so its escaping is ours to get wrong.
    check(
        OpenShiftRequest("a\"b\\c", UUID_A, start).toJson().contains("""a\"b\\c"""),
        "quotes and backslashes are escaped",
    )
}

// ---------------------------------------------------------------------------------
// 4. Decoding what the server actually sends.
// ---------------------------------------------------------------------------------
private fun wireDecoding() {
    val body = """
        {"id":41,"worker_id":7,"location_id":"$UUID_A",
         "start_time":"2026-07-14T03:43:11.412Z","end_time":"2026-07-14T11:43:11.000Z",
         "auto_closed":true,"corrected_at":null,"client_uuid":"$UUID_B",
         "location_slug":"westbahnhof","location_name":"Westbahnhof"}
    """.trimIndent()
    val shift = Wire.shift(JSONObject(body))
    check(shift.id == 41 && shift.workerId == 7, "shift ids decode")
    check(shift.startTime == Instant.ofEpochMilli(1_784_000_591_412L), "fractional-second timestamp decodes")
    check(shift.needsResolution, "auto_closed + corrected_at null => needs resolution")
    check(shift.locationSlug == "westbahnhof", "slug rides along for display only")

    // Postgres drops .000, so whole-second timestamps must decode too. A decoder that
    // only knew one shape would throw on an otherwise perfect response.
    val plain = """{"id":1,"worker_id":1,"location_id":"$UUID_A","start_time":"2026-07-14T03:43:11Z",
        "end_time":null,"auto_closed":false,"corrected_at":null,"client_uuid":null}""".trimIndent()
    val openShift = Wire.shift(JSONObject(plain))
    check(openShift.endTime == null && !openShift.needsResolution, "open shift decodes")
    check(openShift.clientUuid == null, "a null client_uuid decodes as null, not \"null\"")

    val roster = JSONObject("""{"worker":{"id":7,"name":"Anna"},"locations":[{"id":"$UUID_A","slug":"w","name":"Westbahnhof"}]}""")
    check(Wire.worker(roster.getJSONObject("worker")).name == "Anna", "worker decodes")
    check(Wire.location(roster.getJSONArray("locations").getJSONObject(0)).id == UUID_A, "location id is the tag uuid")

    // decision-44: the whole envelope, WITH zones.
    val fullRoster = Wire.roster(
        JSONObject(
            """{"worker":{"id":7,"name":"Anna"},
                "locations":[{"id":"$UUID_A","slug":"w","name":"Westbahnhof"}],
                "zones":[{"id":"$UUID_B","location_id":"$UUID_A","name":"Haupteingang",
                          "tag_serial":"04:A1:A8:52:AE:5C:80"}]}""",
        ),
    )
    check(fullRoster.locations.single().id == UUID_A, "roster() still decodes locations")
    check(fullRoster.zones.single().id == UUID_B, "roster() decodes the additive zones array")
    check(fullRoster.zones.single().tagSerial == "04:A1:A8:52:AE:5C:80", "zone tag_serial rides along")

    // THE RED CASE, shown RED before it was fixed: an older server has no "zones" key
    // at all. `getJSONArray("zones")` throws `org.json.JSONException` on exactly this
    // body -- verified by writing Wire.roster() with getJSONArray first, watching this
    // assertion below fail with that exception, then switching to optJSONArray. It must
    // stay optJSONArray: this is the concrete "server older than the app" case named in
    // the workflow brief, and it must degrade, never throw.
    val noZonesKey = JSONObject(
        """{"worker":{"id":7,"name":"Anna"},
            "locations":[{"id":"$UUID_A","slug":"w","name":"Westbahnhof"}]}""",
    )
    val degraded = Wire.roster(noZonesKey)
    check(degraded.locations.single().id == UUID_A, "a zones-less roster still decodes its locations")
    check(degraded.zones.isEmpty(), "a missing \"zones\" key degrades to an empty list, never a throw")

    // A PRESENT but empty array must decode the same way (HOIV's shape today: migration
    // 006 landed, zero zone rows).
    val emptyZones = JSONObject(noZonesKey.toString()).put("zones", org.json.JSONArray())
    check(Wire.roster(emptyZones).zones.isEmpty(), "an empty zones array decodes to an empty list too")
}

// ---------------------------------------------------------------------------------
// 5. Cold-launch tap ordering. This is the defect that shipped on iOS: a tag tap on a
//    fresh install produced no shift at all. Both orderings must handle a tap EXACTLY
//    once. The consumer below is the one in TimeSheetViewModel, spelled out.
// ---------------------------------------------------------------------------------
private class Consumer(private val inbox: TapInbox) {
    private var mounted = false
    val handled = mutableListOf<String>()

    /** Observer: only fires while the screen is in the hierarchy, and guards on non-null. */
    fun observe() {
        if (!mounted) return
        if (inbox.pendingLocationId == null) return
        inbox.take()?.let { handled += it }
    }

    /** The screen appears and drains whatever was parked before it existed. */
    fun mount() {
        mounted = true
        inbox.take()?.let { handled += it }
    }
}

private fun accept(inbox: TapInbox, consumer: Consumer, id: String) {
    inbox.accept(id)
    consumer.observe()
}

private fun tapOrdering() {
    var clock = 0L
    fun inbox() = TapInbox { clock }

    // ordering 1: set BEFORE the screen exists — the tap that launched the app. This is
    // the case that must not be lost, and the one that WAS lost on iOS.
    run {
        val box = inbox()
        val c = Consumer(box)
        accept(box, c, UUID_A)
        check(c.handled.isEmpty(), "nothing is handled before the screen exists")
        c.mount()
        check(c.handled == listOf(UUID_A), "launch tap survives to mount: ${c.handled}")
        c.observe() // take() nulled it; the echo must not count as a second tap
        check(c.handled == listOf(UUID_A), "the null echo after take() is not a second tap")
    }

    // ordering 2: set AFTER the screen exists — app already open.
    run {
        val box = inbox()
        val c = Consumer(box)
        c.mount()
        check(c.handled.isEmpty(), "mounting with an empty inbox handles nothing")
        accept(box, c, UUID_A)
        check(c.handled == listOf(UUID_A), "foreground tap handled once: ${c.handled}")
        c.observe()
        check(c.handled == listOf(UUID_A), "still once after the null echo")
    }

    // One physical tap can be delivered twice on Android too: the App Link ACTION_VIEW
    // and, on Android <= 15, ACTION_NDEF_DISCOVERED forwarded from NfcTapActivity.
    // Without the window that clocks in and straight back out.
    run {
        clock = 0
        val box = inbox()
        val c = Consumer(box)
        c.mount()
        accept(box, c, UUID_A)
        accept(box, c, UUID_A)
        check(c.handled == listOf(UUID_A), "a duplicate delivery of one tap is swallowed")
        accept(box, c, UUID_B)
        check(c.handled == listOf(UUID_A, UUID_B), "a different tag inside the window still counts")
        clock = 3_000
        accept(box, c, UUID_A)
        check(c.handled == listOf(UUID_A, UUID_B, UUID_A), "the same tag AFTER the window is a real second tap")
    }

    // Set-before-mount is deduped too: the second delivery must not queue a second tap
    // that only surfaces once the screen appears.
    run {
        clock = 0
        val box = inbox()
        val c = Consumer(box)
        accept(box, c, UUID_A)
        accept(box, c, UUID_A)
        c.mount()
        check(c.handled == listOf(UUID_A), "one launch tap, not two: ${c.handled}")
    }
}

// ---------------------------------------------------------------------------------
// 6. The offline queue. A tap in a basement must still count, and must land exactly once.
// ---------------------------------------------------------------------------------
private fun queued(
    key: String,
    workerId: Int = 7,
    locationId: String = UUID_A,
    startsAt: Long = 0,
    endTime: Instant? = null,
    openSyncedAt: Instant? = null,
    closeSyncedAt: Instant? = null,
    syncBlocked: Boolean = false,
) = QueuedShift(
    clientUuid = key,
    workerId = workerId,
    locationId = locationId,
    startTime = Instant.EPOCH.plusSeconds(startsAt),
    endTime = endTime,
    autoClosed = false,
    openSyncedAt = openSyncedAt,
    closeSyncedAt = closeSyncedAt,
    syncBlocked = syncBlocked,
)

private fun syncPlan() {
    val t1 = Instant.EPOCH.plusSeconds(3_600)

    // A fresh clock-in: OPEN only. decision-19 — the shift is posted at clock-IN with
    // end_time NULL, and closed by a SECOND call.
    run {
        val pass = SyncPlan.plan(listOf(queued(UUID_B)), sessionWorkerId = 7)
        check(pass.steps.size == 1 && pass.steps[0] is SyncPlan.Step.Open, "a running shift posts open only")
        check(pass.blocks.isEmpty(), "nothing blocked")
    }

    // A shift taken with no signal and finished with no signal: open THEN close, in that
    // order, in one pass. Closing something the server never heard of is 404.
    run {
        val pass = SyncPlan.plan(listOf(queued(UUID_B, endTime = t1)), sessionWorkerId = 7)
        check(
            pass.steps.map { it::class.simpleName } == listOf("Open", "Close"),
            "open before close for the same shift: ${pass.steps}",
        )
        check(pass.steps.all { it.clientUuid == UUID_B }, "both halves share the idempotency key")
    }

    // Oldest first ACROSS shifts. The server allows one open shift per worker, so a newer
    // open 409s until the older one is closed.
    run {
        val newer = queued("newer", startsAt = 500)
        val older = queued("older", startsAt = 100, endTime = t1)
        val pass = SyncPlan.plan(listOf(newer, older), sessionWorkerId = 7)
        check(
            pass.steps.map { it.clientUuid } == listOf("older", "older", "newer"),
            "oldest shift first: ${pass.steps.map { it.clientUuid }}",
        )
    }

    // Already acknowledged: nothing to do. This is what makes a double tap at the door
    // and a retry after a dropped connection produce ONE row.
    run {
        val done = queued(UUID_B, endTime = t1, openSyncedAt = t1, closeSyncedAt = t1)
        check(SyncPlan.plan(listOf(done), 7).steps.isEmpty(), "a fully synced shift is not re-sent")
        val running = queued(UUID_B, openSyncedAt = t1)
        check(SyncPlan.plan(listOf(running), 7).steps.isEmpty(), "an acknowledged open shift is not re-sent")
    }

    // Half synced: the close still has to go, and the open must NOT be repeated.
    run {
        val half = queued(UUID_B, endTime = t1, openSyncedAt = t1)
        val pass = SyncPlan.plan(listOf(half), 7)
        check(pass.steps.size == 1 && pass.steps[0] is SyncPlan.Step.Close, "only the close is outstanding")
    }

    // Terminal rows. Both are data-integrity failures, so they are reported and never
    // retried rather than being pushed under whoever happens to be signed in.
    run {
        val noLocation = queued(UUID_B, locationId = "")
        val pass = SyncPlan.plan(listOf(noLocation), 7)
        check(pass.steps.isEmpty(), "a row with no location is never sent")
        check(
            pass.blocks == listOf(SyncPlan.Block(UUID_B, SyncPlan.Block.MISSING_LOCATION)),
            "a row with no location is blocked, loudly: ${pass.blocks}",
        )
    }
    run {
        val otherAccount = queued(UUID_B, workerId = 9)
        val pass = SyncPlan.plan(listOf(otherAccount), sessionWorkerId = 7)
        check(pass.steps.isEmpty(), "another account's row is never pushed under this session")
        check(
            pass.blocks == listOf(SyncPlan.Block(UUID_B, SyncPlan.Block.WRONG_ACCOUNT)),
            "another account's row is blocked: ${pass.blocks}",
        )
    }
    run {
        val blocked = queued(UUID_B, syncBlocked = true)
        check(SyncPlan.plan(listOf(blocked), 7).steps.isEmpty(), "a blocked row stops retrying for ever")
    }

    // A row adopted from the server (GET /shifts/open) carries the server's worker id, so
    // it must plan cleanly under that session and generate no traffic of its own.
    run {
        val adopted = queued(UUID_B, workerId = 7, openSyncedAt = t1)
        check(SyncPlan.plan(listOf(adopted), 7).steps.isEmpty(), "an adopted open shift needs no push")
    }
}

// ---------------------------------------------------------------------------------
// 7. Strings. decision-8: no hardcoded user-visible strings. A server error code with no
//    resource behind it would render as a blank line at a door in the dark.
// ---------------------------------------------------------------------------------
private fun keysIn(file: File): Set<String> {
    val text = file.readText()
    val names = Regex("""<(?:string|plurals)\s+name="([^"]+)"""").findAll(text).map { it.groupValues[1] }
    return names.toSet()
}

private fun stringResources() {
    val de = File("app/src/main/res/values/strings.xml")
    val en = File("app/src/main/res/values-en/strings.xml")
    check(de.exists() && en.exists(), "both locales exist")

    val deKeys = keysIn(de)
    val enKeys = keysIn(en)
    check((deKeys - enKeys).isEmpty(), "missing from values-en: ${deKeys - enKeys}")
    check((enKeys - deKeys).isEmpty(), "missing from values (German default): ${enKeys - deKeys}")

    // app_name comes from branding.properties via resValue(). Declaring it in a strings
    // file as well is a duplicate-resource build failure that only Gradle would find.
    check("app_name" !in deKeys && "app_name" !in enKeys, "app_name is supplied by resValue, not strings.xml")

    // Every code ApiFailure can classify must have a string behind it.
    val codes = listOf(
        "network", "unknown_worker", "unknown_location", "unknown_shift", "shift_already_open",
        "end_before_start", "timestamp_in_future", "timestamp_out_of_range", "unauthorized",
        "no_session", "invalid_token", "invalid_code", "too_many_attempts",
        "missing_location", "wrong_account",
        "http_500", "invalid_field",
    )
    for (code in codes) {
        val key = ApiFailure(400, code).messageKey
        check(key in deKeys, "ApiFailure code '$code' -> '$key' has no German string")
    }
    // The two SyncPlan block reasons are rendered the same way.
    for (reason in listOf(SyncPlan.Block.MISSING_LOCATION, SyncPlan.Block.WRONG_ACCOUNT)) {
        check(ApiFailure(0, reason).messageKey in deKeys, "SyncPlan block '$reason' has no string")
    }

    // German is the DEFAULT locale (decision-8), i.e. what any unmatched phone falls back
    // to. If someone moves English into values/ this fails.
    check(de.readText().contains("Objekt"), "values/ is the German locale (vocabulary: Objekt)")
    check(en.readText().contains("location"), "values-en/ is the English locale")

    // stringIdFor() is the ONE place a stored resource name becomes an id, and it is an
    // explicit `when` rather than getIdentifier() so a typo cannot render a blank error
    // at a door in the dark. It lives in the ui package and imports R, so it cannot be
    // compiled here — read it as text instead. A missing arm is worse than no check.
    val mapper = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetViewModel.kt").readText()
    for (key in deKeys.filter { it.startsWith("err_") }) {
        check(mapper.contains("\"$key\" -> R.string.$key"), "stringIdFor() has no arm for '$key'")
    }
}

// ---------------------------------------------------------------------------------
// 8. The manifest. Every line below is one of the named traps, and each one fails
//    SILENTLY on a device: the tap just does nothing and the worker cleans for free.
// ---------------------------------------------------------------------------------
private fun manifestAndWiring() {
    val raw = File("app/src/main/AndroidManifest.xml").readText()
    // Strip comments first: the Android-17 instructions below are written out in a
    // comment on purpose, and a naive substring test would read them as live attributes.
    val live = raw.replace(Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL), "")

    check(live.contains("android:autoVerify=\"true\""), "App Links are declared with autoVerify")
    check(live.contains("android.intent.action.VIEW"), "Android 16+ tag path: ACTION_VIEW App Link")
    check(live.contains("android.nfc.action.NDEF_DISCOVERED"), "Android <=15 tag path: ACTION_NDEF_DISCOVERED")

    // Deprecated in Android 17, and the catch-all that makes this app fight every other
    // NFC app on the phone for every tag ever presented.
    check(
        !live.contains("android.nfc.action.TAG_DISCOVERED"),
        "ACTION_TAG_DISCOVERED must never be filtered",
    )

    // TRAP: android:permission restricts who may START an activity. On Android <= 16 the
    // DISPATCH_NFC_MESSAGE permission does not exist, so nobody holds it, so the activity
    // becomes unstartable — on exactly the devices the NDEF filter exists for. It goes in
    // only when targetSdk moves past 36, and only on NfcTapActivity.
    check(
        !live.contains("DISPATCH_NFC_MESSAGE"),
        "DISPATCH_NFC_MESSAGE must stay commented out while targetSdk <= 36",
    )
    check(raw.contains("DISPATCH_NFC_MESSAGE"), "...but the Android-17 instruction must still be written down")

    check(live.contains("\${tagHost}"), "the tag host is a manifest placeholder, not a literal")

    // THE SPLIT (decision-40). Only the PERMANENT host is claimed. The API host is
    // renameable, and a renameable host in an autoVerify filter is the original bug with a
    // longer fuse: rename the box and taps stop, on every tag, including the ones on the
    // permanent host.
    check(
        !live.contains("\${apiHost}") && !raw.contains(apiHost),
        "the API host must NOT appear in AndroidManifest.xml — it is renameable, and App Link " +
            "verification is all-or-nothing across the hosts in a filter",
    )

    // THE TRAP THAT WOULD BREAK THE TAGS THAT CURRENTLY WORK.
    //
    // App Link verification is ALL-OR-NOTHING across every host named in an autoVerify
    // intent-filter: Android fetches assetlinks.json from each, and one host that stops
    // serving it leaves the app UNVERIFIED for the live host too. So "just add it to the
    // filter as well" trades passive tap on the old tags for passive tap on ALL tags.
    // Legacy hosts are a PARSER widening (BuildConfig.LEGACY_TAG_HOSTS), never a manifest
    // host.
    for (legacy in legacyHosts) {
        check(
            !raw.contains(legacy),
            "legacy host '$legacy' must NOT be in AndroidManifest.xml — autoVerify is " +
                "all-or-nothing and one host that stops serving un-verifies the live one",
        )
    }

    // The join between the gradle-side list and the parser. Both ends are proven (the
    // build fails on a missing key; section 1b runs the real parser) but the one line that
    // connects them imports Android and can only be read as text.
    val application = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/TimeSheetsApplication.kt").readText()
    check(
        application.contains("TagLink(BuildConfig.TAG_HOST, BuildConfig.LEGACY_TAG_HOSTS.toList())"),
        "the app's TagLink is built with the legacy hosts, not the live host alone",
    )
    val gradle = File("app/build.gradle.kts").readText()
    check(
        gradle.contains("brandList(\"ts.legacyTagHosts\")"),
        "BuildConfig.LEGACY_TAG_HOSTS comes from branding.properties",
    )
    check(
        gradle.contains("buildConfigField(\"String\", \"API_HOST\", \"\\\"\${brand(\"ts.apiHost\")}\\\"\")"),
        "BuildConfig.API_HOST comes from branding.properties",
    )

    // THE OTHER HALF OF THE SPLIT: the app must TALK to the API host. Parsing the tag host
    // and then calling it is the pre-decision-40 behaviour, and it is invisible until the
    // day the two differ — which is today.
    val api = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/net/Api.kt").readText()
    check(
        api.contains("val base = \"https://\${BuildConfig.API_HOST}\""),
        "Api.kt talks to BuildConfig.API_HOST, never TAG_HOST",
    )
    check(
        !api.contains("BuildConfig.TAG_HOST"),
        "Api.kt must not reference the tag host at all — it is a string on a card, not an endpoint",
    )

    // THE JOIN between "Android delivered the intent" and "TagLink parsed it". Both ends
    // are proven elsewhere — the manifest filter above, and section 1 which runs the real
    // parser — but the four lines that connect them import Android and so can only be read
    // as text. They were exercised once on an emulator with:
    //   adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
    //     -d "https://<tagHost>/t?l=<uuid>"
    // which is not repeatable in this runner. Deleting any one of them makes a tap open the
    // app and then do nothing, which is the failure mode that looks exactly like success.
    val activity = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/MainActivity.kt").readText()
    check(
        activity.contains("if (intent?.action != Intent.ACTION_VIEW) return"),
        "MainActivity.handle only acts on ACTION_VIEW",
    )
    check(
        activity.contains("app.tagLink.locationId(intent.dataString) ?: return"),
        "MainActivity.handle parses the URL with TagLink and drops anything else (decision-15)",
    )
    check(activity.contains("model.acceptTap(locationId)"), "a parsed tap reaches the inbox")

    // COLD-LAUNCH ORDERING. On a tap-launch the intent is already present while the session
    // is still Unknown, so handle() must run before setContent — TapInbox parks it until a
    // screen exists. This exact ordering is what lost the owner's first real tap on iOS.
    check(
        activity.indexOf("handle(intent)") in 0 until activity.indexOf("setContent {"),
        "handle(intent) runs before the first composition",
    )
    // singleTask means a tap while the app is open is delivered here, not to a new instance.
    check(activity.contains("override fun onNewIntent"), "a tap on a running app is handled")

    // WHITE LABEL: the operator's host is typed in exactly one place. A second copy in
    // source is how an App Link silently stops matching the tags already on the walls.
    val sources = File("app/src").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "xml") }
    for (file in sources) {
        val text = file.readText()
        check(!text.contains(host), "$host is hardcoded in ${file.path} — it belongs in branding.properties")
        check(!text.contains(apiHost), "$apiHost is hardcoded in ${file.path} — it belongs in branding.properties")
        // Same rule for the old hosts. A legacy host pasted into source is how the accepted
        // set stops matching the tags on the walls the day someone edits only one of them.
        for (legacy in legacyHosts) {
            check(!text.contains(legacy), "$legacy is hardcoded in ${file.path} — it belongs in branding.properties")
        }
    }
}

// ---------------------------------------------------------------------------------
// 8b. ZONES (decision-43, decision-44). Pure decision logic first, then the two seams
//     that only compile on-device (ShiftStore's DB migration, TimeSheetViewModel's tap
//     and material paths), read as text — the same convention section 8 already uses for
//     data/ and ui/.
// ---------------------------------------------------------------------------------
private fun zones() {
    val hoiv = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"
    val otherBuilding = "6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d"
    val zoneOfHoiv = WireZone(id = "11111111-1111-1111-1111-111111111111", locationId = hoiv, name = "Haupteingang", tagSerial = "04:A1:A8:52:AE:5C:80")
    val zoneOfHoiv2 = WireZone(id = "22222222-2222-2222-2222-222222222222", locationId = hoiv, name = "Tiefgarage", tagSerial = null)
    val zoneOfOther = WireZone(id = "33333333-3333-3333-3333-333333333333", locationId = otherBuilding, name = "Eingang", tagSerial = null)
    val cache = listOf(zoneOfHoiv, zoneOfHoiv2, zoneOfOther)

    // ---- Zones.buildingIdOf ------------------------------------------------------
    check(Zones.buildingIdOf(zoneOfHoiv.id, cache) == hoiv, "a zone resolves to its building")
    check(Zones.buildingIdOf(hoiv, cache) == hoiv, "a building id is already its own building id")
    check(Zones.buildingIdOf(zoneOfOther.id, cache) == otherBuilding, "a different zone resolves to a different building")

    // THE RED CASE, shown RED before it was fixed: a SENTINEL default on a cache miss
    // (e.g. `?: "unknown"`) collapses every currently-uncached place onto one shared
    // value, so two DIFFERENT, unrelated buildings compare as "the same building" the
    // moment the roster cache is empty (a fresh install, an offline cold launch, or a
    // roster fetch ShiftSync.refreshRoster silently swallowed). Verified by implementing
    // buildingIdOf with that fallback first: this assertion failed, both unresolved ids
    // collapsed to "unknown" and compared equal. IDENTITY fixes it — see the fun's kdoc.
    val uncachedA = "44444444-4444-4444-4444-444444444444"
    val uncachedB = "55555555-5555-5555-5555-555555555555"
    check(
        Zones.buildingIdOf(uncachedA, emptyList()) != Zones.buildingIdOf(uncachedB, emptyList()),
        "two different cache-miss ids must stay different buildings, not collapse onto a sentinel",
    )
    check(
        Zones.buildingIdOf(uncachedA, emptyList()) == uncachedA,
        "a cache miss resolves to ITSELF (identity), never a placeholder string",
    )

    // THE OLD BUG, shown RED against a bare `==`: two zone taps in the SAME building must
    // read as a tap-OUT (decision-37's named risk), not as a building switch. A raw
    // `running.locationId == locationId` comparison treats zoneOfHoiv and zoneOfHoiv2 as
    // different places and would auto-close-and-reopen instead of closing. Verified by
    // comparing the raw ids directly here first: FALSE, i.e. red. buildingIdOf fixes it.
    check(zoneOfHoiv.id != zoneOfHoiv2.id, "sanity: the two HOIV zones really are different raw ids")
    check(
        Zones.buildingIdOf(zoneOfHoiv.id, cache) == Zones.buildingIdOf(zoneOfHoiv2.id, cache),
        "two zones of the SAME building compare equal once resolved (the fix TimeSheetViewModel.sameBuilding relies on)",
    )
    check(
        Zones.buildingIdOf(zoneOfHoiv.id, cache) != Zones.buildingIdOf(zoneOfOther.id, cache),
        "zones of DIFFERENT buildings still compare unequal",
    )

    // ---- Zones.zonePlaceIdForSerial + Zones.normaliseSerial ----------------------
    check(
        Zones.zonePlaceIdForSerial("04:A1:A8:52:AE:5C:80", cache) == zoneOfHoiv.id,
        "a roster-cached serial resolves to its zone's place id, not its building id",
    )
    check(Zones.zonePlaceIdForSerial("04a1a852ae5c80", cache) == zoneOfHoiv.id, "any casing/separator style matches")
    check(Zones.zonePlaceIdForSerial("04:A1:A8:52:AE:5C:81", cache) == null, "one byte off must NOT match")
    check(Zones.zonePlaceIdForSerial(null, cache) == null, "a null serial resolves to nothing")
    check(Zones.zonePlaceIdForSerial("  ", cache) == null, "a blank serial resolves to nothing")
    check(Zones.zonePlaceIdForSerial("04:A1:A8:52:AE:5C:80", emptyList()) == null, "an empty cache matches nothing")

    // THE ROUND TRIP, same discipline known-tags-check.kt already runs for the compiled
    // table: what a scan resolves must also be what TagLink accepts back, or a worker
    // holding a tag the roster knows about gets "unknown tag" anyway.
    val link = TagLink(host, legacyHosts)
    val resolved = Zones.zonePlaceIdForSerial("04:A1:A8:52:AE:5C:80", cache)
    check(resolved != null, "the fixture serial resolves")
    val synthesised = link.uriFor(resolved)
    check(synthesised != null, "uriFor builds a link from the resolved zone id")
    check(link.locationId(synthesised.toString()) == resolved, "round trip: what we synthesise, we must also accept")

    // normaliseSerial agreeing with the pre-refactor inline logic KnownTags.locationIdFor
    // used to carry itself, on the same case table known-tags-check.kt already pins.
    val canonical = "04:A1:A8:52:AE:5C:80"
    for ((input, why) in listOf(
        "04:a1:a8:52:ae:5c:80" to "lowercase",
        "04A1A852AE5C80" to "no separators",
        "04-A1-A8-52-AE-5C-80" to "dashes",
        "04 A1 A8 52 AE 5C 80" to "spaces",
    )) {
        check(Zones.normaliseSerial(input) == canonical, "normaliseSerial($why) matches the pre-refactor table")
    }
    check(Zones.normaliseSerial("04:A1:A8:52:AE:5C:81") != canonical, "one byte off still normalises to a DIFFERENT value")
    check(Zones.normaliseSerial(null) == null, "null normalises to null")
    check(Zones.normaliseSerial("   ") == null, "blank normalises to null")

    // ---- ShiftStore's DB migration, read as text (cannot run off-device) ---------
    // THE #1 THING THE OWNER MUST VERIFY BY HAND: this runs against the field phone's
    // real, already-installed SQLite file on its very next launch after `adb install -r`.
    val shiftStore = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/data/ShiftStore.kt").readText()
    check(shiftStore.contains("null, 2)"), "ShiftStore is on database version 2")
    check(
        Regex("""if \(oldVersion == 1 && newVersion == 2\)""").containsMatchIn(shiftStore),
        "onUpgrade has an explicit 1->2 branch",
    )
    val upgrade = shiftStore.substringAfter("override fun onUpgrade").substringBefore("\n\n    // ---- shifts")
    check(!upgrade.contains("DROP TABLE"), "the 1->2 migration never DROPs a table — these rows are unpaid hours")
    check(upgrade.contains("throw IllegalStateException"), "an unhandled version jump still refuses loudly rather than guessing")
    check(shiftStore.contains("fun replaceRoster("), "the roster cache writes locations AND zones in one call")
    check(shiftStore.contains("fun zones(): List<WireZone>"), "the cached zone table is readable back out")

    // ---- TimeSheetViewModel's tap and material paths, read as text ---------------
    val model = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetViewModel.kt").readText()
    val writeTap = model.substringAfter("private fun writeTap(").substringBefore("\n    /**")
    check(
        !Regex("""running\.locationId == locationId""").containsMatchIn(writeTap),
        "writeTap no longer compares raw tapped ids (decision-37's named risk)",
    )
    check(writeTap.contains("sameBuilding(running.locationId, locationId)"), "writeTap compares BUILDINGS, via Zones.buildingIdOf")

    val submitMaterial = model.substringAfter("fun submitMaterial(typed: String): Boolean {").substringBefore("\n        return true")
    check(
        submitMaterial.contains("Zones.buildingIdOf(it, app.store.zones())"),
        "submitMaterial resolves the open shift's place through Zones.buildingIdOf before it can reach a material request",
    )
    check(
        !Regex("""enqueue\([^)]*locationId\s*=\s*_log\.value\.open\?\.locationId""").containsMatchIn(submitMaterial),
        "THE RED CASE, shown RED before it was fixed: the raw open-shift place id (which may " +
            "be a zone) must never reach materials.enqueue directly — that 422s on " +
            "POST /material-requests (v.activeLocation is buildings-only, decision-6) and the " +
            "row is classified BLOCKED, a silent-looking support ticket with no obvious cause",
    )
}

// ---------------------------------------------------------------------------------
// 9. The enrolment code as typed by a human (decision-26).
//
//    This is the ONE piece of the Android sign-in that can be got wrong in pure logic
//    rather than on a device, and getting it wrong is expensive in a specific way: the
//    code is a 40-bit shared secret behind a HARD rate limiter, so a normalisation bug
//    does not produce a retry, it produces a lockout and a second phone call.
// ---------------------------------------------------------------------------------
private const val CODE = "K7QF3MZ2"

private fun enrolmentCode() {
    check(EnrolmentCode.normalise(CODE) == CODE, "a canonical code survives untouched")

    // What a tired cleaner actually types, at a door, on a phone keyboard.
    val forgiven = listOf(
        "k7qf3mz2" to "lower case",
        "K7QF-3MZ2" to "the hyphen the admin panel displays",
        "  K7QF 3MZ2  " to "spaces, including leading and trailing",
        "k7qf 3mz2" to "both at once",
        "K7QF\u00a03MZ2" to "a non-breaking space pasted out of a chat app",
        "K7QF\u20113MZ2" to "a non-breaking hyphen, same source",
        "K7QF_3MZ2" to "underscore",
        "K7QF.3MZ2" to "full stop",
        "K7QF\n3MZ2" to "a newline from a paste",
    )
    for ((typed, why) in forgiven) {
        check(EnrolmentCode.normalise(typed) == CODE, "must forgive ($why): [$typed]")
    }

    // The aliased letters. These are not merely absent from the alphabet, they are
    // mapped IN, so hearing "oh" and typing O costs nothing.
    check(EnrolmentCode.normalise("O7QF3MZ2") == "07QF3MZ2", "O becomes zero")
    check(EnrolmentCode.normalise("o7qf3mz2") == "07QF3MZ2", "lower o becomes zero")
    check(EnrolmentCode.normalise("I7QF3MZ2") == "17QF3MZ2", "I becomes one")
    check(EnrolmentCode.normalise("l7qf3mz2") == "17QF3MZ2", "lower L becomes one")
    check(EnrolmentCode.normalise("L7QF3MZI") == "17QF3MZ1", "both aliases in one code")

    // Refused, silently and identically. Every one of these would otherwise be a wasted
    // attempt against a limiter that allows five.
    val refused = listOf(
        "" to "nothing typed",
        "K7QF3MZ" to "one short",
        "K7QF3MZ22" to "one long",
        "--------" to "eight separators is zero characters, not eight",
        "K7QF3MZ!" to "punctuation is stripped, leaving seven",
        "K7QF3MZ\u00fc" to "a German umlaut is not in any alphabet here",
        "K".repeat(EnrolmentCode.MAX_INPUT + 1) to "longer than the server will even look at",
    )
    for ((typed, why) in refused) {
        check(EnrolmentCode.normalise(typed) == null, "must refuse ($why): [$typed]")
    }

    // U is excluded from the alphabet and is NOT aliased anywhere, so it can only ever
    // be a mistyping -- it must fail, not silently become something else.
    check(EnrolmentCode.normalise("U7QF3MZ2") == null, "U is not in the alphabet and is not aliased")

    // 64 raw characters that reduce to a valid code is still fine: the cap is on input
    // length, exactly as the server applies it, not on the number of real characters.
    check(
        EnrolmentCode.normalise("K7QF3MZ2" + " ".repeat(EnrolmentCode.MAX_INPUT - 8)) == CODE,
        "separators may fill the input up to the cap",
    )

    check(EnrolmentCode.grouped(CODE) == "K7QF-3MZ2", "grouped for reading aloud")
    check(EnrolmentCode.normalise(EnrolmentCode.grouped(CODE)) == CODE, "grouped form round-trips")
}

// ---------------------------------------------------------------------------------
// 10. The client against the SERVER, read as source. Not against a copy of it.
//
//     A client that normalises differently from server/lib/enrolment.js hands the worker
//     "code not accepted" for a code that is correct, and burns a rate-limited attempt
//     doing it. Nothing on a device would tell you which side was wrong.
// ---------------------------------------------------------------------------------
private fun enrolmentAgainstServer() {
    check(serverEnrolment.exists(), "server/lib/enrolment.js is readable from android/")
    check(serverAuthRoute.exists(), "server/routes/auth.js is readable from android/")
    if (!serverEnrolment.exists() || !serverAuthRoute.exists()) return

    val js = serverEnrolment.readText()

    // The alphabet, the length and the input cap, lifted out of the server literally.
    val alphabet = Regex("""const ALPHABET = "([^"]+)"""").find(js)?.groupValues?.get(1)
    check(alphabet != null, "server ALPHABET literal still parses")
    check(alphabet?.length == 32, "the alphabet is 32 characters, i.e. exactly 5 bits")
    for (excluded in listOf('I', 'L', 'O', 'U')) {
        check(alphabet?.contains(excluded) == false, "'$excluded' must not be in the alphabet")
    }

    val length = Regex("""const CODE_CHARS = (\d+)""").find(js)?.groupValues?.get(1)?.toInt()
    check(length == EnrolmentCode.LENGTH, "code length: server $length vs client ${EnrolmentCode.LENGTH}")

    val maxInput = Regex("""const MAX_INPUT = (\d+)""").find(js)?.groupValues?.get(1)?.toInt()
    check(maxInput == EnrolmentCode.MAX_INPUT, "input cap: server $maxInput vs client ${EnrolmentCode.MAX_INPUT}")

    // The client regex is written out again in Kotlin, so assert it is the same set of
    // characters the server accepts, in the same order.
    val serverRe = Regex("""const CODE_RE = /\^\[([^\]]+)\]\{(\d+)\}\$/""").find(js)
    check(serverRe != null, "server CODE_RE literal still parses")
    if (serverRe != null && alphabet != null) {
        // Every character of the alphabet must normalise as itself, LENGTH at a time.
        for (ch in alphabet) {
            val candidate = ch.toString().repeat(EnrolmentCode.LENGTH)
            check(
                EnrolmentCode.normalise(candidate) == candidate,
                "the client rejects '$ch', which the server can issue",
            )
        }
    }

    // The route, the field name and the ONE error code, straight out of the handler.
    val route = serverAuthRoute.readText()
    check(route.contains("""path: "/auth/code""""), "POST /auth/code is the route the server serves")
    check(route.contains("normaliseCode(body.code)"), "the server reads the field this client sends: body.code")
    check(
        route.contains("""fail(401, "invalid_code")"""),
        "the server's rejection code is what ApiFailure maps",
    )
    // The rejection must be UNIFORM. If a future server change ever answers /auth/code
    // with a second code, this client would silently start showing a different message
    // for "expired" than for "wrong" -- which is the oracle decision-26 forbids.
    val codeAuthBody = route.substringAfter("async function codeAuth(").substringBefore("\n}\n")
    val failCodes = Regex("""fail\(\d+, "([a-z_]+)"\)""").findAll(codeAuthBody)
        .map { it.groupValues[1] }.toSet()
    check(
        failCodes == setOf("invalid_code"),
        "codeAuth must have exactly ONE rejection code, found: $failCodes",
    )
    check(
        !codeAuthBody.contains("expired") || !codeAuthBody.contains("""error": "expired"""),
        "no 'expired' is ever handed back",
    )

    // THE CODE IS NEVER LOGGED. This app has no logging at all, which is the cheapest
    // possible way to guarantee it; the check is that it stays that way.
    val sources = File("app/src/main/kotlin").walkTopDown().filter { it.extension == "kt" }.toList()
    for (file in sources) {
        val text = file.readText()
        check(!text.contains("android.util.Log"), "no logging in ${file.name} - a code must never reach one")
        check(!Regex("""\bprintln\(""").containsMatchIn(text), "no println in ${file.name}")
        check(!text.contains("System.out"), "no System.out in ${file.name}")
    }
    // ...and it must not be smuggled out through the error path either. ApiFailure is
    // the only thing that survives a failed attempt, and it carries a status and a code.
    val failure = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/core/ApiFailure.kt").readText()
    check(!failure.contains("enrol", ignoreCase = true), "ApiFailure carries nothing enrolment-specific")
}

// ---------------------------------------------------------------------------------
// 11. Session persistence. Process death is NORMAL on Android and is exactly when a
//     stopped-state tap arrives, so "did the cookie survive" is the common path, not a
//     rare one. The storage is SharedPreferences and cannot be run here; the DECISION
//     about what each response means to the stored session can be, and is.
// ---------------------------------------------------------------------------------
private fun sessionPersistence() {
    // Deliberately NOT hex and NOT high-entropy. The value is opaque to SessionCookie --
    // it is only ever echoed back -- so a credential-SHAPED fixture buys nothing and costs
    // a gitleaks generic-api-key hit on every commit. .gitleaks.toml allowlists fixtures by
    // SENTINEL and never by path, precisely so a real token pasted into a check file still
    // gets caught; the cheapest way to honour that here is a value no rule can mistake for
    // a secret, rather than a new allowlist entry that would blind the scanner to this file.
    val token = "notarealsessiontoken"
    val setCookie = "${SessionCookie.NAME}=$token; Path=/; Max-Age=7776000; HttpOnly; Secure; SameSite=Strict"

    check(
        SessionCookie.read(listOf(setCookie)) == SessionCookie.Update.Store(token),
        "a fresh session is stored",
    )
    check(SessionCookie.header(token) == "${SessionCookie.NAME}=$token", "and sent back as a Cookie header")
    check(SessionCookie.header(null) == null, "signed out sends no Cookie header")
    check(SessionCookie.header("") == null, "an empty stored value is not a session")

    // THE ONE THAT MATTERS. Every ordinary 200 -- a roster fetch, a clock-in -- carries
    // no Set-Cookie. Reading that as a logout would sign the worker out mid-shift.
    check(SessionCookie.read(emptyList()) == SessionCookie.Update.Ignore, "silence keeps the session")
    check(
        SessionCookie.read(listOf("other=x; Path=/", "csrf=y")) == SessionCookie.Update.Ignore,
        "somebody else's cookie is not our session",
    )

    // The server ending it, in both shapes it can send.
    check(
        SessionCookie.read(listOf("${SessionCookie.NAME}=; Path=/; Max-Age=0; HttpOnly")) == SessionCookie.Update.Clear,
        "logout clears",
    )
    check(
        SessionCookie.read(listOf("${SessionCookie.NAME}=stale; Path=/; Max-Age=0")) == SessionCookie.Update.Clear,
        "Max-Age=0 clears even with a value present",
    )
    check(
        SessionCookie.read(listOf("${SessionCookie.NAME}=stale; MAX-AGE=0")) == SessionCookie.Update.Clear,
        "the attribute is case-insensitive",
    )
    // ...but not a coincidence in the token, and not a longer max-age that starts with 0.
    check(
        SessionCookie.read(listOf("${SessionCookie.NAME}=max-age=0; Max-Age=7776000")) is SessionCookie.Update.Store,
        "'max-age=0' INSIDE the value is not a logout",
    )
    check(
        SessionCookie.read(listOf("${SessionCookie.NAME}=$token; Max-Age=90")) == SessionCookie.Update.Store(token),
        "Max-Age=90 is not Max-Age=0",
    )

    // Enrolment then a rejection on the same response list: last word wins.
    check(
        SessionCookie.read(listOf(setCookie, "${SessionCookie.NAME}=; Max-Age=0")) == SessionCookie.Update.Clear,
        "the last Set-Cookie for our name wins",
    )

    // The storage side, read as text. commit() and not apply(): an in-flight async write
    // is lost when the OS kills the process, and the next launch asks a worker for a code
    // they no longer have.
    val jar = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/net/CookieJar.kt").readText()
    check(jar.contains(".commit()"), "the session cookie is written with commit(), not apply()")
    check(!Regex("""putString\([^)]*\)\.apply\(\)""").containsMatchIn(jar), "no apply() on the session write")

    // The launch path, read as text: cache first so a cold start in a basement opens the
    // app, server second because the server is authoritative (decision-22), and a network
    // failure is NEVER a sign-out.
    val model = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetViewModel.kt").readText()
    val restore = model.substringAfter("fun restoreSession()").substringBefore("\n    /**")
    val cacheFirst = restore.indexOf("app.workers.read()")
    val askServer = restore.indexOf("app.api.session()")
    check(cacheFirst >= 0 && askServer >= 0, "restoreSession still reads the cache and the server")
    check(
        cacheFirst in 0 until askServer,
        "restoreSession reads the cache BEFORE it asks the server",
    )
    check(restore.contains("401 -> dropToSignedOut()"), "only a 401 signs the worker out")
    check(
        !restore.replace(Regex("//.*"), "").contains("403"),
        "there is no ineligible state on Android - the code names the worker",
    )
    // A phone that has never been enrolled must not be told it was "signed out", and
    // must not spend a round trip discovering a 401 whose answer is already on disk.
    // indexOf() returns -1 for absent, which would satisfy any `<` comparison, so the
    // presence is asserted first and separately.
    val guard = restore.indexOf("app.cookies.header() == null")
    check(guard >= 0, "restoreSession checks for a stored cookie before anything else")
    check(
        guard in 0 until restore.indexOf("app.api.session()"),
        "a launch with no cookie at all short-circuits before the server call",
    )

    // A rejected CODE must not latch the session-rejected flag: the very next successful
    // enrolment would refresh() straight into dropToSignedOut().
    val api = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/net/Api.kt").readText()
    check(
        api.contains("""post("/auth/code", EnrolmentRequest(code).toJson(), sessionBearing = false)"""),
        "/auth/code is not session-bearing, so its 401 is not a sign-out",
    )
    check(
        api.contains("HttpURLConnection.HTTP_UNAUTHORIZED && sessionBearing"),
        "the 401 choke point honours sessionBearing",
    )

    // And the sign-in path itself: normalise, one message, no reason. Comments stripped
    // first, because the prose in there says "expired or already-used" on purpose.
    val signIn = model.substringAfter("fun signIn(typedCode: String)").substringBefore("\n    /**")
        .replace(Regex("//.*"), "")
    check(signIn.contains("EnrolmentCode.normalise(typedCode)"), "signIn normalises before it sends")
    check(
        signIn.contains("""SessionState.SignedOut("err_invalid_code")"""),
        "a locally malformed code gets the SAME message as a server rejection",
    )
    check(
        !Regex("""\b(status == 401|status == 403|expired|already)\b""").containsMatchIn(signIn),
        "signIn must not branch on which kind of refusal it was",
    )
}

// ---------------------------------------------------------------------------------
// 12. Material requests, worker half. Ported case-for-case from
//     NFCTimeSheets/checks/materials-check.swift so the two clients cannot drift.
//
//     The bytes, the decoder against the shape server/routes/app.js actually returns,
//     and the four outcomes — which are the only place this feature can silently lose
//     something a worker asked for.
// ---------------------------------------------------------------------------------
private fun materialRequests() {
    // ---- the bytes. decision-22: who asked is the session's worker. --------------
    val withLocation = CreateMaterialRequest("zwei Mopps", UUID_A).toJson()
    check(
        withLocation == """{"body":"zwei Mopps","location_uuid":"$UUID_A"}""",
        "exact create bytes: $withLocation",
    )
    check(!withLocation.lowercase().contains("worker"), "NO worker field, ever: $withLocation")
    check(!withLocation.contains("status"), "the app never proposes a status: $withLocation")

    val bare = CreateMaterialRequest("Glasreiniger", null).toJson()
    check(bare == """{"body":"Glasreiniger","location_uuid":null}""", "no building -> explicit null: $bare")
    check(!bare.contains("location_id"), "the column name is not a wire name: $bare")

    // Free text is whatever a phone keyboard produces, and Wire.obj has to escape it.
    val awkward = CreateMaterialRequest("\"Ajax\"\n\tund 3 Säcke", null).toJson()
    check(awkward.contains("""\"Ajax\""""), "quotes escaped: $awkward")
    check(awkward.contains("""\n""") && awkward.contains("""\t"""), "control characters escaped: $awkward")
    check(awkward.contains("Säcke"), "umlauts are not mangled: $awkward")
    check(JSONObject(awkward).getString("body") == "\"Ajax\"\n\tund 3 Säcke", "and it round-trips")

    // ---- decoding, against the real response shape -------------------------------
    val full = JSONObject(
        """
        {"id": 7, "worker_id": 1, "location_id": "$UUID_A",
         "body": "der blaue Reiniger, der große", "status": "arrived",
         "admin_note": "5 Liter bestellt", "inventory_item_id": 3, "quantity": 2,
         "cost_cents": 1799, "decided_by": 1,
         "decided_at": "2026-08-01T09:00:00.000Z", "ordered_at": "2026-08-01T10:00:00.000Z",
         "arrived_at": "2026-08-04T07:30:00Z", "seen_at": null,
         "created_at": "2026-07-31T18:12:04.412Z",
         "location_name": "HOIV", "item_name": "Glasreiniger 5 l"}
        """.trimIndent(),
    )
    val row = Wire.materialRequest(full)
    check(row.id == 7 && row.status == MaterialStatus.ARRIVED, "id and status")
    check(row.itemName == "Glasreiniger 5 l" && row.locationName == "HOIV", "names ride along")
    check(row.adminNote == "5 Liter bestellt", "admin_note reaches the worker")
    check(row.quantity == 2, "quantity")
    check(row.seenAt == null, "seen_at null decodes as null")
    // Whole-second AND fractional timestamps in one payload. Postgres emits both.
    check(row.arrivedAt == Instant.parse("2026-08-04T07:30:00Z"), "whole-second timestamp")
    check(row.orderedAt == Instant.parse("2026-08-01T10:00:00Z"), "fractional timestamp")
    check(row.isUnseenArrival, "arrived + never seen = the banner")

    // A row the admin has not touched: everything nullable actually null.
    val fresh = JSONObject(
        """
        {"id": 8, "worker_id": 1, "location_id": null, "body": "Mopp", "status": "submitted",
         "admin_note": null, "inventory_item_id": null, "quantity": null, "cost_cents": null,
         "decided_by": null, "decided_at": null, "ordered_at": null, "arrived_at": null,
         "seen_at": null, "created_at": "2026-07-31T18:12:04.412Z"}
        """.trimIndent(),
    )
    val new = Wire.materialRequest(fresh)
    check(new.status == MaterialStatus.SUBMITTED, "a fresh request is submitted")
    check(new.quantity == null, "a null integer stays null, not 0 — 0 would read as 'none ordered'")
    check(new.locationName == null && new.itemName == null, "absent joined columns are null")
    check(!new.isUnseenArrival, "submitted is not an arrival")

    // A SIXTH STATUS. A phone in the field must degrade to "unknown", not throw and
    // blank the whole list.
    val future = Wire.materialRequest(JSONObject(fresh.toString()).put("status", "back_ordered"))
    check(future.status == null, "an unknown status maps to null, not a crash")
    check(future.statusRaw == "back_ordered", "the raw value is kept")
    check(!future.isUnseenArrival, "an unknown status never raises the arrival banner")

    // The lifecycle, copied from server/lib/materials.js MATERIAL_TRANSITIONS.
    check(MaterialStatus.entries.size == 5, "exactly five statuses exist server-side")
    check(
        MaterialStatus.SUBMITTED.isOpen && MaterialStatus.APPROVED.isOpen && MaterialStatus.ORDERED.isOpen,
        "submitted/approved/ordered are open",
    )
    check(!MaterialStatus.ARRIVED.isOpen && !MaterialStatus.REJECTED.isOpen, "arrived and rejected are terminal")

    // ---- what the worker typed ---------------------------------------------------
    check(MaterialQueue.normalise("  zwei Mopps \n") == "zwei Mopps", "trimmed")
    check(MaterialQueue.normalise("") == null, "empty is not a request")
    check(MaterialQueue.normalise("   \n\t ") == null, "whitespace-only is not a request")
    val atLimit = "a".repeat(MaterialQueue.BODY_MAX)
    check(MaterialQueue.normalise(atLimit) == atLimit, "exactly the server's cap is accepted")
    check(MaterialQueue.normalise(atLimit + "a") == null, "one over the cap is refused")
    check(MaterialQueue.BODY_MAX == 2000, "same cap as server/routes/app.js REQUEST_BODY_MAX")

    // ---- THE FOUR OUTCOMES -------------------------------------------------------
    // The one that would otherwise be catastrophic: 404 not_found is an UNROUTED PATH
    // (server.js answers {"error":"not_found"}), i.e. this build is ahead of the deploy.
    // ApiFailure classifies 404 as terminal, so without this arm every queued request
    // would be permanently blocked by a deploy that had not happened yet.
    check(!ApiFailure(404, "not_found").isRetryable, "404 is terminal by the general rule...")
    check(
        MaterialQueue.outcome(ApiFailure(404, "not_found")) == MaterialPushOutcome.FEATURE_UNAVAILABLE,
        "...which is why an unrouted path keeps the row queued and untouched",
    )
    check(MaterialQueue.outcome(ApiFailure.network()) == MaterialPushOutcome.STOP_PASS, "no network stops the pass")
    check(MaterialQueue.outcome(ApiFailure(503, "http_503")) == MaterialPushOutcome.RETRY_LATER, "5xx retries")
    check(
        MaterialQueue.outcome(ApiFailure(429, "too_many_attempts")) == MaterialPushOutcome.RETRY_LATER,
        "429 retries",
    )
    check(
        MaterialQueue.outcome(ApiFailure(400, "invalid_field")) == MaterialPushOutcome.BLOCKED,
        "a rejected payload is terminal - a human must act",
    )
    check(
        MaterialQueue.outcome(ApiFailure(422, "unknown_location")) == MaterialPushOutcome.BLOCKED,
        "a removed building is terminal",
    )
    check(
        MaterialQueue.outcome(ApiFailure(401, "no_session")) == MaterialPushOutcome.BLOCKED,
        "a dead session is terminal here; the 401 choke point drops the app to signed out",
    )

    // Every one of them has words behind it. A blank row is a row that looks sent.
    val deKeys = keysIn(File("app/src/main/res/values/strings.xml"))
    for (code in listOf("unknown_request", "not_found")) {
        check(ApiFailure(404, code).messageKey in deKeys, "'$code' has no German string")
    }

    // ---- and the words say "Anfrage", not "Schicht" -------------------------------
    // ApiFailure.messageKey is shared with the shift queue and two of its strings name a
    // shift out loud. Sending a worker to the admin about the wrong thing is a support
    // call, so the request queue re-words exactly those two and nothing else.
    check(
        MaterialQueue.messageKey(ApiFailure(400, "invalid_field")) == "err_rejected_request",
        "a rejected request is not reported as a rejected shift",
    )
    check(
        MaterialQueue.messageKey(ApiFailure(0, "wrong_account")) == "err_wrong_account_request",
        "a colleague's request is not reported as a colleague's shift",
    )
    for ((status, code) in listOf(
        0 to "network", 422 to "unknown_location", 401 to "no_session",
        503 to "http_503", 404 to "not_found",
    )) {
        val failure = ApiFailure(status, code)
        check(
            MaterialQueue.messageKey(failure) == failure.messageKey,
            "'$code' is already noun-neutral and must pass through untouched",
        )
    }
    for (key in listOf("err_rejected_request", "err_wrong_account_request")) {
        check(key in deKeys, "'$key' has no German string")
    }

    // ---- the queue plan. decision-22 from the client side. ------------------------
    val t0 = Instant.parse("2026-08-01T06:00:00Z")
    fun queuedMaterial(id: String, workerId: Int, body: String, at: Instant, blocked: Boolean = false) =
        QueuedMaterialRequest(id, workerId, body, null, at, if (blocked) "err_rejected" else null, blocked)

    val mine1 = queuedMaterial("a", 1, "erste", t0)
    val mine2 = queuedMaterial("b", 1, "zweite", t0.plusSeconds(60))
    val theirs = queuedMaterial("c", 2, "kollege", t0.plusSeconds(30))
    val dead = queuedMaterial("d", 1, "schon abgelehnt", t0.plusSeconds(10), blocked = true)

    val plan = MaterialQueue.plan(listOf(mine2, theirs, dead, mine1), sessionWorkerId = 1)
    check(plan.send.map { it.body } == listOf("erste", "zweite"), "oldest first, mine only: ${plan.send}")
    check(plan.wrongAccount == listOf("c"), "a colleague's row is never posted under my session")
    check(plan.send.none { it.blocked }, "a blocked row is not retried")

    val flipped = MaterialQueue.plan(listOf(mine2, theirs, dead, mine1), sessionWorkerId = 2)
    check(flipped.send.map { it.body } == listOf("kollege"), "only the session's own rows go out")
    check(flipped.wrongAccount.toSet() == setOf("a", "b"), "and mine are the blocked ones now")

    // ---- the list ----------------------------------------------------------------
    fun serverRow(id: Int, at: Instant) = Wire.materialRequest(
        JSONObject(fresh.toString()).put("id", id).put("body", "s$id").put("created_at", at.toString()),
    )
    val entries = MaterialQueue.entries(
        outbox = listOf(
            queuedMaterial("q1", 1, "q-neu", t0.plusSeconds(300)),
            queuedMaterial("q2", 1, "q-alt", t0.plusSeconds(100)),
        ),
        server = listOf(serverRow(2, t0.plusSeconds(200)), serverRow(1, t0)),
    )
    val bodies = entries.map {
        when (it) {
            is MaterialEntry.Queued -> it.row.body
            is MaterialEntry.Sent -> it.row.body
        }
    }
    check(
        bodies == listOf("q-neu", "s2", "q-alt", "s1"),
        "queued and sent interleave by when they were written: $bodies",
    )
    check(entries.map { it.key }.toSet().size == 4, "a local UUID and a server integer never collide")
    check(MaterialQueue.entries(emptyList(), emptyList()).isEmpty(), "an empty queue is an empty list")

    // ---- the seams that import Android, read as text -----------------------------
    // Two invariants that only matter on a device and that a regression would make
    // invisible: materials must never be awaited from the tap/refresh path, and the
    // material database must be a SEPARATE FILE from the one holding unpaid hours.
    val model = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetViewModel.kt").readText()
    val logRefresh = model.substringAfter("fun refresh()").substringBefore("\n    /**")
    check(
        !logRefresh.contains("material", ignoreCase = true),
        "the log refresh must never await anything material - clocking in is the product",
    )
    val tap = model.substringAfter("fun handleTap(").substringBefore("\n    /**")
    check(!tap.contains("material", ignoreCase = true), "the tap path must never touch materials")

    val materialStore = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/data/MaterialStore.kt").readText()
    val shiftStore = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/data/ShiftStore.kt").readText()
    check(materialStore.contains("\"materials.db\""), "materials live in their own database file")
    check(shiftStore.contains("\"timesheets.db\""), "...which is not the one holding unpaid hours")
    check(
        !materialStore.contains("\"timesheets.db\""),
        "a material feature must never bump the schema version of the shifts database",
    )
    // decision-22 at the point the row is written: the worker comes from the session,
    // never from the screen.
    check(
        model.contains("val worker = (_session.value as? SessionState.SignedIn)?.worker ?: return false"),
        "submitMaterial takes the worker from the session, not from an argument",
    )
    check(
        !Regex("""fun submitMaterial\([^)]*worker""").containsMatchIn(model),
        "and there is no worker parameter to pass a different one in",
    )
}

// ---------------------------------------------------------------------------------
// 13. THE IN-SHIFT STATE MACHINE, the lock, and the out-of-app signal.
//
// A shift opens -> locked screen + notification + ladder. It closes -> every one of
// them off. An auto-closed shift leaves NO stuck lock and NO orphaned notification.
//
// Mirrors NFCTimeSheets/checks/shift-signal-check.swift assertion for assertion. The
// two platforms are supposed to behave the same; if one of these files changes alone,
// that has stopped being true, and the constant-parity block at the end says so.
// ---------------------------------------------------------------------------------
private fun shiftSignal() {
    val start = Instant.parse("2024-11-14T22:13:20Z")   // fixed; nothing depends on "now"
    fun at(hours: Double) = start.plusMillis((hours * 3_600_000).toLong())

    val shift = RunningShift(locationId = UUID_A, locationName = "Westbahnhof", startTime = start)

    // ---- the state machine -------------------------------------------------------
    val opened = ShiftSignal.plan(shift, at(0.01))
    check(opened.lockScreen, "an open shift puts the app into the locked shift screen")
    check(opened.ongoingNotification, "an open shift posts the ongoing notification")
    check(opened.remindersScheduled, "an open shift schedules the reminder ladder")
    check(opened.phase == ShiftSignal.Phase.RUNNING, "and it is running")

    val closed = ShiftSignal.plan(null, at(3.0))
    check(closed == ShiftSignal.SignalPlan.IDLE, "no open shift means the idle plan and nothing else")
    check(!closed.lockScreen, "a closed shift unlocks the app")
    check(!closed.ongoingNotification, "a closed shift cancels the ongoing notification")
    check(!closed.remindersScheduled, "a closed shift cancels the ladder")
    check(closed.phase == null, "a closed shift has no phase")

    // The 8h boundary, computed LOCALLY. ops/sql/autoclose.sql closes at start+8h and the
    // client must reach the same conclusion with no server round trip, because a clock-in
    // works offline and a server-supplied deadline would be a second, unreliable source.
    check(ShiftSignal.AUTO_CLOSE_AFTER.toHours() == 8L, "the auto-close boundary is 8 hours (decision-10)")
    check(
        ShiftSignal.phase(start, at(7.99), false) == ShiftSignal.Phase.RUNNING,
        "7h59 is still running",
    )
    check(
        ShiftSignal.phase(start, at(8.0), false) == ShiftSignal.Phase.OVERDUE,
        "exactly 8h is overdue - the server's timer has fired by then",
    )
    check(
        ShiftSignal.phase(start, at(8.01), false) == ShiftSignal.Phase.OVERDUE,
        "8h01 is overdue",
    )
    check(ShiftSignal.autoCloseDeadline(start) == at(8.0), "the deadline is start + 8h")

    val overdue = ShiftSignal.plan(shift, at(9.0))
    check(overdue.phase == ShiftSignal.Phase.OVERDUE, "past 8h the phase flips")
    check(overdue.lockScreen, "...the screen stays - the worker still has to act")
    check(overdue.ongoingNotification, "...and so does the notification, with different words")
    check(!overdue.remindersScheduled, "...but nothing new is scheduled: every rung has fired")

    // THE AUTO-CLOSED SHIFT MUST NOT LEAVE A STUCK LOCK. Two halves, both needed.
    val serverClosed = shift.copy(serverAutoClosed = true)
    check(
        ShiftSignal.phase(serverClosed, at(0.5)) == ShiftSignal.Phase.OVERDUE,
        "a server-flagged auto-close is overdue after 30 minutes, not after 8 hours",
    )
    check(
        !ShiftSignal.plan(serverClosed, at(0.5)).remindersScheduled,
        "a shift the server has closed never schedules another reminder",
    )
    check(
        ShiftSignal.plan(null, at(9.0)) == ShiftSignal.SignalPlan.IDLE,
        "resolving an auto-closed shift leaves no lock and no notification",
    )

    // ---- the lock never traps anybody --------------------------------------------
    for (running in listOf(true, false)) {
        val tabs = ShiftSignal.visibleTabs(running)
        check(ShiftSignal.Tab.LOG in tabs, "the log tab exists whether or not a shift runs ($running)")
        check(
            ShiftSignal.Tab.MATERIALS in tabs,
            "material is reachable while a shift runs - that is exactly when it is needed ($running)",
        )
        check(
            ShiftSignal.Tab.SETTINGS in tabs,
            "settings, and therefore ABMELDEN, is reachable in every state (decision-26) ($running)",
        )
    }
    check(
        ShiftSignal.Tab.HISTORY !in ShiftSignal.visibleTabs(true),
        "Verlauf is the one thing the lock hides - nothing in it is time-critical",
    )
    check(
        ShiftSignal.visibleTabs(false) == ShiftSignal.Tab.entries.toList(),
        "with no shift running the app is exactly as it was",
    )

    // ---- the permission moment ---------------------------------------------------
    check(
        !ShiftSignal.shouldAskForNotifications(33, hasClockedIn = false, alreadyAsked = false),
        "NEVER ask before the first clock-in: that means asking at a door at 06:02 with gloves on",
    )
    check(
        !ShiftSignal.shouldAskForNotifications(32, hasClockedIn = true, alreadyAsked = false),
        "below API 33 there is no runtime permission to ask for",
    )
    check(
        ShiftSignal.shouldAskForNotifications(33, hasClockedIn = true, alreadyAsked = false),
        "ask once, afterwards, from the shift screen",
    )
    check(
        !ShiftSignal.shouldAskForNotifications(36, hasClockedIn = true, alreadyAsked = true),
        "and never again - a refusal is one sentence, not a nag",
    )

    // ---- the ladder --------------------------------------------------------------
    check(ShiftSignal.REMINDER_HOURS == listOf(1, 2, 3, 4, 5, 6, 7, 8), "eight rungs, one an hour")
    check(!ShiftSignal.isAutoCloseWarning(7), "the 7h rung is a nudge")
    check(ShiftSignal.isAutoCloseWarning(8), "the 8h rung is the auto-close itself")
    check(
        ShiftSignal.REMINDER_HOURS.all { it * 3600L <= ShiftSignal.AUTO_CLOSE_AFTER.seconds },
        "no rung fires after the server has closed the shift",
    )

    // ---- spoken duration: one label, not a per-second live region -----------------
    val spoken = ShiftSignal.elapsed(start, at(3.0).plusSeconds(14 * 60 + 30))
    check(spoken == 3 to 14, "3h14m30s is spoken as 3 hours 14 minutes: the seconds are not in it")
    check(
        spoken == ShiftSignal.elapsed(start, at(3.0).plusSeconds(14 * 60 + 59)),
        "the spoken label does not change within a minute, so TalkBack is not spammed",
    )
    check(
        ShiftSignal.elapsed(start, start.minusSeconds(60)) == 0 to 0,
        "a phone whose clock jumped backwards reads 0h 0m, never a negative duration",
    )

    // ---- THE TAP IS NEVER BLOCKED, read as text ----------------------------------
    // The ordering lives in the ViewModel, which imports Android. Deleting it would make
    // a failed signal able to cost somebody a clock-in, which is the one thing this
    // feature is not allowed to do.
    val model = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetViewModel.kt").readText()
    val tap = model.substringAfter("fun handleTap(").substringBefore("\n    /**")
    val write = tap.indexOf("writeTap(worker.id, locationId)")
    val arm = tap.indexOf("armSignals()")
    check(write >= 0, "handleTap still writes the local row")
    check(arm >= 0, "handleTap arms the signal")
    check(
        write < arm,
        "THE LOCAL ROW IS WRITTEN BEFORE ANY SIGNAL WORK. A tap in a basement counts even " +
            "if every signal fails; the reverse would lose paid time.",
    )
    check(
        !tap.contains("Manifest.permission") && !tap.contains("launch(Manifest"),
        "the notification prompt is NEVER on the tap path",
    )
    // The recovery half of the same wire: a reinstalled or rebooted phone must re-arm from
    // the shift the SERVER knows about, through the same function a fresh tap uses.
    val refresh = model.substringAfter("fun refresh() {").substringBefore("\n    /**")
    check(refresh.contains("adoptServerOpenShift"), "refresh still adopts the server's open shift")
    check(refresh.contains("armSignals()"), "...and re-arms from it")
    // Signing out must not leave somebody else's phone claiming a shift is running.
    check(
        model.substringAfter("fun signOut()").substringBefore("\n    private")
            .contains("ShiftSignals.arm(app, null)"),
        "signing out tears every signal down",
    )

    // ---- NO FOREGROUND SERVICE (audit R5) ----------------------------------------
    val manifestRaw = File("app/src/main/AndroidManifest.xml").readText()
    val manifestLive = manifestRaw.replace(Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL), "")
    check(
        !manifestLive.contains("FOREGROUND_SERVICE"),
        "NO foreground service: it buys ZERO extra visibility (FGS notifications are inside " +
            "the same POST_NOTIFICATIONS gate) and costs a Play declaration, a demo video and " +
            "review on a personal account (decision-27). This is a review-gate BLOCK.",
    )
    check(
        manifestRaw.contains("FOREGROUND_SERVICE"),
        "...but the reasoning must stay written down in the manifest where somebody would add one",
    )
    check(
        !manifestLive.contains("SCHEDULE_EXACT_ALARM") && !manifestLive.contains("USE_EXACT_ALARM"),
        "the ladder uses inexact alarms; exact ones are policed by Play and nothing here needs them",
    )
    check(
        manifestLive.contains("android.permission.POST_NOTIFICATIONS"),
        "the ongoing notification needs POST_NOTIFICATIONS on API 33+",
    )
    check(
        manifestLive.contains("android.permission.RECEIVE_BOOT_COMPLETED") &&
            manifestLive.contains("android.intent.action.BOOT_COMPLETED"),
        "a reboot clears every notification; the boot receiver is what brings it back",
    )
    check(
        !manifestLive.contains("LOCKED_BOOT_COMPLETED"),
        "LOCKED_BOOT_COMPLETED is only delivered to directBootAware components, which cannot " +
            "read timesheets.db - declaring it would describe a recovery that never happens",
    )
    val signals = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/notify/ShiftSignals.kt").readText()
    check(
        signals.contains("setUsesChronometer(true)"),
        "the SYSTEM ticks the elapsed time in the notification - no service, no wakelock, no battery",
    )
    check(signals.contains("setOngoing(true)"), "the notification is ongoing while the shift is")
    // Tearing down must take back the DELIVERED reminder too, not only the pending alarms.
    // A shift that closed at 07:40 leaving the 07:00 "noch eingestempelt" banner on the
    // lock screen is worse than no signal: it tells somebody who has finished that they
    // have not. iOS matches this with removeDeliveredNotifications.
    val teardown = signals.substringAfter("if (running == null || !plan.ongoingNotification)")
        .substringBefore("return")
    check(
        teardown.contains("cancel(ONGOING_ID)") && teardown.contains("cancel(REMINDER_ID)") &&
            teardown.contains("cancelLadder(app)"),
        "tearing down cancels the ongoing notification, the DELIVERED reminder and the alarms",
    )
    check(
        !signals.contains("startForeground"),
        "nothing here starts a foreground service",
    )

    // ---- CONSTANT PARITY WITH iOS ------------------------------------------------
    // Two files, one state machine. These are the numbers a worker's pay depends on, and
    // a platform that quietly disagrees about them is worse than one that has no signal.
    val swift = File("../NFCTimeSheets/NFCTimeSheets/ShiftSignal.swift").readText()
    check(
        swift.contains("autoCloseAfter: TimeInterval = 8 * 3600"),
        "iOS computes the same 8h boundary locally",
    )
    check(
        swift.contains("reminderHours: [Int] = [1, 2, 3, 4, 5, 6, 7, 8]"),
        "iOS climbs the same ladder",
    )
    check(
        swift.contains("shiftRunning ? [.log, .materials, .settings] : AppTab.allCases"),
        "iOS hides the same one tab and keeps the same two escapes",
    )
}

// ---------------------------------------------------------------------------------
// 14. SELF-UPDATE (this iteration): version comparison, DownloadManager status
//     classification, and the {published:false} wire shape. update/UpdateManager.kt
//     itself needs a real DownloadManager and so is UNPROVABLE off-device — the same
//     ceiling core-check already accepts for NFC dispatch — but every decision it makes
//     is pure Kotlin and lives in core/UpdateCheck.kt precisely so it can be proven here.
// ---------------------------------------------------------------------------------
private fun updateCheck() {
    val release = RemoteRelease(
        versionCode = 6,
        versionName = "0.5.0",
        sha256 = null,
        notes = null,
        url = "/app/download",
    )

    check(UpdateCheck.isNewer(release, currentVersionCode = 5), "a strictly higher version_code is newer")
    // THE RED CASE, shown RED before it was fixed: `>=` in place of `>` would call the
    // phone's OWN running build "an update", offering it to install itself for ever.
    // Verified by writing isNewer as `remote.versionCode >= currentVersionCode` first:
    // this assertion FAILED (returned true for equal version codes). `>` fixes it.
    check(
        !UpdateCheck.isNewer(release.copy(versionCode = 5), currentVersionCode = 5),
        "the SAME version_code is never \"newer\"",
    )
    check(
        !UpdateCheck.isNewer(release.copy(versionCode = 4), currentVersionCode = 5),
        "an OLDER version_code is never \"newer\" either",
    )

    // ---- android.app.DownloadManager status/reason classification -----------------
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_SUCCESSFUL, 0) == UpdateCheck.DownloadOutcome.SUCCESS,
        "a successful status classifies as SUCCESS",
    )
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_RUNNING, 0) == UpdateCheck.DownloadOutcome.RUNNING,
        "a running status classifies as RUNNING",
    )
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_PENDING, 0) == UpdateCheck.DownloadOutcome.RUNNING,
        "a pending status classifies as RUNNING too — not yet started is not a failure",
    )
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_PAUSED, UpdateCheck.DM_PAUSED_WAITING_FOR_NETWORK) ==
            UpdateCheck.DownloadOutcome.WAITING_FOR_NETWORK,
        "paused-for-network classifies as WAITING_FOR_NETWORK, not FAILED",
    )
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_PAUSED, UpdateCheck.DM_PAUSED_QUEUED_FOR_WIFI) ==
            UpdateCheck.DownloadOutcome.WAITING_FOR_NETWORK,
        "queued-for-wifi classifies as WAITING_FOR_NETWORK too",
    )
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_PAUSED, UpdateCheck.DM_PAUSED_UNKNOWN) ==
            UpdateCheck.DownloadOutcome.RUNNING,
        "an unrecognised pause reason reads as still RUNNING, never a silent failure",
    )
    // THE RED CASE, shown RED before it was fixed: a `when (status)` with no inner
    // `when (reason)` branch classifies EVERY failure the same way, including a full
    // disk — the worker would be told "try again" and retry into the same wall forever,
    // when the real instruction is "delete something first". Verified by writing
    // classify() with the STORAGE_FULL arm removed: this assertion failed (returned
    // FAILED, not STORAGE_FULL). The reason-code branch fixes it.
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_FAILED, UpdateCheck.DM_ERROR_INSUFFICIENT_SPACE) ==
            UpdateCheck.DownloadOutcome.STORAGE_FULL,
        "insufficient-space failure classifies as STORAGE_FULL, not a generic FAILED",
    )
    check(
        UpdateCheck.classify(UpdateCheck.DM_STATUS_FAILED, 1008 /* ERROR_CANNOT_RESUME */) ==
            UpdateCheck.DownloadOutcome.FAILED,
        "any OTHER failure reason still classifies as the generic FAILED",
    )
    check(
        UpdateCheck.classify(status = 99, reason = 0) == UpdateCheck.DownloadOutcome.FAILED,
        "an unrecognised status is read as FAILED, never silently ignored",
    )

    // ---- Wire.release(): the GET /app/version envelope ----------------------------
    val notPublished = JSONObject("""{"published":false}""")
    check(Wire.release(notPublished) == null, "an unpublished manifest decodes to null, never a throw")

    val published = JSONObject(
        """{"published":true,"version_code":9,"version_name":"9.9.9",
            "sha256":"deadbeef","notes":"x","url":"/app/download"}""",
    )
    val decoded = Wire.release(published)
    check(decoded != null, "a published manifest decodes")
    check(decoded?.versionCode == 9 && decoded.versionName == "9.9.9", "version_code and version_name ride along")
    check(decoded?.sha256 == "deadbeef" && decoded?.url == "/app/download", "sha256 and url ride along too")

    // A manifest missing the optional fields must still decode — sha256/version_name/
    // notes are all optional server-side (routes/release.js).
    val minimal = JSONObject("""{"published":true,"version_code":9,"url":"/app/download"}""")
    val decodedMinimal = Wire.release(minimal)
    check(
        decodedMinimal != null && decodedMinimal.versionName == null && decodedMinimal.sha256 == null,
        "a minimal published manifest still decodes, with the optional fields null",
    )
}
