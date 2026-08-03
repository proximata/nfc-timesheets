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
import io.github.qwadratic.nfctimesheets.core.OpenShiftRequest
import io.github.qwadratic.nfctimesheets.core.ResolveShiftRequest
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

fun main() {
    tagLink()
    retryClassification()
    wireBytes()
    wireDecoding()
    tapOrdering()
    syncPlan()
    stringResources()
    manifestAndWiring()

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
    check(!ApiFailure(403, "not_eligible").isRetryable, "403 not_eligible terminal")

    // The whole rejection path for a tag the server does not know: 422 -> terminal ->
    // the row is blocked and shown in red with an admin-facing message. There is no
    // client-side roster guard that could pre-empt this with a worse answer, and there
    // must never be one — that guard cost the iOS owner paid time at a door.
    val unknown = ApiFailure(422, "unknown_location")
    check(!unknown.isRetryable, "422 unknown_location terminal")
    check(SyncPlan.blocksRow(unknown), "422 unknown_location blocks the row")
    check(!SyncPlan.blocksRow(ApiFailure.network()), "a network failure never blocks a row")

    // The relay address the ineligible screen reads out has to survive the error path.
    check(
        ApiFailure(403, "not_eligible", email = "x@privaterelay.appleid.com").email
            == "x@privaterelay.appleid.com",
        "not_eligible carries the email the provider gave",
    )
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
        "no_session", "invalid_token", "not_eligible", "too_many_attempts",
        "sign_in_unconfigured", "missing_location", "wrong_account",
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
