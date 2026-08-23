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
struct WireOperatorZone: Codable, Identifiable, Hashable {
    let id: String
    let locationId: String
    let locationName: String
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
}
