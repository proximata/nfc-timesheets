//
//  API.swift
//  NFCTimeSheets
//
//  The wire contract, and nothing else. Foundation + CryptoKit only - no SwiftUI, no
//  SwiftData, no AuthenticationServices - so checks/tag-link-check.swift can compile and
//  exercise it outside Xcode.
//
//  Every field name below is snake_case and spelled out in an explicit CodingKeys. The
//  previous version of this file used camelCase names of its own invention ("worker",
//  "tagUID", "manualFinish") that the server had never heard of; every POST came back
//  400 and was swallowed by a bare `catch {}`, so shifts piled up on the phone forever
//  with a clean-looking UI. Explicit keys are here to be diffed against server/routes/
//  by eye. Do not replace them with .convertToSnakeCase.
//

import CryptoKit
import Foundation

enum API {
    static let base = URL(string: "https://timesheets.exe.xyz")!

    // This key is NOT a secret, and is deliberately committed in cleartext.
    //
    // It is compiled into the binary, so `strings` on any installed IPA recovers it.
    // Hiding it from git would protect nothing while it sits readable on every worker's
    // phone. It is a coarse gate against unauthenticated internet noise, nothing more.
    //
    // Since decision-22 it carries no authority on its own: /roster and every /shifts/*
    // route require a worker session from Sign in with Apple, and the app key alone
    // answers 401. Extracting it buys an attacker no ability to file or read hours.
    //
    // Because it is not a secret it is intentionally NOT in the psst vault - keeping it
    // there blocked every commit touching this file for no security gain. THIS LINE IS
    // THE RECORD: /etc/nfc/env on the VM must carry the same value, and re-provisioning
    // reads it from here.
    //
    // Rotated 2026-07-28; the previous key is permanently burned (leaked to an agent
    // transcript and a plaintext env file beside a public VM). Rotating REQUIRES shipping
    // a new build and updating /etc/nfc/env together - an old build stops working the
    // moment the server flips.
    //
    // CEILING: fine for a TestFlight-internal single-company app. If the API ever needs a
    // credential that must genuinely stay secret, this constant must go entirely - the fix
    // is not to hide it better, it is to never compile a credential in.
    static let appKey = "tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65"

    // No admin surface here on purpose. The X-Admin-Pin header is gone; admin is
    // password-authenticated on the web (decision-20).

    /// Apple audience for the identity token. The SERVER verifies this claim; it is
    /// written here only so the two halves can be diffed by eye.
    static let bundleId = "io.github.qwadratic.NFCTimeSheets"
}

/// The session died server-side (expired, revoked, worker deactivated). Posted from the
/// single response choke point below so no call site can forget to handle it, and the
/// app drops to signed-out instead of retrying a request that can never succeed.
extension Notification.Name {
    static let sessionRejected = Notification.Name("io.github.qwadratic.NFCTimeSheets.sessionRejected")
}

// MARK: - Date coding

/// One encoder and one decoder for the whole app.
/// Encode: ISO-8601 with fractional seconds, UTC (`2026-07-28T14:03:11.412Z`).
/// Decode: fractional first, then plain - Postgres hands back whole seconds when the
/// microseconds happen to be zero, and a decoder that only knew one shape would throw
/// on an otherwise perfect response.
enum Wire {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func string(from date: Date) -> String { isoFractional.string(from: date) }

    static func date(from text: String) -> Date? {
        isoFractional.date(from: text) ?? isoPlain.date(from: text)
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(string(from: date))
        }
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = date(from: text) else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: decoder.codingPath, debugDescription: "not ISO-8601: \(text)"))
            }
            return date
        }
        return d
    }()
}

// MARK: - Errors

/// A failed call, classified. `status == 0` means the request never got an answer.
struct APIFailure: Error {
    let status: Int
    let code: String
    let field: String?
    /// Only ever set by 403 not_eligible: the address Apple actually handed the server.
    /// With Hide My Email that is a relay address the admin cannot know in advance, so
    /// echoing it back is the whole mechanism - the worker reads it to their manager
    /// who pastes it into the worker record. There is no approval queue by design.
    let email: String?
    let body: Data?

    init(status: Int, code: String, field: String? = nil, email: String? = nil, body: Data? = nil) {
        self.status = status
        self.code = code
        self.field = field
        self.email = email
        self.body = body
    }

