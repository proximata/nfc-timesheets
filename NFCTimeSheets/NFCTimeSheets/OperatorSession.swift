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

    // Same idiom as Auth.swift's Cache: an optimistic local echo of WHO is signed in,
    // kept in UserDefaults because it is not a secret. IT IS NOT THE GATE, and saying so
    // is the whole of TASK-276: this cache used to BE the gate, it is written once at
    // first sign-in and nothing but signOut() ever cleared it, so a worker sign-out (which
    // deletes every cookie for API.base, ts_operator included — Auth.swift) left the two
    // actions on screen behind a dead credential with no way back to the code form short
    // of a reinstall. The credential is the ts_operator cookie and the cookie is what is
    // read now — the cache only supplies the name printed next to it.
    private enum Cache {
        static let id = "operator.id"
        static let name = "operator.name"
    }

    init() {
        // A 401 from an operator call, and ONLY from an operator call. Deliberately not
        // .sessionRejected: that one is the worker's, posted from API.swift's choke point,
        // and an operator code going stale must never sign a cleaner out mid-shift (see
        // the header of OperatorAPI.swift). Same reason Android's operatorApi passes a
        // no-op where the worker's passes sessionRejected. Never removed and does not need
        // to be: exactly one OperatorSession exists and the App owns it.
        NotificationCenter.default.addObserver(
            forName: .operatorSessionRejected, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.serverRejectedSession() }
        }
        refresh()
    }

    /// Re-derive the gate from the cookie on disk. NO NETWORK CALL — a basement with no
    /// signal must still let a signed-in operator through (decision-54 §4). Called from
    /// OperatorHomeScreen every time it appears, not once at launch: the session can have
    /// died while that screen sat in the background, and coming back to a gate that still
    /// says "signed in" is how an operator ends up at a card with no credential. Android's
    /// TimeSheetViewModel.refreshOperatorReady() is the same three lines.
    func refresh() {
        guard hasSessionCookie else {
            if case .signedOut = state { return }  // don't stomp an existing reason
            clearCache()
            state = .signedOut(reason: nil)
            return
        }
        let defaults = UserDefaults.standard
        let cachedId = defaults.integer(forKey: Cache.id)
        state = .signedIn(WireOperator(id: cachedId,
                                       name: defaults.string(forKey: Cache.name) ?? ""))
    }

    /// The credential itself, read out of the jar URLSession already keeps across launches
    /// (OperatorAPI.swift). By NAME, never by host: ts_worker lives in the same jar.
    private var hasSessionCookie: Bool {
        (HTTPCookieStorage.shared.cookies(for: API.base) ?? []).contains { $0.name == "ts_operator" }
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

    /// A 401 came back from an operator call: expired, revoked, or the code was withdrawn.
    /// Drop to signed-out once so WriteTagScreen/VerifyZoneScreen's existing
    /// onChange(of: operatorInfo == nil) dismiss actually fires and the code form comes
    /// back. The worker's session is not touched.
    private func serverRejectedSession() {
        if case .signedOut = state { return }
        clearLocalSession()
        state = .signedOut(reason: String(localized: "Your session ended. Sign in again."))
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
        clearCache()
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies(for: API.base) ?? [] where cookie.name == "ts_operator" {
            storage.deleteCookie(cookie)
        }
    }

    /// The display echo only. The cookie is gone already (or was never there) whenever
    /// this runs on its own from refresh().
    private func clearCache() {
        UserDefaults.standard.removeObject(forKey: Cache.id)
        UserDefaults.standard.removeObject(forKey: Cache.name)
    }
}
