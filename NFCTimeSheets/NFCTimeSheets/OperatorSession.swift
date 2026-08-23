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

    /// Redeem an operator enrolment code. `raw` is whatever the operator typed —
    /// normalisation happens here, the same client-side courtesy Android gives
    /// (EnrolmentCode.swift), never a security control.
    func signIn(code raw: String) async {
        guard let code = EnrolmentCode.normalise(raw) else {
            state = .signedOut(reason: String(localized: "That doesn't look like an operator code."))
            return
        }
        busy = true
        defer { busy = false }
        do {
            let session = try await OperatorAuthAPI.signIn(code: code)
            store(session.operator)
        } catch let failure as APIFailure where failure.code == "too_many_attempts" {
            state = .signedOut(reason: String(localized: "Too many attempts - try again shortly."))
        } catch is APIFailure {
            // ONE message for every other failure mode (decision-45): unknown, expired,
            // already redeemed and revoked must stay indistinguishable, or the message
            // itself becomes an oracle over a live code.
            state = .signedOut(reason: String(localized: "Code not accepted. Check it and try again."))
        } catch {
            state = .signedOut(reason: String(localized: "No connection - try again."))
        }
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