    /// Retry, or give up and tell the worker?
    ///
    /// Retrying a 400 forever is pointless - the same bytes will be rejected the same
    /// way after lunch. A 4xx means THIS payload is wrong and a human has to act; a
    /// transport error, a 5xx, a 408 or a 429 means the payload may well be fine and
    /// the next attempt can succeed.
    ///
    /// 409 shift_already_open is the one 4xx that is retryable: it means an OLDER shift
    /// of ours has not been closed on the server yet. The sync pass works in start-time
    /// order, so the next pass closes that one first and this open then lands.
    var isRetryable: Bool {
        if code == "shift_already_open" { return true }
        return status == 0 || status == 408 || status == 429 || status >= 500
    }

    /// Shown to the worker. Deliberately says what to DO, not what broke.
    ///
    /// ponytail: English literals. CEILING: decision-8 wants every user-visible string
    /// externalised, but 3A does the i18n work on the web admin only and the rest of
    /// this app is hardcoded English too. UPGRADE PATH: move the whole app to a
    /// String Catalog (Localizable.xcstrings) in one pass rather than half of it now.
    var workerMessage: String {
        switch code {
        case "network":
            return "No connection - will send when you're back online."
        case "unknown_worker":
            return "Your name is no longer on the roster. Ask your admin."
        case "unknown_location":
            return "This location was removed. Ask your admin."
        case "unknown_shift":
            return "The server doesn't have this shift. Ask your admin."
        case "shift_already_open":
            return "Another shift is still running - finishing it first."
        case "end_before_start":
            return "Finish time is before the start time."
        case "timestamp_in_future", "timestamp_out_of_range":
            return "This phone's clock looks wrong. Check Date & Time in Settings."
        case "unauthorized":
            return "This app version was rejected by the server. Update it."
        case "no_session":
            return "You were signed out. Sign in again."
        case "invalid_token":
            return "Apple sign-in failed. Try again."
        case "not_eligible":
            return "This Apple ID isn't registered as a worker."
        case "too_many_attempts":
            return "Too many attempts - try again shortly."
        default:
            return status >= 500 || status == 0
                ? "Server trouble - will retry."
                : "Rejected by the server (\(code)). Ask your admin."
        }
    }
}

// MARK: - Wire types

struct WireWorker: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
}

// MARK: - Auth (decision-22)

/// POST /auth/apple body.
///
/// `nonce` is the RAW nonce. The value handed to Apple is its SHA-256 hex, so the token
/// itself never carries the raw value; the server re-hashes this field and compares.
/// Sending the token without a nonce would let a token minted for another session be
/// replayed here.
///
/// `name` is present on the FIRST authorization only - Apple never sends it again, for
/// any later sign-in, on any device. The server takes it as a hint and nothing more:
/// the worker's real name lives in the workers row the admin created.
struct AppleSignInRequest: Encodable {
    let identityToken: String
    let nonce: String
    let name: String?

    enum CodingKeys: String, CodingKey {
        case identityToken = "identity_token"
        case nonce
        case name
    }
}

/// 200 from POST /auth/apple and GET /auth/session. The session cookie rides in the headers.
/// `expiresAt` is informational and OPTIONAL: only the sign-in response carries it,
/// /auth/session answers with the worker alone. The server enforces expiry either way,
/// so the app never pre-empts it.
struct WireSession: Decodable {
    let worker: WireWorker
    let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case worker
        case expiresAt = "expires_at"
    }
}

/// `{}`. Used where the server answers with an empty object.
struct WireEmpty: Decodable {}

struct WireLocation: Codable, Identifiable, Hashable {
    /// UUID. This is what a tag carries (decision-21).
    let id: String
    /// Human-readable handle. Display and log lines ONLY - never goes on a tag.
    let slug: String
    let name: String
}

/// GET /roster. The server also sends a `workers` array; it is deliberately NOT decoded.
/// The app has no picker to fill any more (decision-22) and does not need a staff list on
/// every phone - and leaving the field out means the day the server stops sending it, the
/// location cache keeps decoding instead of the app forgetting every tag it knows.
struct WireRoster: Codable {
    let locations: [WireLocation]
}

/// The single shift shape every shift endpoint returns.
/// `location_slug` / `location_name` ride along on the joined queries only.
struct WireShift: Codable, Identifiable {
    let id: Int
    let workerId: Int
    let locationId: String
    let startTime: Date
    let endTime: Date?
    let autoClosed: Bool
    let correctedAt: Date?
    /// Nullable in the schema, and not necessarily UUID-shaped for rows the server made
    /// itself, so it is decoded as a plain String.
    let clientUuid: String?
    let locationSlug: String?
    let locationName: String?

