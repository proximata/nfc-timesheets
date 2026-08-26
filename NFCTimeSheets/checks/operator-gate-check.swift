// Runnable check: the operator gate reads the SESSION, not a flag. No Xcode, no simulator.
//
//   cd NFCTimeSheets && swift checks/operator-gate-check.swift
//
// THE REGRESSION IT REPRODUCES (TASK-276, decision-54 §4). OperatorSession derived its
// state from UserDefaults("operator.id") > 0, once, in init(). Nothing but signOut() ever
// wrote .signedOut, and signOut() had no caller in any view. So after the FIRST successful
// operator sign-in the gate was permanently signed-in on that install: a worker sign-out
// (Auth.swift deletes every cookie for API.base, ts_operator included), a revocation or the
// TTL left the two actions on screen behind a dead cookie, every call 401'd, and the inline
// code fields that used to rescue it were gone. No in-app recovery short of a reinstall.
//
// RED CASE: revert OperatorSession.refresh() to the old `cachedId > 0` init and this file
// fails on "the gate reads the ts_operator cookie" — the same assertion android/checks/
// core-check.kt already makes for Android ("the screen reads the operator session off
// disk"), which is why Android never had this bug and iOS did.
//
// WHY TEXT AND NOT BEHAVIOUR: OperatorSession is @MainActor @Observable SwiftUI-adjacent
// and HTTPCookieStorage is a process-wide singleton, so neither can be cat-ed into a
// top-level script the way TagLink or WriteGuard are. Reading the source is what android's
// core-check does for the same screen, for the same reason.

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

let session = source("NFCTimeSheets/OperatorSession.swift")
let home = source("NFCTimeSheets/OperatorHomeScreen.swift")
let api = source("NFCTimeSheets/OperatorAPI.swift")

// 1. The gate is the cookie.
check(session.contains(#"$0.name == "ts_operator""#) && session.contains("hasSessionCookie"),
      "the gate reads the ts_operator cookie out of HTTPCookieStorage, not a UserDefaults flag")
check(session.contains("guard hasSessionCookie else"),
      "refresh() refuses to report signed-in without the cookie")

// 2. It is re-read every time the gate appears, not once at launch.
check(home.contains(".onAppear { operatorSession.refresh() }"),
      "OperatorHomeScreen re-derives the gate on every appearance (a cookie can die while "
      + "the screen sits in the background)")

// 3. No network call decides what is on screen — a basement with no signal must still let
//    a signed-in operator through (decision-54 §4). refresh() is not async and awaits nothing.
check(session.contains("func refresh() {") && !session.contains("func refresh() async"),
      "refresh() is synchronous: no network call decides what the gate shows")

// 4. A 401 from an operator call reaches the operator's state, and ONLY the operator's.
check(api.contains(".operatorSessionRejected"),
      "an operator 401 posts .operatorSessionRejected so the state can drop to signed-out")
check(!api.contains("post(name: .sessionRejected"),
      "an operator 401 NEVER posts the worker's .sessionRejected: a tag write must not sign "
      + "a cleaner out of a running shift (decision-49 §4)")
check(session.contains("forName: .operatorSessionRejected"),
      "OperatorSession observes that 401 itself")

if failed { exit(1) }
print("operator-gate-check: OK")
