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
