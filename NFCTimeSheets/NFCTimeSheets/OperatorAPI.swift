//
//  OperatorAPI.swift
//  NFCTimeSheets
//
//  The operator sign-in wire contract (decision-45). An operator NEVER clocks in — no
//  route reachable with a ts_operator session touches a shift, full stop (see the header
//  of server/routes/operator.js) — so this file stays deliberately thin: sign in, sign
//  out, nothing else. Reading and writing tags is a separate, later piece of work; it
//  will add its own calls here without touching what is below.
//
//  A SEPARATE CHOKE POINT FROM API.swift's `send`, ON PURPOSE. That one posts
//  `.sessionRejected` on every single 401, and Auth.swift's Session drops the WORKER to
//  signed-out the instant it hears that notification — the observer has no way to tell
//  an expired ts_worker cookie apart from an expired ts_operator one. An operator code
//  going stale must never sign the worker out and must never so much as graze the
//  clock-in path, so operator calls run their own copy of the same response
//  classification instead of sharing the worker's.
//
//  PERSISTENCE IS STILL EXACTLY THE WORKER'S MECHANISM, AND NOTHING NEW. These calls go
//  out over `URLSession.shared` — the same instance API.swift's `send` uses — so the
//  `Set-Cookie: ts_operator=…` response header is stored by the very same
//  `HTTPCookieStorage.shared` jar that already keeps `ts_worker` alive across launches,
//  automatically, with no cookie-parsing code written here by hand. See
//  OperatorSession.swift for the one place this file's callers live.
//

import Foundation

struct WireOperator: Decodable, Identifiable, Hashable {
    let id: Int
    let name: String
}

private struct OperatorCodeRequest: Encodable {
    let code: String
}

private struct OperatorPhoneRequest: Encodable { let phone: String }
private struct OperatorSmsVerifyRequest: Encodable { let phone: String; let code: String }

private struct WireEmptyBody: Encodable {}

/// 200 from POST /auth/operator-code. The session cookie rides in the headers, exactly
/// like WireSession's worker equivalent.
struct WireOperatorSession: Decodable {
    let `operator`: WireOperator
    let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case `operator`
        case expiresAt = "expires_at"
    }
}

private struct WireOperatorError: Decodable {
    let error: String
}

/// The OPERATOR's session died server-side (expired, revoked, code withdrawn). A SECOND
/// notification, never `.sessionRejected`: that one is the worker's and Auth.swift's
/// Session observes it, so posting it here would sign a cleaner out of a running shift
/// because a tag write 401'd. Android's operatorApi passes a no-op onSessionRejected for
/// exactly this reason (TimeSheetsApplication.kt). Observed only by OperatorSession.
extension Notification.Name {
    static let operatorSessionRejected =
        Notification.Name("io.github.qwadratic.NFCTimeSheets.operatorSessionRejected")
}

/// Mirrors API.swift's private `send`, minus the `.sessionRejected` post. See the header
/// above for why that difference is load-bearing and not an oversight.
private func sendOperator(_ request: URLRequest) async throws -> Data {
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await URLSession.shared.data(for: request)
    } catch {
        throw APIFailure(status: 0, code: "network")
    }

    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
        // The gate reads the cookie, but a cookie that is still on disk can already be
        // dead server-side. This is the only moment the app can learn that (there is no
        // GET /auth/operator-session), so it tells OperatorSession directly (TASK-276).
        // Sign-in itself 401s on a wrong code and is NOT a dying session - but the state
        // it would drop to is the one that door is already showing, so no exception is
        // carved out for it.
        if status == 401 {
            NotificationCenter.default.post(name: .operatorSessionRejected, object: nil)
        }
        let parsed = try? Wire.decoder.decode(WireOperatorError.self, from: data)
        throw APIFailure(status: status, code: parsed?.error ?? "http_\(status)", body: data)
    }
    return data
}