    enum CodingKeys: String, CodingKey {
        case id
        case workerId = "worker_id"
        case locationId = "location_id"
        case startTime = "start_time"
        case endTime = "end_time"
        case autoClosed = "auto_closed"
        case correctedAt = "corrected_at"
        case clientUuid = "client_uuid"
        case locationSlug = "location_slug"
        case locationName = "location_name"
    }

    /// Derived, never stored (decision-10): the 8h timer closed it and no human has
    /// fixed it yet. No third flag exists that could disagree with these two.
    var needsResolution: Bool { autoClosed && correctedAt == nil }
}

struct WireShiftEnvelope: Codable {
    let shift: WireShift
    let duplicate: Bool?
}

struct WireOptionalShiftEnvelope: Codable {
    let shift: WireShift?
}

struct WireShiftListEnvelope: Codable {
    let shifts: [WireShift]
}

/// decision-22: NO worker_id. Who is clocking in is decided by the session cookie on
/// the server, never by a field the phone fills in. Putting it back would restore the
/// hole this whole change exists to close - anyone could file hours as anyone.
struct OpenShiftRequest: Encodable {
    let clientUuid: String
    let locationUuid: String
    let startTime: Date

    enum CodingKeys: String, CodingKey {
        case clientUuid = "client_uuid"
        case locationUuid = "location_uuid"
        case startTime = "start_time"
    }
}

struct CloseShiftRequest: Encodable {
    let clientUuid: String
    let endTime: Date
    /// True when the APP closed the shift rather than the worker deliberately tapping out
    /// (today: they tapped a different building first). The end time is then the moment they
    /// turned up elsewhere, which nobody confirmed, so the server flags it for resolution.
    let autoClosed: Bool

    enum CodingKeys: String, CodingKey {
        case clientUuid = "client_uuid"
        case endTime = "end_time"
        case autoClosed = "auto_closed"
    }
}

struct ResolveShiftRequest: Encodable {
    let endTime: Date

    enum CodingKeys: String, CodingKey {
        case endTime = "end_time"
    }
}

// MARK: - Transport

private func apiURL(_ path: String, query: [String: String]) -> URL {
    var parts = URLComponents(url: API.base.appending(path: path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty {
        parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
    }
    return parts.url!
}

/// Single choke point: every response is classified before anything else sees it.
private func send(_ request: URLRequest) async throws -> Data {
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await URLSession.shared.data(for: request)
    } catch {
        // Offline, DNS, timeout, TLS. Always retryable.
        throw APIFailure(status: 0, code: "network")
    }

    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
        // Server error bodies are `{"error":"code"}` (+ optional `"field"` / `"email"`).
        let parsed = try? Wire.decoder.decode(WireError.self, from: data)
        // Any 401 means this session is not coming back: expired, revoked, or the worker
        // was deactivated in the admin panel. Drop to signed-out ONCE, from here, rather
        // than letting each caller retry a request that can never succeed (decision-22).
        if status == 401 { NotificationCenter.default.post(name: .sessionRejected, object: nil) }
        throw APIFailure(status: status,
                         code: parsed?.error ?? "http_\(status)",
                         field: parsed?.field,
                         email: parsed?.email,
                         body: data)
    }
    return data
}

private struct WireError: Decodable {
    let error: String
    let field: String?
    let email: String?
}

/// The worker session rides in a cookie, held by URLSession's shared cookie store. No
/// call site here sets or reads it: HTTPCookieStorage does that, persists it across
/// launches (the server sends Max-Age), and keeps it in the app's protected container
/// rather than in UserDefaults where a backup or a file browser would find it. The
/// worker therefore signs in about once a week, not once per shift.
func apiGet<Out: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> Out {
    var request = URLRequest(url: apiURL(path, query: query))
    request.setValue(API.appKey, forHTTPHeaderField: "X-App-Key")
    return try Wire.decoder.decode(Out.self, from: try await send(request))
}

func apiPost<In: Encodable, Out: Decodable>(_ path: String, _ body: In) async throws -> Out {
    var request = URLRequest(url: apiURL(path, query: [:]))
    request.httpMethod = "POST"
    request.setValue(API.appKey, forHTTPHeaderField: "X-App-Key")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try Wire.encoder.encode(body)
    return try Wire.decoder.decode(Out.self, from: try await send(request))
}

// MARK: - Endpoints

/// Sign-in, session restore, sign-out. Everything else on the app surface assumes the
/// cookie one of these left behind.
enum AuthAPI {
    /// POST /auth/apple {identity_token, nonce, name?}
    /// 200 signed in · 403 not_eligible (+ the email Apple gave) · 401 invalid_token.
    static func signInWithApple(identityToken: String, nonce: String, name: String?) async throws -> WireSession {
        try await apiPost("/auth/apple",
                          AppleSignInRequest(identityToken: identityToken, nonce: nonce, name: name))
    }

