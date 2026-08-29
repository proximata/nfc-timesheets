// Runnable check: SMS visibility is capabilities-gated, on BOTH iOS doors. No Xcode, no
// simulator.
//
//   cd NFCTimeSheets && swift checks/sms-gate-check.swift
//
// WHAT IT PINS (decision-59 §1-2). `sms_login` off means every SMS-shaped door disappears
// from the UI on every platform. iOS was the platform that did not comply: decision-50 §1
// said in words "No GET /auth/capabilities gate on iOS, unlike Android", so the phone field
// and the send button were composed unconditionally and answered 503 on tap while the flag
// was off. decision-59 STRIKES that clause; this file is what keeps it struck.
//
// RED CASE: delete `if smsAvailable {` from CodeSignInSection.swift, or pass a literal
// `true` at either call site, and this check fails. Both were tried before it went green.
//
// THE TWO CALL SITES MATTER SEPARATELY. The worker's door (ContentView.swift SignInView)
// and the operator's (OperatorHomeScreen.swift) mount the SAME form, so a guard inside the
// form is necessary but NOT sufficient: either caller could hand it a hardcoded true and
// only that one role's door would leak. This is the iOS twin of the assertions
// android/checks/core-check.kt §10b makes about TimeSheetApp.kt.
//
// WHY TEXT AND NOT BEHAVIOUR: these are SwiftUI views. They cannot be cat-ed into a
// top-level script the way TagLink or WriteGuard are, which is exactly why the two
// platforms' equivalent checks both read source. See operator-gate-check.swift's header.

import Foundation

var failed = false
func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        failed = true
    }
}

func source(_ path: String) -> String {
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
        FileHandle.standardError.write(Data("FAIL: \(path) is missing\n".utf8))
        failed = true
        return ""
    }
    return text
}

let form = source("NFCTimeSheets/CodeSignInSection.swift")
let signIn = source("NFCTimeSheets/ContentView.swift")
let home = source("NFCTimeSheets/OperatorHomeScreen.swift")
let api = source("NFCTimeSheets/API.swift")

// 1. THE WIRE CALL. Same route, same no-session posture as Android's Api.capabilities().
check(api.contains(#"try await apiGet("/auth/capabilities")"#),
      "AuthAPI asks GET /auth/capabilities — the one public capability read")
check(api.contains("static func smsDoorAvailable() async -> Bool")
        && api.contains("(try? await capabilities())?.sms ?? false"),
      "the read FAILS CLOSED: offline, a timeout or an old server must be read as false, "
      + "never as an open door (Android: runCatching{}.getOrDefault(false))")

// 2. THE GUARD, textually BEFORE the phone field — absent, not merely styled invisible.
//    Byte-for-byte the invariant core-check.kt asserts about the Compose form.
let guardIndex = form.range(of: "if smsAvailable {").map { form.distance(from: form.startIndex, to: $0.lowerBound) }
let phoneIndex = form.range(of: #"TextField("Phone number""#).map { form.distance(from: form.startIndex, to: $0.lowerBound) }
check(guardIndex != nil && phoneIndex != nil && guardIndex! < phoneIndex!,
      "the SMS half sits behind `if smsAvailable {`, guard textually BEFORE the phone field "
      + "— not hidden with .opacity/.hidden/.disabled, which would leave a reachable control")
check(form.contains("private var otpMode: Bool { smsAvailable && sentTo != nil }"),
      "otpMode ANDs the flag in, so a flag switched off mid-challenge falls back to the "
      + "enrolment code instead of stranding a 6-digit field whose verify can only 503")
check(form.contains("guard smsAvailable, !busy, !phone.isEmpty else { return }"),
      "requestOtp() refuses to knock on a door the server says is shut")

// 3. BOTH CALL SITES PASS THE REAL VALUE. A literal `true` here is the leak this catches.
for (screen, text, role) in [("ContentView.swift SignInView", signIn, "worker"),
                             ("OperatorHomeScreen.swift", home, "operator")] {
    check(text.contains("smsAvailable: smsAvailable"),
          "\(screen) passes the fetched flag to CodeSignInSection — the \(role) door must "
          + "not hardcode it")
    check(text.contains("@State private var smsAvailable = false"),
          "\(screen) starts false, so the first frame never flashes a door that is shut")
    check(text.contains("smsAvailable = await AuthAPI.smsDoorAvailable()"),
          "\(screen) reads the capability through the fail-closed helper")
    // Every appearance AND every resume, not once per process: this view is pushed and
    // popped, so a launch-only read would mean flipping the flag server-side changed
    // nothing until the app was force-quit.
    check(text.contains(".task { smsAvailable = await AuthAPI.smsDoorAvailable() }"),
          "\(screen) re-reads it on every appearance")
    check(text.contains("guard phase == .active else { return }"),
          "\(screen) re-reads it on resume too")
}

// 4. NOTHING WAS DELETED. The flag hides the SMS door; it must not have removed it. Every
//    string and every call has to come back when the flag comes back on.
for kept in [#"Text("A 6-digit code was sent to \(target).")"#,
             #"Button("Send code") { requestOtp() }"#,
             "try await verifySms(target, code)",
             #"Button("Use a different number")"#] {
    check(form.contains(kept), "the SMS half is HIDDEN, not deleted — still present: \(kept)")
}

if failed { exit(1) }
print("sms-gate-check: OK")