private func operatorPost<In: Encodable, Out: Decodable>(_ path: String, _ body: In) async throws -> Out {
    var request = URLRequest(url: API.base.appending(path: path))
    request.httpMethod = "POST"
    request.setValue(API.appKey, forHTTPHeaderField: "X-App-Key")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try Wire.encoder.encode(body)
    return try Wire.decoder.decode(Out.self, from: try await sendOperator(request))
}

private func operatorGet<Out: Decodable>(_ path: String) async throws -> Out {
    var request = URLRequest(url: API.base.appending(path: path))
    request.setValue(API.appKey, forHTTPHeaderField: "X-App-Key")
    return try Wire.decoder.decode(Out.self, from: try await sendOperator(request))
}

enum OperatorAuthAPI {
    /// POST /auth/operator-code {code} -> operator session cookie (ts_operator).
    /// Mirrors POST /auth/code byte for byte (decision-45 §6):
    ///   200 {operator: {id, name}, expires_at}
    ///   401 invalid_code — EVERY failure mode, unknown / expired / used / revoked
    ///   429 too_many_attempts
    static func signIn(code: String) async throws -> WireOperatorSession {
        try await operatorPost("/auth/operator-code", OperatorCodeRequest(code: code))
    }

    /// POST /auth/operator-sms/request {phone} -> 202 {status:"accepted"} (decision-54 §5).
    /// Mirrors POST /auth/sms/request byte for byte, on the same phone-keyed
    /// `otp_challenges` table - what differs is the rate-limit bucket (`smsotpop:`, not
    /// `smsotp:`), for the same reason `enrolop:` is not `enrol:`: a stranger guessing one
    /// role's codes must not lock the other role out of enrolling from the same address.
    ///   404 unknown_phone (decision-51) · 422 invalid_phone · 429 too_many_attempts ·
    ///   503 sms_not_configured.
    /// Mints no session. The copy for each failure lives beside the field it is shown next
    /// to (CodeSignInSection.swift), not here.
    static func requestSmsCode(phone: String) async throws -> WireSmsRequestAck {
        try await operatorPost("/auth/operator-sms/request", OperatorPhoneRequest(phone: phone))
    }

    /// POST /auth/operator-sms/verify {phone, code} -> operator session cookie (ts_operator).
    /// BYTE-IDENTICAL 200 body to POST /auth/operator-code's, exactly as the worker pair is.
    ///   401 invalid_code (every failure mode) · 429 too_many_attempts · 503 sms_not_configured.
    static func verifySmsCode(phone: String, code: String) async throws -> WireOperatorSession {
        try await operatorPost("/auth/operator-sms/verify",
                               OperatorSmsVerifyRequest(phone: phone, code: code))
    }

    /// POST /auth/operator-logout — revokes the session server-side. Best-effort from the
    /// caller's side: OperatorSession.signOut() drops the local cookie regardless of
    /// whether this call ever lands.
    static func logout() async throws {
        let _: WireEmpty = try await operatorPost("/auth/operator-logout", WireEmptyBody())
    }
}

// MARK: - Tag writing and the test scan (decision-49, decision-47)
//
// Reading and writing tags itself lives in NdefTag.swift / WriteGuard.swift / TagWriter.swift
// / TagReaderProbe.swift, all Foundation- or CoreNFC-only. This is the wire contract those
// files call into, mirroring server/routes/operator.js byte for byte — the same contract
// Android already proved live, and unchanged by this iOS work (confirmed by reading that
// file in full this session, not assumed).

private struct ReportTagRequest: Encodable { let id: String }

/// A row in `reported_tags`. `resolvedAt` stays nil until an admin claims it in the web
/// panel (routes/admin.js `POST /admin/tags/:id/resolve-*`) — this phone never sees that
/// happen and does not need to.
struct WireReportedTag: Decodable {
    let id: String
    let reportedAt: Date
    let resolvedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case reportedAt = "reported_at"
        case resolvedAt = "resolved_at"
    }
}

