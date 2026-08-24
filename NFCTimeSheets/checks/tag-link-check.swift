// Runnable check: tag-link parsing, retry classification, and the exact JSON bytes this
// app puts on the wire. No test framework, no Xcode.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/Branding.swift NFCTimeSheets/TagLink.swift NFCTimeSheets/API.swift \
//       checks/tag-link-check.swift \
//     > /tmp/tag-link-check.swift && swift /tmp/tag-link-check.swift
//
// (concatenated because the swift interpreter only runs one file; Branding.swift,
// TagLink.swift and API.swift are pure Foundation precisely so this stays possible.)

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

// --- inert by default ---------------------------------------------------------------
// THE WHITE-LABEL CONTRACT. Operator identity moved out of source and into configuration
// (Branding.xcconfig -> Info.plist -> Branding). With NOTHING configured - which is how the
// app ships and how this check runs, outside any app bundle - every value must be the one
// the current TestFlight build uses. If these four lines fail, the config surface has
// changed live behaviour, which is the one thing it is not allowed to do.
check(Branding.infoString("TSTagHost") == nil, "no Info.plist value is present in this harness")
check(TagLink.host == "schimmer-glanz.exe.xyz", "unconfigured tag host: \(TagLink.host)")
check(API.base.absoluteString == "https://schimmer-glanz.exe.xyz", "unconfigured API base: \(API.base)")
check(API.bundleId == "io.github.qwadratic.NFCTimeSheets", "unconfigured bundle id: \(API.bundleId)")
// An UNDEFINED Xcode build setting expands to the EMPTY STRING, not to nothing, so "" is the
// exact byte sequence a build with Branding.xcconfig detached hands Branding. It must read as
// unconfigured, or the app points at `https://` and every single request dies.
check(Branding.normalize(nil) == nil, "missing key is unconfigured")
check(Branding.normalize("") == nil, "EMPTY key is unconfigured - undefined build setting")
check(Branding.normalize("   ") == nil, "whitespace-only key is unconfigured")
check(Branding.normalize("$(TS_TAG_HOST)") == nil, "unsubstituted $(VAR) is unconfigured")
check(Branding.normalize(" cleanco.example ") == "cleanco.example", "a real value is trimmed and used")

let good = "https://schimmer-glanz.exe.xyz/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301"

