//
//  Auth.swift
//  NFCTimeSheets
//
//  Worker identity (decision-22). Everything the app knows about "who is using this
//  phone" lives here, and all of it came from the server.
//
//  What this replaced: a Picker in Settings bound to @AppStorage("workerId"). The worker
//  chose who they were and the server believed the worker_id in the request body, so any
//  worker - or anyone holding the app key - could file hours as anyone. That was an
//  authentication hole, not a UX wrinkle, and it is why the picker is gone rather than
//  restyled.
//
//  Apple only, no Google, on purpose:
//    - AuthenticationServices is a native framework: no SDK, no client secret in the
//      binary, no third-party code path to audit.
//    - App Store guideline 4.8 requires Sign in with Apple alongside any third-party
//      provider. Apple-only is compliance for free; adding Google buys an obligation.
//    - Every user of this app is on an iPhone. They all already have an Apple ID.
//  Google becomes interesting the day an Android app exists, and not one day earlier.
//

import AuthenticationServices
import Foundation
import Observation

@MainActor
@Observable
final class Session {
    /// Three states, and there is no fourth. `unknown` is the split second at launch
    /// before the cache is read - it shows a spinner, never the app.
    enum State: Equatable {
        case unknown
        /// Nothing but a Sign in with Apple button. `reason` explains the last failure.
        case signedOut(reason: String?)
        /// The server matched this Apple ID to an active worker. The normal app.
        case eligible(WireWorker)
        /// Signed in to Apple, not a worker here. A dead end by design: the email is the
        /// only thing on screen that can change anything, and only by being read aloud
        /// to a manager who pastes it into the worker record.
        case ineligible(email: String?)
    }

    private(set) var state: State = .unknown
    /// A sign-in / sign-out call is in flight. Disables the button, nothing more.
    private(set) var busy = false

    var worker: WireWorker? {
        if case .eligible(let worker) = state { return worker }
        return nil
    }

    /// Nonce for the authorization currently on screen. Cleared as soon as it is spent -
    /// a nonce that can be used twice is not a nonce.
    private var pendingNonce: String?

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
        /// Apple's stable user identifier, needed only to ask iOS whether the user
        /// revoked this app in Settings > Apple ID > Sign in with Apple.
        static let appleUserId = "session.appleUserId"
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

        await verifyAppleCredentialState()

        do {
            store(try await AuthAPI.me())
        } catch let failure as APIFailure where failure.status == 401 {
            // Already handled by the .sessionRejected observer; nothing to add.
        } catch {
            // Offline or 5xx. Keep whatever we had - clocking in must work with no signal.
        }
    }

    /// The user can revoke this app under Settings > Apple ID > Sign in with Apple, and
    /// deleting their Apple ID has the same effect. iOS knows before the server does.
    private func verifyAppleCredentialState() async {
        guard let appleUserId = UserDefaults.standard.string(forKey: Cache.appleUserId) else { return }
        let credentialState = try? await ASAuthorizationAppleIDProvider()
            .credentialState(forUserID: appleUserId)
        switch credentialState {
        case .revoked:
            await signOut()
        case .authorized, .notFound, .transferred, .none:
            // notFound covers "asked while offline" as well as "never signed in", so it
            // is deliberately NOT a sign-out: the server session is the thing that
            // decides, and it will 401 if it has genuinely gone. `transferred` only
            // happens if this app moves to another developer account, which is not a
            // reason to throw a worker out mid-shift.
            break
        @unknown default:
            break
        }
    }

    // MARK: - Sign in with Apple

    /// Configure the authorization request. Called by SignInWithAppleButton's onRequest.
    func prepare(_ request: ASAuthorizationAppleIDRequest) {
        let raw = AppleNonce.raw()
        pendingNonce = raw
        request.requestedScopes = [.fullName, .email]
        // The HASH goes to Apple, the raw value goes to our server. See AppleNonce.
        request.nonce = AppleNonce.hashed(raw)
    }

    /// Called by SignInWithAppleButton's onCompletion.
    func complete(_ result: Result<ASAuthorization, Error>) async {
        let nonce = pendingNonce
        pendingNonce = nil
        busy = true
        defer { busy = false }

        switch result {
        case .failure(let error):
            // A cancel is not an error worth shouting about - they tapped the X.
            if (error as? ASAuthorizationError)?.code == .canceled {
                state = .signedOut(reason: nil)
            } else {
                state = .signedOut(reason: "Apple sign-in didn't finish. Try again.")
            }

        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8),
                  let nonce
            else {
                state = .signedOut(reason: "Apple didn't return a usable sign-in. Try again.")
                return
            }
            UserDefaults.standard.set(credential.user, forKey: Cache.appleUserId)
            await exchange(identityToken: identityToken,
                           nonce: nonce,
                           name: Self.formatted(credential.fullName),
                           appleEmail: credential.email)
        }
    }

    /// Trade the identity token for a session. The server decides eligibility; the app
    /// only renders the answer.
    private func exchange(identityToken: String, nonce: String, name: String?, appleEmail: String?) async {
        do {
            store(try await AuthAPI.signInWithApple(identityToken: identityToken, nonce: nonce, name: name))
        } catch let failure as APIFailure where failure.code == "not_eligible" {
            clearCache()
            // The server echoes back exactly what Apple gave it, which with Hide My Email
            // is a relay address nobody could have registered in advance. `credential.email`
            // is the fallback, and it is only ever populated on a first authorization.
            state = .ineligible(email: failure.email ?? appleEmail)
        } catch let failure as APIFailure {
            clearCache()
            state = .signedOut(reason: failure.workerMessage)
        } catch {
            clearCache()
            state = .signedOut(reason: APIFailure(status: 0, code: "network").workerMessage)
        }
    }

    /// Apple hands over the name on the FIRST authorization only - never again, on any
    /// device, for the life of the app. It is a hint for the admin, not an identity:
    /// the worker's real name is whatever is in the workers row they were matched to.
    private static func formatted(_ components: PersonNameComponents?) -> String? {
        guard let components else { return nil }
        let name = PersonNameComponentsFormatter().string(from: components)
        return name.isEmpty ? nil : name
    }

    // MARK: - Sign out

    /// The only control on the ineligible screen, and the last row in Settings. Revokes
    /// the session server-side first so a stolen phone cannot keep the cookie alive,
    /// then drops everything locally even if that call failed.
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
        UserDefaults.standard.removeObject(forKey: Cache.appleUserId)
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies(for: API.base) ?? [] { storage.deleteCookie(cookie) }
    }
}