private struct WireReportedTagEnvelope: Decodable { let tag: WireReportedTag }

/// One row of GET /operator/zones — a door that still needs a test scan, or one that
/// already had one. `tagSerial` travels OUTWARDS only (decision-44): the phone matches a
/// scanned hardware UID against it client-side (see TagReaderProbe.swift /
/// Zones.normaliseSerial) and posts back the resolved PLACE id, never the serial itself.
///
/// `locationId`/`locationName` are OPTIONAL since decision-54 §1: the worklist LEFT JOINs
/// `locations` now, so a card written at a door before anybody decided which object it
/// belongs to comes back with both null. That zone is exactly the one with work left on it
/// — it is the only screen from which it can ever be bound — and it is NOT scannable until
/// it is, because `activePlace` cannot resolve an unbound zone at all.
struct WireOperatorZone: Codable, Identifiable, Hashable {
    let id: String
    let locationId: String?
    let locationName: String?
    let name: String
    let tagSerial: String?
    let tagDeployedAt: Date?
    let verifiedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case locationName = "location_name"
        case name
        case tagSerial = "tag_serial"
        case tagDeployedAt = "tag_deployed_at"
        case verifiedAt = "verified_at"
    }

    var isVerified: Bool { verifiedAt != nil }
    var isBound: Bool { locationId != nil }
}

private struct BindZoneRequest: Encodable {
    let locationId: String
    enum CodingKeys: String, CodingKey { case locationId = "location_id" }
}

/// One row of GET /operator/zones/:id/shifts. WHAT IS ABSENT IS THE POINT (decision-54 §7):
/// no rate, no euro figure, no client name — a zone is not a costing unit and an operator is
/// not on the payroll screen. `endTime` is nil for a shift still running, and
/// `durationMinutes` is then the time SO FAR, computed in SQL off the same
/// COALESCE(end_time, now()) — this phone never does date arithmetic on two timestamps and a
/// timezone.
struct WireZoneShift: Decodable, Identifiable, Hashable {
    let workerId: Int
    let workerName: String
    let startTime: Date
    let endTime: Date?
    let durationMinutes: Double

    /// Composite, because the route returns no shift id: a worker can tap the same door
    /// twice in a month, but never twice in the same second.
    var id: String { "\(workerId)-\(startTime.timeIntervalSince1970)" }

    enum CodingKeys: String, CodingKey {
        case workerId = "worker_id"
        case workerName = "worker_name"
        case startTime = "start_time"
        case endTime = "end_time"
        case durationMinutes = "duration_minutes"
    }
}

/// One page of GET /operator/zones/:id/shifts. `totalMinutes` is the WHOLE month's, from a
/// second unpaginated query on the server — summing this page's 50 rows on the phone and
/// labelling it "the month" is precisely the lie the server took a second query to avoid.
struct WireZoneShiftsPage: Decodable {
    let shifts: [WireZoneShift]
    let page: Int
    let pageSize: Int
    let matching: Int
    let totalMinutes: Double

    enum CodingKeys: String, CodingKey {
        case shifts, page, matching
        case pageSize = "page_size"
        case totalMinutes = "total_minutes"
    }

    var hasNextPage: Bool { page * pageSize < matching }
}

private struct WireOperatorZonesEnvelope: Decodable { let zones: [WireOperatorZone] }

private struct VerifyZoneRequest: Encodable {
    let placeUuid: String
    enum CodingKeys: String, CodingKey { case placeUuid = "place_uuid" }
}

/// 200 from POST /operator/zones/:id/verify. `verifiedAt` is a historical fact the route
/// never clears — `alreadyVerified` is what tells the screen whether THIS scan was the one
/// that stamped it, or a harmless re-scan of a door already proved.
struct WireZoneVerifyResult: Decodable {
    let id: String
    let name: String
    let locationId: String
    let locationName: String
    let verifiedAt: Date
    let alreadyVerified: Bool