    /// GET /auth/session - is this cookie still a worker? 401 when it is not.
    /// Asked on every launch: the server, not the phone, decides who is signed in, so
    /// deactivating a worker in the admin panel locks them out on their next launch.
    static func me() async throws -> WireSession { try await apiGet("/auth/session") }

    /// POST /auth/logout - revokes the session server-side, not just locally.
    static func logout() async throws {
        let _: WireEmpty = try await apiPost("/auth/logout", WireLogoutRequest())
    }
}

/// POST with no fields. `{}` rather than an empty body so the server's JSON parse is
/// never handed zero bytes.
private struct WireLogoutRequest: Encodable {}

/// Replay protection for the Apple identity token.
///
/// Apple copies whatever string is put in `ASAuthorizationAppleIDRequest.nonce` into the
/// token's `nonce` claim verbatim. So the HASH goes to Apple and the RAW value goes to
/// our server, which re-hashes it and compares. Anyone who intercepts the token learns
/// only the hash and cannot construct the matching body. Both halves must agree on this
/// exact spelling - lowercase hex of SHA-256 over the raw string's UTF-8 - or every
/// single sign-in 401s. checks/tag-link-check.swift pins it to a known vector.
enum AppleNonce {
    /// 32 bytes of hex. SystemRandomNumberGenerator is documented as cryptographically
    /// secure on Apple platforms, so this needs no SecRandomCopyBytes ceremony.
    static func raw() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max)) }.joined()
    }

    static func hashed(_ raw: String) -> String {
        SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

enum ShiftAPI {
    /// POST /shifts/open  {client_uuid, location_uuid, start_time}
    /// 201 new · 200 duplicate (same client_uuid) · 409 shift_already_open.
    /// The worker is the session's worker. See OpenShiftRequest for why.
    static func open(clientUuid: String, locationId: String, startTime: Date) async throws
        -> WireShiftEnvelope
    {
        try await apiPost("/shifts/open",
                          OpenShiftRequest(clientUuid: clientUuid,
                                           locationUuid: locationId,
                                           startTime: startTime))
    }

    /// POST /shifts/close {client_uuid, end_time}. No duration ceiling any more: the old
    /// 422 shift_too_long blocked exactly the worker the 8h net exists for (decision-10).
    static func close(clientUuid: String, endTime: Date, autoClosed: Bool = false) async throws -> WireShiftEnvelope {
        try await apiPost("/shifts/close",
                          CloseShiftRequest(clientUuid: clientUuid, endTime: endTime, autoClosed: autoClosed))
    }

    /// GET /shifts/open - the server, not the phone, is authoritative for "who is clocked
    /// in right now" (decision-19), and for WHO is asking (decision-22). The ?worker=
    /// parameter is gone: it let any caller read any worker's whereabouts.
    static func currentOpen() async throws -> WireShift? {
        let envelope: WireOptionalShiftEnvelope = try await apiGet("/shifts/open")
        return envelope.shift
    }

    /// GET /shifts/unresolved - auto_closed AND corrected_at IS NULL, for the session's
    /// worker. ?worker= removed for the same reason as above.
    static func unresolved() async throws -> [WireShift] {
        let envelope: WireShiftListEnvelope = try await apiGet("/shifts/unresolved")
        return envelope.shifts
    }

    /// GET /shifts/mine?since=<iso8601> - this worker's shifts, newest first.
    ///
    /// Exists so the on-device migration can ask "does the server already hold this
    /// client_uuid?" before touching a legacy row (DataMigrations.swift), instead of
    /// guessing or duplicating. The worker is the session's worker; there is no ?worker=
    /// and there must never be one (decision-22).
    static func mine(since: Date) async throws -> [WireShift] {
        let envelope: WireShiftListEnvelope =
            try await apiGet("/shifts/mine", query: ["since": Wire.string(from: since)])
        return envelope.shifts
    }

    /// POST /shifts/:id/resolve {end_time} - the worker supplies the real finish time.
    static func resolve(shiftId: Int, endTime: Date) async throws -> WireShift {
        let envelope: WireShiftEnvelope = try await apiPost("/shifts/\(shiftId)/resolve",
                                                            ResolveShiftRequest(endTime: endTime))
        return envelope.shift
    }
}

enum RosterAPI {
    /// GET /roster -> workers + locations the app may pick from.
    static func fetch() async throws -> WireRoster { try await apiGet("/roster") }
}
