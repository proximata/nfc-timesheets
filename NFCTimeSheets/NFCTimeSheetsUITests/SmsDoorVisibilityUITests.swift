//
//  SmsDoorVisibilityUITests.swift
//  NFCTimeSheetsUITests
//
//  decision-59 §1-2, PROVEN AGAINST THE REAL VIEW HIERARCHY rather than against the source.
//  checks/sms-gate-check.swift already pins that the guard is written; this pins that the
//  guard WORKS — that a phone talking to a server whose `sms_login` flag is off draws no
//  phone field, no send button and no OTP field, on BOTH doors.
//
//  IT NEEDS A SERVER, and it deliberately does not stub one. The value under test is the
//  round trip: GET /auth/capabilities → `smsAvailable` → what SwiftUI composes. A test that
//  injected the boolean would prove the `if` compiles and nothing about the wire.
//
//      # 1. a local API on a demo database, with Twilio SHAPE-configured so the FLAG is the
//      #    only variable (server/lib/sms.js: capabilities = smsConfigured() AND sms_login)
//      DATABASE_URL=postgres:///nfc_demo APP_KEY=<the key in API.swift> PORT=8082 \
//        TWILIO_ACCOUNT_SID=AC0…0 TWILIO_SID=SK0…0 TWILIO_SECRET=0…0 \
//        TWILIO_FROM=+43600000000 TWILIO_API_BASE=http://127.0.0.1:9 \
//        node demo/demo-server.mjs
//      node demo/tls-front.mjs --port 8444          # https :8444 -> http :8082
//      xcrun simctl keychain booted add-root-cert /tmp/ts-demo/tls/ca.pem
//
//      # 2. the flag, either way round
//      psql -d nfc_demo -c "UPDATE feature_flags SET enabled=false WHERE name='sms_login'"
//
//      # 3. the app must be built to TALK to it, or this tests the production server
//      xcodebuild test -project NFCTimeSheets/NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
//        -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
//        TS_API_HOST=127.0.0.1:8444 TS_TAG_HOST=127.0.0.1:8444 CODE_SIGNING_ALLOWED=NO \
//        -only-testing:NFCTimeSheetsUITests/SmsDoorVisibilityUITests
//
//  EXPECTATION COMES FROM THE ENVIRONMENT, not from a hardcoded false: set the flag ON and
//  pass `TEST_RUNNER_TS_EXPECT_SMS=1` and the SAME assertions run inverted, so one file
//  proves the door disappears AND that it comes back. A gate that can only be shown to hide
//  things is half a gate — decision-59's whole risk is that SMS never returns when the flag
//  is switched back on.
//
//  The `TEST_RUNNER_` prefix is not decoration: the runner is a separate process on the
//  simulator and does NOT inherit the shell's environment. xcodebuild forwards variables
//  with that prefix to it, stripping the prefix on the way, so both spellings are read
//  below rather than betting on which one survives a given Xcode version.
//
//  NOT RUN BY checks/run.sh: that script is Xcode-free and simulator-free on purpose. This
//  needs both, plus a database. It is a hand-run proof, and the run that produced its
//  evidence is recorded in the task.
//

import XCTest

final class SmsDoorVisibilityUITests: XCTestCase {
    /// Set TS_EXPECT_SMS=1 in the test runner's environment when the flag is ON.
    private var expectSms: Bool {
        let env = ProcessInfo.processInfo.environment
        return env["TS_EXPECT_SMS"] == "1" || env["TEST_RUNNER_TS_EXPECT_SMS"] == "1"
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Every control that IS the SMS door. If any of these is on screen with the flag off,
    /// a worker can reach a route that answers 503 — the exact broken control decision-59
    /// exists to delete.
    private func assertSmsHalf(_ scope: XCUIElement, door: String, app: XCUIApplication) {
        let phone = scope.textFields["Phone number"]
        let send = scope.buttons["Send code"]

        if expectSms {
            XCTAssertTrue(phone.waitForExistence(timeout: 10),
                          "\(door): flag ON — the phone field must be composed")
            XCTAssertTrue(send.exists, "\(door): flag ON — the send button must be composed")
        } else {
            // A short settle first: the capability read is async, and asserting absence
            // immediately would pass for the wrong reason (nothing has rendered yet).
            XCTAssertTrue(scope.buttons["Sign in with code"].waitForExistence(timeout: 10)
                            || scope.buttons["Confirm"].waitForExistence(timeout: 2),
                          "\(door): the form itself must be on screen before absence means anything")
            XCTAssertFalse(phone.exists, "\(door): flag OFF — NO phone field may be composed")
            XCTAssertFalse(send.exists, "\(door): flag OFF — NO send button may be composed")
        }

        // THE ENROLMENT DOOR IS UNTOUCHED EITHER WAY (decision-59 §1: the code field is not
        // an SMS-shaped door). This is the half that must survive the flag, or the app has
        // no door at all while the flag is off.
        XCTAssertTrue(scope.textFields["Access code"].exists || scope.textFields["SMS code"].exists,
                      "\(door): the code field is always composed")

        // The hierarchy itself, in the log, so a human reading the CI output can see what
        // was on screen rather than trusting a green tick.
        print("=== \(door) hierarchy (TS_EXPECT_SMS=\(expectSms ? "1" : "0")) ===")
        print(app.debugDescription)
    }

    /// The WORKER door: SignInView, the first screen a phone with no session shows.
    func testWorkerSignInSmsVisibility() throws {
        let app = XCUIApplication()
        app.launch()
        assertSmsHalf(app, door: "worker SignInView", app: app)
    }

    /// The OPERATOR door: the same shared form, mounted behind the gate on
    /// OperatorHomeScreen. A separate test because a guard that is right on one call site
    /// and hardcoded on the other is exactly the bug this pair is here to catch.
    func testOperatorSignInSmsVisibility() throws {
        let app = XCUIApplication()
        app.launch()

        let gate = app.buttons["Write or test tags"]
        XCTAssertTrue(gate.waitForExistence(timeout: 10), "the operator gate link is on the sign-in screen")
        gate.tap()

        XCTAssertTrue(app.staticTexts["Operator sign-in"].waitForExistence(timeout: 10)
                        || app.navigationBars["Operator"].waitForExistence(timeout: 5),
                      "the operator gate is showing its sign-in form")
        assertSmsHalf(app, door: "OperatorHomeScreen", app: app)
    }
}