    enum CodingKeys: String, CodingKey {
        case id, name
        case locationId = "location_id"
        case locationName = "location_name"
        case verifiedAt = "verified_at"
        case alreadyVerified = "already_verified"
    }
}

private struct WireZoneVerifyEnvelope: Decodable { let zone: WireZoneVerifyResult }

/// One row of GET /operator/locations. TWO COLUMNS AND THAT IS THE WHOLE ROW, matching the
/// route: picking a building needs a name to tap and an id to post, and nothing about it
/// needs a rate, a client, an address or a coordinate (decision-54 §2).
struct WireOperatorLocation: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

private struct WireOperatorLocationsEnvelope: Decodable { let locations: [WireOperatorLocation] }

/// The zone POST /operator/tags/:id/resolve-zone hands back. NOT WireOperatorZone: that one
/// is the worklist shape and carries `location_name`, which this route does not return (it
/// selects OP_ZONE_COLS off `zones` alone). Decoding it as a zone row would fail on a field
/// the server never sends.
struct WireCreatedZone: Decodable {
    let id: String
    let locationId: String?
    let name: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case locationId = "location_id"
    }
}

private struct WireCreatedZoneEnvelope: Decodable { let zone: WireCreatedZone }

/// 200 from GET /operator/tags/:id (decision-55 §1) - "what IS this card", asked of an id
/// nobody selected first. FIVE kinds and NO 404: "I don't know this card" is an ANSWER here,
/// which is why `kind` is a plain String rather than an enum that would have to decide what
/// to do with a sixth one the server grows later. The screen switches on it and falls back
/// to the unknown sentence.
///
/// `zone` is present ONLY for kind "zone", and it is the SAME body shape
/// GET /operator/zones/:id returns - bound or unbound - so it feeds straight into the
/// EXISTING zone branch instead of a second screen. It carries no `tag_serial` /
/// `tag_deployed_at`; both are Optional on WireOperatorZone, so a missing key decodes to nil.
struct WireTagClassification: Decodable {
    let kind: String
    let zone: WireOperatorZone?
}

private struct ReassignBuildingRequest: Encodable {
    let newTagId: String
    let locationId: String

    enum CodingKeys: String, CodingKey {
        case newTagId = "new_tag_id"
        case locationId = "location_id"
    }
}

/// 201 from POST /operator/zones/:id/reassign-building. TWO ids, and BOTH matter: `zone` is
/// the BRAND NEW zone on the rewritten card (fresh, `verified_at` null, zero shifts) and
/// `retiredZoneId` is the old one, now `active = false`. The old zone is not moved, not
/// renamed and not deleted - its shifts stay queryable under its own id for ever
/// (decision-55 §3) - but it must never be shown as live again, which is what this field is
/// for.
///
/// The zone body is the route's OP_ZONE_COLS, which has no `location_name` - the caller
/// already holds the building it just picked, exactly as bindZone's caller does.
struct WireReassignedZone: Decodable {
    let zone: WireOperatorZone
    let retiredZoneId: String

    enum CodingKeys: String, CodingKey {
        case zone
        case retiredZoneId = "retired_zone_id"
    }
}

/// `{}`. For the routes whose whole request is the path (currently only unbind): the server
/// still parses a JSON body, so sending nothing at all is not the same thing as sending this.
private struct EmptyBody: Encodable {}

private struct ResolveZoneRequest: Encodable {
    let name: String
    let locationId: String?

    enum CodingKeys: String, CodingKey {
        case name
        case locationId = "location_id"
    }

    // Hand-written for ONE reason: Skip must OMIT the key, not send `location_id: null`.
    // Synthesised Encodable already does exactly this (`encodeIfPresent` for Optionals), but
    // that is a language detail a future reader would have to know by heart to trust the
    // wire shape - and the server's `v.optionalUuid` treating null and absent alike is not
    // something this side should be leaning on. Spelled out instead.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        if let locationId { try container.encode(locationId, forKey: .locationId) }
    }
}

