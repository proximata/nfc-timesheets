//
//  DemoHooks.swift
//  NFCTimeSheets
//
//  THE ENTIRE FILE IS INSIDE `#if DEBUG`. A Release build does not contain one byte of it:
//  there is no symbol, no string and no branch to reach. `demo/ios-setup.sh --prove-release`
//  greps the Release binary for the markers below and fails if any of them survive.
//
//  WHY IT EXISTS. TAP cannot be done on a simulator, and that is not a limitation of this
//  app: the tag hands the app a universal link, and a universal link needs the
//  `com.apple.developer.associated-domains` entitlement. The iOS Simulator SDK sets
//  `ENTITLEMENTS_ALLOWED = NO`, so a simulator build HAS no entitlements — forcing
//  `ENTITLEMENTS_ALLOWED=YES` on the xcodebuild command line still produces an empty
//  `<dict/>`. `simctl openurl` therefore opens Safari, every time, by construction. (On a
//  device the same tap works and is what workers use daily; nothing here is a workaround
//  for a bug.)
//
//  So this file injects, at launch and from the command line, the value that path would
//  have produced — AND NOTHING ELSE. What happens after the injection is the shipping
//  code, unmodified: the id goes through TagLink.normalizedUUID — the trust boundary that
//  keeps anything not UUID-shaped off the wire (decision-15) — and then into the same
//  TapInbox that `onOpenURL` and `onContinueUserActivity` feed, so LogView's cold-launch
//  ordering, the local write, POST /shifts/open, the takeover screen and every out-of-app
//  signal are the real ones.
//
//  SIGN-IN USED TO BE INJECTED HERE TOO, for Sign in with Apple (decision-22): a simulator
//  has no Apple ID, and signing one in needs a human, a password and a 2FA code. That hook
//  is GONE with decision-50 - Apple sign-in is retired from the app, and there is no
//  simulator-safe replacement wired up yet (POST /auth/code redeems a real, single-use,
//  admin-issued code; POST /auth/sms/request needs a live SMS provider). Recording a signed
//  -in demo therefore currently needs a device, or a hand-typed code in the Simulator UI
//  the way a worker would use it. See demo/record-ios.mjs and demo/demo-server.mjs, both
//  UNCHANGED by this run and both still passing the now-inert --ts-demo-signin /
//  --ts-demo-nonce flags below - repointing the demo pipeline at a minted enrolment code is
//  a follow-up, not part of the iOS sign-in rewrite.
//
//  NFC IS STILL MOCKED AND THE APP SAYS SO. There is no NFC radio in a simulator; that is
//  physics, not a shortcut. `demoBanner()` puts that sentence on screen for as long as the
//  hooks are armed, so a frame of the recording can never be mistaken for a real tap.
//
//  TWO CONDITIONS, BOTH REQUIRED (`isActive`): the launch argument has to be present AND
//  the API base has to be loopback. A DEBUG build pointed at a real host arms nothing.
//

#if DEBUG

import Foundation
import Observation
import SwiftUI

enum DemoHooks {
    /// Grep markers for the Release-build proof. Deliberately distinctive strings.
    static let marker = "TSDemoHooksArmed"

    static let armFlag = "--ts-demo"
    static let tapFlag = "--ts-demo-tap"

    private static let loopback: Set<String> = ["127.0.0.1", "localhost", "::1"]

    /// Armed only when BOTH hold. The host check is not decoration: it is the same rule
    /// demo/record-ios.mjs and demo/demo-server.mjs enforce, restated where it cannot be
    /// forgotten — a build that injects a tap must not be able to reach a real server
    /// with it.
    static var isActive: Bool {
        guard arguments.contains(armFlag) else { return false }
        guard let host = API.base.host(), loopback.contains(host) else { return false }
        return true
    }

    private static var arguments: [String] { ProcessInfo.processInfo.arguments }

    /// Value of `--flag value`, or nil.
    private static func value(_ flag: String) -> String? {
        let args = arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        let raw = args[i + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        return raw.isEmpty ? nil : raw
    }

    /// Called once from NFCTimeSheetsApp's launch task, AFTER session.restore().
    ///
    /// The tap is accepted last and unconditionally, which reproduces the cold-launch
    /// ordering TapInbox exists for: LogView has not mounted yet, so the id parks in the
    /// inbox and `.task` takes it when the Log tab appears (see TapInbox's header).
    @MainActor
    static func run(session: Session, inbox: TapInbox) async {
        guard isActive else { return }
        print("[\(marker)] loopback demo hooks armed for \(API.base.absoluteString)")

        // Same validation the URL path applies. A malformed id is dropped, exactly as a
        // rewritten tag would be.
        if let raw = value(tapFlag), let id = TagLink.normalizedUUID(raw) {
            inbox.accept(id)
        }
    }
}

/// The sentence that has to be in frame whenever these hooks are armed.
///
/// A `safeAreaInset` rather than an `overlay`: it moves the app down instead of covering
/// part of it, so nothing the recording is meant to show can hide behind it.
struct DemoBanner: ViewModifier {
    func body(content: Content) -> some View {
        if DemoHooks.isActive {
            content.safeAreaInset(edge: .top, spacing: 0) {
                Text("DEMO BUILD · local server · NFC is MOCKED — a simulator has no NFC radio")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.black)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(.yellow)
            }
        } else {
            content
        }
    }
}

extension View {
    func demoBanner() -> some View { modifier(DemoBanner()) }
}

#endif
