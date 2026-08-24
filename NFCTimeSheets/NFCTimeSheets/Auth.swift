//
//  Auth.swift
//  NFCTimeSheets
//
//  Worker identity (decision-22, decision-50). Everything the app knows about "who is
//  using this phone" lives here, and all of it came from the server.
//
//  What this replaced: a Picker in Settings bound to @AppStorage("workerId"). The worker
//  chose who they were and the server believed the worker_id in the request body, so any
//  worker - or anyone holding the app key - could file hours as anyone. That was an
//  authentication hole, not a UX wrinkle, and it is why the picker is gone rather than
//  restyled. THAT part - worker_id comes from the SESSION and never a request body - is
//  untouched by everything below and must stay true of every door added here.
//
//  Sign in with Apple was the FIRST mechanism to prove a worker session (decision-22) and
//  is RETIRED from this screen by decision-50: no AuthenticationServices import, no
//  SignInWithAppleButton, no "ineligible" dead end. Two doors replace it, both always
//  visible and neither gated: SMS one-time code (requestSmsCode / verifySmsCode) and the
//  admin-issued enrolment code (signInWithCode). All three mechanisms that have ever
//  existed - Apple, SMS, code - terminate in the SAME store(_:) tail: one cache write, one
//  Telemetry.setWorker, one .eligible transition, so nothing downstream can tell which
//  door was used. POST /auth/apple stays live on the SERVER for TestFlight builds already
//  in the field (decision-50 §3); this file simply has no caller for it any more.
//

import Foundation
import Observation

@MainActor
@Observable
final class Session {
    /// Three states, and there is no fourth. `unknown` is the split second at launch
    /// before the cache is read - it shows a spinner, never the app.
    enum State: Equatable {
        case unknown
        /// The SMS and enrolment-code doors. `reason` explains the last failure at the
        /// screen level (e.g. a dropped session); field-level SMS/code errors are held as
        /// local @State on SignInView itself, not here (ContentView.swift).
        case signedOut(reason: String?)
        /// The server matched this session to an active worker. The normal app.
        case eligible(WireWorker)
    }

    private(set) var state: State = .unknown
    /// A sign-in / sign-out call is in flight. Disables the button, nothing more.
    private(set) var busy = false

    var worker: WireWorker? {
        if case .eligible(let worker) = state { return worker }
        return nil
    }

    // ponytail: worker id + name cached in UserDefaults so a launch in a basement opens
    // straight into the app instead of a sign-in screen that cannot reach the server.
    // NOT the Keychain: none of this is a secret. The credential is the session cookie,
    // which URLSession keeps in the app container and which this file never touches.
    // CEILING: the cache can be stale for one launch if the admin deactivates someone
    // while they are offline; /auth/session corrects it the moment there is signal, and the
    // server rejects every write in between. UPGRADE PATH: none needed.
    private enum Cache {
        static let workerId = "session.workerId"
        static let workerName = "session.workerName"
    }

    init() {
        // Single place the app learns its session died. Posted from API.swift's response
        // choke point on any 401, so no call site can forget it. The observer is never
        // removed and does not need to be: exactly one Session exists and it is owned by
        // the App, so it outlives every screen.
        NotificationCenter.default.addObserver(
            forName: .sessionRejected, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.serverRejectedSession() }
        }
    }

    // MARK: - Launch

    /// Show the cached worker immediately, then let the server overrule it.
    ///
    /// The order matters both ways: optimistic first so there is no flash of a sign-in
    /// screen on every cold start, server second because the server is authoritative -
    /// a worker deactivated in the admin panel is signed out on their next launch.
    /// A network failure is NOT a sign-out: the phone is in a stairwell, not revoked.
    func restore() async {
        let defaults = UserDefaults.standard
        let cachedId = defaults.integer(forKey: Cache.workerId)
        if cachedId > 0 {
            state = .eligible(WireWorker(id: cachedId,
                                         name: defaults.string(forKey: Cache.workerName) ?? ""))
        } else if case .unknown = state {
            state = .signedOut(reason: nil)
        }

        do {
            store(try await AuthAPI.me())
        } catch let failure as APIFailure where failure.status == 401 {
            // Already handled by the .sessionRejected observer; nothing to add.
        } catch {
            // Offline or 5xx. Keep whatever we had - clocking in must work with no signal.
        }
    }

    // MARK: - Sign in by SMS or admin-issued code (decision-50)
    //
    // No `exchange`/`prepare`/`complete` triad any more - there is no third-party
    // authorization dance to drive. Each door is one network call; success runs the same
    // `store(_:)` tail every door has always run. Failures are left as thrown APIFailure:
    // the copy shown for the SAME server code differs by FIELD (an OTP request's "not on
    // file" is not a code redemption's "ask your admin for a new one"), so the mapping
    // lives beside the field it is shown next to (ContentView.swift SignInView), not here.

    /// POST /auth/sms/request. Mints no session - only "was a code sent". The caller
    /// (SignInView) moves to the code-entry field on success and shows the thrown
    /// failure's message on the phone field otherwise.
    func requestSmsCode(phone: String) async throws {
        busy = true
        defer { busy = false }
        _ = try await AuthAPI.requestSmsCode(phone: phone)
    }

    /// POST /auth/sms/verify. On success, the SAME store(_:) tail as every other door.
    func verifySmsCode(phone: String, code: String) async throws {
        busy = true
        defer { busy = false }
        store(try await AuthAPI.verifySmsCode(phone: phone, code: code))
    }

    /// POST /auth/code. `code` is already EnrolmentCode.normalise()'d by the caller.
    func signInWithCode(_ code: String) async throws {
        busy = true
        defer { busy = false }
        store(try await AuthAPI.signInWithCode(code))
    }

    // MARK: - Sign out

    /// The last row in Settings. Revokes the session server-side first so a stolen phone
    /// cannot keep the cookie alive, then drops everything locally even if that call failed.
    func signOut() async {
        busy = true
        defer { busy = false }
        try? await AuthAPI.logout()
        clearLocalSession()
        state = .signedOut(reason: nil)
    }

    /// A 401 came back from somewhere. The session is gone: expired, revoked, or the
    /// worker was deactivated. Drop to signed-out once; do not retry, do not loop.
    private func serverRejectedSession() {
        if case .signedOut = state { return }  // already there; don't stomp the reason
        clearLocalSession()
        state = .signedOut(reason: "Your session ended. Sign in again.")
    }

    // MARK: - Cache

    private func store(_ session: WireSession) {
        UserDefaults.standard.set(session.worker.id, forKey: Cache.workerId)
        UserDefaults.standard.set(session.worker.name, forKey: Cache.workerName)
        // Worker ID and nothing else. Not the name, not the address Apple gave us, not
        // the Apple `sub` - this is EU payroll data about a named person and the id is
        // enough to correlate a client trace with the server's.
        Telemetry.setWorker(id: session.worker.id)
        state = .eligible(session.worker)
    }

    private func clearCache() {
        UserDefaults.standard.removeObject(forKey: Cache.workerId)
        UserDefaults.standard.removeObject(forKey: Cache.workerName)
    }

    /// Cache + cookie. The cookie is dropped locally as well as server-side: if logout
    /// could not reach the server, leaving the cookie on the phone would sign the next
    /// person straight back in as this worker.
    private func clearLocalSession() {
        clearCache()
        Telemetry.clearWorker()
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies(for: API.base) ?? [] { storage.deleteCookie(cookie) }
    }
}