enum OperatorTagAPI {
    /// POST /operator/tags {id} -> "this tag now exists and carries this id", called once
    /// right after the phone WRITES a fresh NDEF tag. Idempotent: the SAME id reported
    /// twice (flaky field wifi, a retry) lands exactly one row either way.
    ///   201 / 200  {tag}
    ///   409 id_in_use — a uuidv4 collision with a real location or zone; vanishingly
    ///                   unlikely, surfaced rather than swallowed.
    static func reportTag(id: String) async throws -> WireReportedTag {
        let envelope: WireReportedTagEnvelope = try await operatorPost("/operator/tags", ReportTagRequest(id: id))
        return envelope.tag
    }

    /// GET /operator/zones -> the worklist of doors still needing a test scan, plus the
    /// ones already proved. Cached by OperatorZoneCache.swift so the picker opens with the
    /// card already in hand and no signal at the door.
    static func zones() async throws -> [WireOperatorZone] {
        let envelope: WireOperatorZonesEnvelope = try await operatorGet("/operator/zones")
        return envelope.zones
    }

    /// POST /operator/zones/:id/verify {place_uuid} -> this card resolves to this zone; the
    /// zone becomes a clock-in target (decision-47). The zone must be picked BEFORE the
    /// card is scanned — see VerifyZoneScreen.swift — so this call only ever confirms a
    /// commitment the operator already made, never rubber-stamps whatever was scanned.
    ///   200 {zone}
    ///   404 unknown_zone · 422 zone_mismatch · 422 tag_unbound · 422 unknown_location
    static func verifyZone(zoneId: String, placeUuid: String) async throws -> WireZoneVerifyResult {
        let envelope: WireZoneVerifyEnvelope =
            try await operatorPost("/operator/zones/\(zoneId)/verify", VerifyZoneRequest(placeUuid: placeUuid))
        return envelope.zone
    }

    /// POST /operator/zones/:id/bind {location_id} -> this zone is in this building
    /// (decision-54 §3). The ONLY way an unbound zone becomes tappable: `activePlace` cannot
    /// resolve a zone with no building, so there is nothing to test-scan until this lands.
    ///
    /// IT CLEARS `verified_at` SERVER-SIDE, which is why the screen sends the operator back
    /// to the scan afterwards rather than calling the door done: the earlier proof, if there
    /// was one, was taken against a zone that resolved to nothing.
    ///   200 {zone} · 404 unknown_zone · 409 already_bound · 409 duplicate_zone_name ·
    ///   409 serial_taken · 422 unknown_location
    static func bindZone(zoneId: String, locationId: String) async throws -> WireCreatedZone {
        let envelope: WireCreatedZoneEnvelope =
            try await operatorPost("/operator/zones/\(zoneId)/bind", BindZoneRequest(locationId: locationId))
        return envelope.zone
    }

    /// POST /operator/zones/:id/unbind {} -> take the building away again.
    ///
    /// THE ONLY WAY BACK from a zone bound to the wrong building: `bindZone` refuses a zone
    /// that already has one (409 already_bound - rebinding is unbind-then-bind, never a silent
    /// move) and decision-54 §2/§3 took the same power out of the admin panel.
    ///
    /// IT DOES NOT CLEAR `verified_at`, unlike `bindZone` - the server keeps the stamp because
    /// it stays true of what was proved. Nothing here reimplements that either way.
    ///
    /// The body is empty: the zone in the path is the whole request.
    ///   200 {zone} · 404 unknown_zone · 409 already_unbound · 409 zone_has_shifts
    static func unbindZone(zoneId: String) async throws -> WireCreatedZone {
        let envelope: WireCreatedZoneEnvelope =
            try await operatorPost("/operator/zones/\(zoneId)/unbind", EmptyBody())
        return envelope.zone
    }

