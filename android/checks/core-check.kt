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
import io.github.qwadratic.nfctimesheets.core.OpenShiftRequest
import io.github.qwadratic.nfctimesheets.core.ResolveShiftRequest
import io.github.qwadratic.nfctimesheets.core.SessionCookie
import io.github.qwadratic.nfctimesheets.core.SyncPlan
import io.github.qwadratic.nfctimesheets.core.SyncPlan.QueuedShift
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.TapInbox
import io.github.qwadratic.nfctimesheets.core.Wire
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
private val host = branding.getProperty("ts.tagHost").trim()
private val tags = TagLink(host)

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
    enrolmentCode()
    enrolmentAgainstServer()
    sessionPersistence()

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

    // WHITE LABEL: the operator's host is typed in exactly one place. A second copy in
    // source is how an App Link silently stops matching the tags already on the walls.
    val sources = File("app/src").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "xml") }
    for (file in sources) {
        check(!file.readText().contains(host), "$host is hardcoded in ${file.path} — it belongs in branding.properties")
    }
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
