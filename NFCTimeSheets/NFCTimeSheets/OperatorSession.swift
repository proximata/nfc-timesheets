//
//  OperatorSession.swift
//  NFCTimeSheets
//
//  Operator identity (decision-45): the person who mounts and tests NFC tags, never a
//  cleaner. A SIBLING of Auth.swift's Session, deliberately not a case added to it — a
//  shared state that could also mean "operator" would put a stray branch one edit away
//  from the credential that has structurally never been able to open a shift, and this
//  keeps that structural fact instead of merely asserting it.
//
//  Two states past launch, and both are read-only outside this file: signed out with a
//  reason, or signed in as a named operator. There is no "ineligible" state here — unlike
//  Sign in with Apple, presenting an operator code that redeems successfully IS being an
//  operator; there is no separate identity check to fail afterwards.
//

import Foundation
import Observation

@MainActor
@Observable
final class OperatorSession {
    enum State: Equatable {
        case unknown
        case signedOut(reason: String?)
        case signedIn(WireOperator)
    }

    private(set) var state: State = .unknown
    /// A sign-in / sign-out call is in flight. Disables the button, nothing more.
    private(set) var busy = false

    var operatorInfo: WireOperator? {
        if case .signedIn(let op) = state { return op }
        return nil
    }

    // Same idiom as Auth.swift's Cache: an optimistic local echo of who is signed in,
    // kept in UserDefaults because it is not a secret — the credential is the
    // ts_operator cookie, held by URLSession's own jar exactly the way ts_worker already
    // is (see the header of OperatorAPI.swift). There is no GET /auth/operator-session to
    // reconcile against at launch — decision-45 ships sign-in and sign-out only — so this
    // cache is trusted until the next operator call 401s and this screen is opened again,
    // at which point signIn overwrites it and signOut clears it.
    private enum Cache {
        static let id = "operator.id"
        static let name = "operator.name"
    }

    init() {
        let defaults = UserDefaults.standard
        let cachedId = defaults.integer(forKey: Cache.id)
        state = cachedId > 0
            ? .signedIn(WireOperator(id: cachedId, name: defaults.string(forKey: Cache.name) ?? ""))
            : .signedOut(reason: nil)
    }

    /// Redeem an operator enrolment code. `code` is already EnrolmentCode.normalise()'d by
    /// the caller — exactly the shape Session.signInWithCode has always had, and now the
    /// same one, because ONE form calls both (decision-54 §5).
    ///
    /// THROWS rather than parking a sentence in `state`. The failure copy has to sit next
    /// to the field that was typed into, and that field is now shared with the worker's
    /// door, so the mapping lives in CodeSignInSection.codeMessage(for:role:) — including
    /// decision-45's one-message rule, which is unchanged: unknown, expired, already
    /// redeemed and revoked stay indistinguishable there.
    func signIn(code: String) async throws {
        busy = true
        defer { busy = false }
        store(try await OperatorAuthAPI.signIn(code: code).operator)
    }

    /// POST /auth/operator-sms/request (decision-54 §5). Mints no session — only "was a
    /// code sent". Same contract as Session.requestSmsCode, same reason for throwing.
    func requestSmsCode(phone: String) async throws {
        busy = true
        defer { busy = false }
        _ = try await OperatorAuthAPI.requestSmsCode(phone: phone)
    }

    /// POST /auth/operator-sms/verify. On success, the SAME store(_:) tail the code door
    /// runs — one cache write, one place the operator becomes signed in.
    func verifySmsCode(phone: String, code: String) async throws {
        busy = true
        defer { busy = false }
        store(try await OperatorAuthAPI.verifySmsCode(phone: phone, code: code).operator)
    }

    /// Revokes the session server-side first, then drops the local cookie regardless of
    /// whether that call landed — same order Auth.swift's signOut uses for the worker.
    func signOut() async {
        busy = true
        defer { busy = false }
        try? await OperatorAuthAPI.logout()
        clearLocalSession()
        state = .signedOut(reason: nil)
    }

    private func store(_ op: WireOperator) {
        UserDefaults.standard.set(op.id, forKey: Cache.id)
        UserDefaults.standard.set(op.name, forKey: Cache.name)
        state = .signedIn(op)
    }

    /// Cache + cookie — but ONLY the operator's cookie. Auth.swift's own sign-out already
    /// clears every cookie for API.base when the WORKER signs out (decision-22); that is
    /// the worker's call to make about the worker's session. Deleting by cookie NAME
    /// here, never by host, means an operator signing out on a phone that also holds a
    /// worker session leaves ts_worker exactly as it was.
    private func clearLocalSession() {
        UserDefaults.standard.removeObject(forKey: Cache.id)
        UserDefaults.standard.removeObject(forKey: Cache.name)
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies(for: API.base) ?? [] where cookie.name == "ts_operator" {
            storage.deleteCookie(cookie)
        }
    }
}