// Accepted shapes.
check(TagLink.locationId(from: URL(string: good)!) == "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "canonical link")
check(TagLink.locationId(from: URL(string: "https://schimmer-glanz.exe.xyz/t/?l=3F2504E0-4F89-11D3-9A0C-0305E82C3301")!)
        == "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "trailing slash + uppercase uuid -> lowercased")
// The host is INTERPOLATED from TagLink.host, uppercased — not typed out. This line used
// to carry a literal `TIMESHEETS.EXE.XYZ`, which stopped being this app's host the day the
// VM was renamed, so the check went red for a reason that had nothing to do with case
// folding. A check whose failure means "the host moved" is not a check about case.
check(TagLink.locationId(from: URL(string: "https://\(TagLink.host.uppercased())/t?x=1&l=3f2504e0-4f89-11d3-9a0c-0305e82c3301")!)
        != nil, "host case-insensitive, extra query params ignored")

// A PERCENT-ENCODED SPACE IS ACCEPTED, ON BOTH PLATFORMS, AND THAT IS PINNED RATHER THAN
// TIDIED. %20 is unescaped to a real space by both decoders and then trimmed off by the
// uuid normaliser, so such a tag scans here and on Android. It is not a shape this app ever
// WRITES — the Android writer refuses the id outright — so the only way to meet one is a
// card someone else made. What matters is that the two platforms agree about it; a change
// to either decoder that made one of them start refusing it turns this line red.
check(TagLink.locationId(from: URL(string: "https://schimmer-glanz.exe.xyz/t?l=%203f2504e0-4f89-11d3-9a0c-0305e82c3301")!)
        == "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "a %20-prefixed uuid is accepted, as on Android")

// Rejected shapes. Everything here would otherwise reach the server off an unlocked tag.
let bad = [
    "https://schimmer-glanz.exe.xyz/t?l=westbahnhof",              // a SLUG, not a uuid (decision-21)
    "https://schimmer-glanz.exe.xyz/t?l=",                         // empty
    "https://schimmer-glanz.exe.xyz/t",                            // no l at all
    "https://schimmer-glanz.exe.xyz/t?l=3f2504e04f8911d39a0c0305e82c3301", // unhyphenated
    "https://schimmer-glanz.exe.xyz/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301'--", // sql-ish
    "https://evil.example.com/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301",      // wrong host
    "http://schimmer-glanz.exe.xyz/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301",     // not https
    "https://schimmer-glanz.exe.xyz/admin?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301", // wrong path
    "https://schimmer-glanz.exe.xyz/tag?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301",   // path PREFIX is not the path
    // URI userinfo trick: the string STARTS with our host but the authority is not ours.
    "https://schimmer-glanz.exe.xyz@evil.example.com/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    // java.util.UUID.fromString ACCEPTS this; Foundation's UUID(uuidString:) does not, and
    // the server's regex does not. Pinned on BOTH sides so the platforms cannot drift into
    // Android queueing rows the server answers 400 to while iOS refuses the same tag.
    "https://schimmer-glanz.exe.xyz/t?l=1-1-1-1-1",
    // THE '+' TRAP, and the reason it is HERE and not only in the Kotlin corpus.
    // Android decodes the query with java.net.URLDecoder, which implements
    // application/x-www-form-urlencoded, where `+` MEANS space — so "?l=+<uuid>" would
    // decode to " <uuid>", trim clean, and be ACCEPTED on Android. Swift's URLComponents
    // leaves `+` alone, so iOS rejects it. That asymmetry is a tag one phone in a stairwell
    // clocks in from and the phone in the next stairwell refuses. TagLink.kt escapes `+` to
    // %2B before decoding to close it, and core-check.kt pins the Kotlin half with a comment
    // that says "verified against Swift" — a claim nothing on this side had ever RUN. It runs
    // now: these two lines are the other half of that sentence.
    "https://schimmer-glanz.exe.xyz/t?l=+3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "https://schimmer-glanz.exe.xyz/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301+",
]
for s in bad {
    check(TagLink.locationId(from: URL(string: s)!) == nil, "must reject \(s)")
}

// --- retry classification ---------------------------------------------------------
// Retrying a 400 for ever is pointless; giving up on a 503 loses the shift.
check(APIFailure(status: 0, code: "network").isRetryable, "transport failure retryable")
check(APIFailure(status: 503, code: "http_503").isRetryable, "5xx retryable")
check(APIFailure(status: 429, code: "too_many_attempts").isRetryable, "429 retryable")
check(APIFailure(status: 409, code: "shift_already_open").isRetryable, "409 already-open retryable")
check(!APIFailure(status: 400, code: "invalid_uuid").isRetryable, "400 terminal")
check(!APIFailure(status: 422, code: "unknown_worker").isRetryable, "422 terminal")
// 422 zone_unverified (server/lib/validate.js requireVerifiedPlace, decision-47) is the
// ONE 422 that IS retryable: an operator's later test scan makes the identical request
// succeed, so a locally-recorded worked shift must not be stranded by it.
check(APIFailure(status: 422, code: "zone_unverified").isRetryable,
      "422 zone_unverified retryable - a temporary server-config state, not a bad payload")

// ContentView.handleTap no longer checks the LOCAL roster cache before recording a tap -
// that guard refused valid tags on a cold launch, before any roster fetch had finished,
// and cost the worker paid time at the door. The SERVER is authoritative for whether a
// location exists, so THIS is now the whole rejection path for a genuinely unknown tag:
// 422 unknown_location -> not retryable -> Sync.record sets syncBlocked -> ShiftRow draws
// it in red with the admin-facing message. If any link in that chain is edited, the app
// silently swallows bad tags instead of showing them. Pinned here.
let unknownLocation = APIFailure(status: 422, code: "unknown_location")
check(!unknownLocation.isRetryable, "422 unknown_location is terminal, so sync stops and blocks")
check(unknownLocation.workerMessage == "This location was removed. Ask your admin.",
      "422 unknown_location tells the worker to involve the admin: \(unknownLocation.workerMessage)")
check(!APIFailure(status: 404, code: "unknown_shift").isRetryable, "404 terminal")
// INVERTED (ops/break-taps.sh §8): a worker session that lapses mid-shift 401s the
// clock-out, and the bytes were always fine - a 401 is a statement about the CREDENTIAL,
// not the payload. The old assertion here ("401 terminal") pinned the payroll data-loss
// bug as if it were the design; retrying picks the row up the moment the cookie is back.
check(APIFailure(status: 401, code: "unauthorized").isRetryable, "401 retryable, except invalid_code")
// invalid_code IS THE ONE 401 THAT STAYS TERMINAL: a sign-in code is single-use and
// rate-limited, so auto-retrying a rejected one would burn the worker's remaining
// attempts and lock the phone out for fifteen minutes at the exact moment they are
// trying to get in.
check(!APIFailure(status: 401, code: "invalid_code").isRetryable, "401 invalid_code terminal")
check(!APIFailure(status: 403, code: "not_eligible").isRetryable, "403 not_eligible terminal")

// --- the wire bytes ---------------------------------------------------------------
// Diff these against server/routes/app.js by eye. The previous build sent
// {id, worker, tagUID, start, end, manualFinish} and got 400 on every single POST.
func json<T: Encodable>(_ value: T) -> String {
    let e = Wire.encoder
    e.outputFormatting = [.sortedKeys]
    return String(data: try! e.encode(value), encoding: .utf8)!
}

let start = Date(timeIntervalSince1970: 1_784_000_591.412)
let key = "6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d"

// NO worker_id, and this check exists to keep it that way (decision-22): who is clocking
// in is decided by the session cookie on the server. If someone "helpfully" adds the
// field back to make a server error go away, this line fails first.
let openBody = json(OpenShiftRequest(clientUuid: key,
                                     locationUuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
                                     startTime: start))
check(openBody
        == #"{"client_uuid":"6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d","location_uuid":"3f2504e0-4f89-11d3-9a0c-0305e82c3301","start_time":"2026-07-14T03:43:11.412Z"}"#,
      "POST /shifts/open body: \(openBody)")
check(!openBody.contains("worker"), "no worker identity may ride in a shift body")

check(json(CloseShiftRequest(clientUuid: key, endTime: start, autoClosed: false))
        == #"{"auto_closed":false,"client_uuid":"6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d","end_time":"2026-07-14T03:43:11.412Z"}"#,
      "POST /shifts/close body")

// POST /auth/apple, AppleSignInRequest and AppleNonce are gone from this file with
// decision-50 - Sign in with Apple is retired from this app. server/routes/auth.js keeps
// the route (deprecated in words, not deleted), but nothing on iOS encodes its body any
// more, so there is nothing left here to pin.
check(json(CodeRequest(code: "K7QF3MZ2")) == #"{"code":"K7QF3MZ2"}"#,
      "POST /auth/code body")
check(json(PhoneRequest(phone: "+436641234567")) == #"{"phone":"+436641234567"}"#,
      "POST /auth/sms/request body")
check(json(SmsVerifyRequest(phone: "+436641234567", code: "123456"))
        == #"{"code":"123456","phone":"+436641234567"}"#,
      "POST /auth/sms/verify body")

check(json(ResolveShiftRequest(endTime: start)) == #"{"end_time":"2026-07-14T03:43:11.412Z"}"#,
      "POST /shifts/:id/resolve body")

// --- decoding what the server sends -------------------------------------------------
let wire = #"""
{"id":41,"worker_id":7,"location_id":"3f2504e0-4f89-11d3-9a0c-0305e82c3301",
 "start_time":"2026-07-14T03:43:11.412Z","end_time":"2026-07-14T11:43:11.000Z",
 "auto_closed":true,"corrected_at":null,"client_uuid":"6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d",
 "location_slug":"westbahnhof","location_name":"Westbahnhof"}
"""#
let decoded = try! Wire.decoder.decode(WireShift.self, from: Data(wire.utf8))
check(decoded.id == 41 && decoded.workerId == 7, "shift ids decode")
check(decoded.startTime == start, "fractional-second timestamp decodes")
check(decoded.needsResolution, "auto_closed + corrected_at nil => needs resolution")
check(decoded.locationSlug == "westbahnhof", "slug rides along for display only")

// Whole-second timestamps (Postgres drops .000) must decode too.
let plain = #"{"id":1,"worker_id":1,"location_id":"3f2504e0-4f89-11d3-9a0c-0305e82c3301","start_time":"2026-07-14T03:43:11Z","end_time":null,"auto_closed":false,"corrected_at":null,"client_uuid":null}"#
let open2 = try! Wire.decoder.decode(WireShift.self, from: Data(plain.utf8))
check(open2.endTime == nil && !open2.needsResolution, "open shift decodes")

print("tag-link-check: OK")