    /// GET /operator/zones/:id/shifts?page=N -> who worked at this door this month, and for
    /// how long (decision-54 §7). `month` is deliberately NOT sent: the server defaults it in
    /// SQL to its own `date_trunc('month', CURRENT_DATE)`, and a phone naming the month itself
    /// would put a second clock on a boundary that only the database gets to decide.
    ///   200 {shifts, page, page_size, matching, total_minutes, month} · 404 unknown_zone
    static func zoneShifts(zoneId: String, page: Int) async throws -> WireZoneShiftsPage {
        try await operatorGet("/operator/zones/\(zoneId)/shifts?page=\(page)")
    }

    /// GET /operator/locations -> the building picker's list, active buildings only.
    /// NOT cached: unlike the zone worklist, this list is only ever needed right after a
    /// successful report or when binding a zone, both of which already need signal anyway.
    static func locations() async throws -> [WireOperatorLocation] {
        let envelope: WireOperatorLocationsEnvelope = try await operatorGet("/operator/locations")
        return envelope.locations
    }

    /// POST /operator/tags/:id/resolve-zone {name, location_id?} -> the card just written at
    /// this door becomes a zone (decision-54 §2). `locationId` nil means the operator SKIPPED
    /// the building question: the key is left out of the body entirely and the zone lands
    /// unbound, which is a legitimate resting state, not a half-failure.
    ///   201 {zone}
    ///   404 unknown_reported_tag · 409 already_resolved · 409 duplicate_zone_name ·
    ///   409 id_in_use · 422 unknown_location
    static func resolveZone(tagId: String, name: String, locationId: String?) async throws -> WireCreatedZone {
        let envelope: WireCreatedZoneEnvelope =
            try await operatorPost("/operator/tags/\(tagId)/resolve-zone",
                                   ResolveZoneRequest(name: name, locationId: locationId))
        return envelope.zone
    }

    /// GET /operator/tags/:id -> classify ANY scanned card, with nothing selected first
    /// (decision-55 §1). READ-ONLY: it stamps nothing and creates nothing, which is what
    /// makes scanning the odd card in a drawer free.
    ///
    /// NOT `activePlace`, and deliberately not: the tap path must keep collapsing an unbound
    /// zone into `unknown_location`, while this route has to name it as a zone with work left
    /// on it. Two questions, two queries, named as such in decision-55's Consequences.
    ///   200 {kind: zone|building|retired|tag_reported|unknown, zone?} - always, no 404
    ///   400 the id is not a uuid
    static func classifyTag(id: String) async throws -> WireTagClassification {
        try await operatorGet("/operator/tags/\(id)")
    }

    /// POST /operator/zones/:id/reassign-building {new_tag_id, location_id} -> the door moved
    /// to another building (decision-55 §3). The OLD zone is retired (`active = false`, its
    /// history untouched) and a NEW zone is minted on `new_tag_id` carrying the old name and
    /// note forward, unverified, zero shifts.
    ///
    /// `new_tag_id` MUST ALREADY BE ON THE CARD AND REPORTED before this call - the phone
    /// mints it, writes it and reports it through OperatorTagMint, the same sequence Write a
    /// tag runs. An unreported id is a guaranteed 404 here.
    ///
    /// One statement, four EXISTS-gated CTEs server-side: either the tag is claimed AND the
    /// new zone lands AND the old one retires, or nothing happens at all. This side needs no
    /// rollback of its own.
    ///   201 {zone, retired_zone_id}
    ///   404 unknown_zone · 404 unknown_reported_tag · 409 zone_unbound ·
    ///   409 already_resolved · 409 duplicate_zone_name · 409 id_in_use · 422 unknown_location
    static func reassignBuilding(zoneId: String, newTagId: String,
                                 locationId: String) async throws -> WireReassignedZone {
        try await operatorPost("/operator/zones/\(zoneId)/reassign-building",
                               ReassignBuildingRequest(newTagId: newTagId, locationId: locationId))
    }
}
