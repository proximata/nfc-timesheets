//
//  WriteTagRestartUITests.swift
//  NFCTimeSheetsUITests
//
//  TWO CARDS IN ONE SESSION, DRIVEN THROUGH THE REAL VIEW HIERARCHY. checks/
//  write-tag-step-check.swift already walks the step machine on a laptop and now also reads
//  the view's source for the button that leaves each panel — but source-level reasoning is
//  exactly what shipped the dead end this file exists to catch, so this is the proof that
//  taps a control a thumb can reach and fails if it is not there.
//
//  WHAT WENT WRONG. The three panels became a `switch` over one derived step (correct), and
//  the two Write buttons live on the `.plan` and `.result` panels. So once card 1's report
//  landed, the screen was `.zone` and ONLY `.zone` — and no control on it started a new
//  write. The operator's only escape was popping the navigation stack, which nothing on
//  screen says. It went green through review because the DEBUG Simulate section renders
//  OUTSIDE the switch: on a debug build there is always a way back, so a mock walk-through
//  looks fine while a Release build is stuck.
//
//  THE ONE DEBUG TAP, AND WHY IT IS THE FIXTURE AND NOT THE SUBJECT. `.zone` is only
//  reachable after a card is physically written and the id reported. A simulator has no NFC
//  radio — that is physics, not a shortcut (see DemoHooks.swift's header) — so card 1 is
//  started with the Simulate button, which arms OperatorMocks and then lets the SHIPPING
//  state machine run. Everything the test ASSERTS, and every tap after that first one, uses
//  controls that exist in a Release build:
//
//      card 1 (fixture) → .zone → tap "Write another card" → .plan
//                       → tap the REAL "Write" → card 2 → .zone again
//
//  Card 2 is driven by the screen's own Write button. If "Write another card" is missing,
//  the test hangs on the wait and fails there — which is precisely what it does against the
//  pre-fix source, and the evidence for that is recorded in TASK-309.
//
//  RUNNING IT. Reaching the screen at all needs an operator session, and that session is a
//  `ts_operator` cookie the server hands out — so a two-route stub stands in for the API.
//  No database, no server/ code, nothing that can open a shift:
//
//      node NFCTimeSheets/checks/write-tag-uitest-stub.mjs --port 8082
//      node demo/tls-front.mjs --cert /tmp/ts-demo/tls --port 8444 --upstream 127.0.0.1:8082
//      xcrun simctl keychain booted add-root-cert /tmp/ts-demo/tls/ca.pem
//
//      xcodebuild test -project NFCTimeSheets/NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
//        -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
//        TS_API_HOST=127.0.0.1:8444 TS_TAG_HOST=127.0.0.1:8444 CODE_SIGNING_ALLOWED=NO \
//        -only-testing:NFCTimeSheetsUITests/WriteTagRestartUITests
//
//  NOT RUN BY checks/run.sh, same as SmsDoorVisibilityUITests: that script is Xcode-free
//  and simulator-free on purpose. This is a hand-run proof.
//

import XCTest

final class WriteTagRestartUITests: XCTestCase {
    private let timeout: TimeInterval = 20

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOperatorCanStartASecondCardFromTheZoneStep() throws {
        let app = XCUIApplication()
        app.launch()

        openWriteTagScreen(app)

        // --- card 1: the fixture. The radio is mocked; the state machine is not. ---------
        let simulate = app.buttons["Mock: write, then skip the building"]
        XCTAssertTrue(simulate.waitForExistence(timeout: timeout),
                      "the debug Simulate control is present (this test must be run on a DEBUG "
                      + "build — a simulator has no NFC radio to write card 1 with)")
        simulate.tap()
        assertOnZoneStep(app, card: "card 1")

        // --- THE REGRESSION. A Release-reachable way off the last panel. -----------------
        let again = app.buttons["Write another card"]
        XCTAssertTrue(again.waitForExistence(timeout: timeout),
                      "THE BUG: card 1 is done and the zone step is the whole screen. A "
                      + "control an operator can actually tap must start the next card. "
                      + "Without it the only escape is popping the navigation stack, which "
                      + "nothing on screen says. NOT the debug Simulate button — that one "
                      + "does not exist in a Release build.")
        again.tap()

        // --- card 2, started by the SHIPPING Write button on the plan panel. -------------
        let planFootnote = app.staticTexts.containing(
            NSPredicate(format: "label BEGINSWITH %@", "This never opens a shift")).firstMatch
        XCTAssertTrue(planFootnote.waitForExistence(timeout: timeout),
                      "one tap lands back on the mint plan, which is where the next card's id "
                      + "and URI are shown before the NFC sheet opens")

        let write = app.buttons["Write"]
        XCTAssertTrue(write.waitForExistence(timeout: timeout),
                      "the plan panel's own Write button is up for card 2")
        write.tap()

        assertOnZoneStep(app, card: "card 2")
        XCTAssertTrue(app.buttons["Write another card"].waitForExistence(timeout: timeout),
                      "and card 2's zone step is not a dead end either — 'reset once' is not "
                      + "the same as 'reset every time'")

        print("=== two-card walk finished, final hierarchy ===")
        print(app.debugDescription)
    }

    /// Through the gate (decision-54 §4): the operator interface is unreachable without a
    /// `ts_operator` cookie, so this signs in for real against the stub. Any code is
    /// accepted there; the credential is not what this file is testing.
    private func openWriteTagScreen(_ app: XCUIApplication) {
        let gate = app.buttons["Write or test tags"]
        XCTAssertTrue(gate.waitForExistence(timeout: timeout),
                      "the operator gate link is on the sign-in screen")
        gate.tap()

        let code = app.textFields["Access code"]
        XCTAssertTrue(code.waitForExistence(timeout: timeout),
                      "the operator gate is showing the enrolment-code form (is the stub "
                      + "server up, and was the app built with TS_API_HOST pointed at it?)")
        code.tap()
        // 5 digits (decision-63), or `submittable` is false and the button never fires.
        // The stub accepts any code; the SHAPE still has to be real.
        code.typeText("73142")
        app.buttons["Sign in with code"].tap()

        let writeTag = app.buttons["Write a tag"]
        XCTAssertTrue(writeTag.waitForExistence(timeout: timeout),
                      "signed in as an operator, so the two actions are on screen")
        writeTag.tap()

        XCTAssertTrue(app.navigationBars["Write a tag"].waitForExistence(timeout: timeout),
                      "the Write a tag screen is pushed")
    }

    /// The zone step, identified by the control only IT draws. `Create zone` appears once
    /// the report has landed and the building list has settled, so waiting on it is also
    /// waiting for the whole mint → write → report → zone sequence to finish.
    private func assertOnZoneStep(_ app: XCUIApplication, card: String) {
        XCTAssertTrue(app.buttons["Create zone"].waitForExistence(timeout: timeout),
                      "\(card): the report landed and the screen is on the zone step")
    }
}
