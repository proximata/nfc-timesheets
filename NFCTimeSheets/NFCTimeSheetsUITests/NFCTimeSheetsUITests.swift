//
//  NFCTimeSheetsUITests.swift
//  NFCTimeSheetsUITests
//
//  Created by qwadratic on 14.07.26.
//

import XCTest

final class NFCTimeSheetsUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
        // XCUIAutomation Documentation
        // https://developer.apple.com/documentation/xcuiautomation
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }

    // TASK-249: the new SignInView (phone+OTP, enrolment code, operator doors) had never
    // been rendered or tapped anywhere before this. TEMPORARY, throwaway verification --
    // not meant to stay in the suite long-term (no fixtures, hits real production for the
    // read-only unregistered-number probe, which is safe: an unregistered number never
    // triggers Twilio spend per decision-48 -- but reuses whatever real values are passed
    // in via -enrolmentCode / -operatorCode launch arguments for the paid/stateful probes,
    // which are skipped entirely when absent).
    @MainActor
    func testSignInScreenRenders() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["NFC TimeSheets"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Phone number"].exists, "phone field missing")
        XCTAssertTrue(app.buttons["Send code"].exists, "send code button missing")
        XCTAssertTrue(app.textFields["Access code"].exists, "access code field missing")
        XCTAssertTrue(app.buttons["Sign in with code"].exists, "sign in with code button missing")
        XCTAssertTrue(app.buttons["Write a tag"].exists, "operator write-a-tag link missing")
        XCTAssertTrue(app.buttons["Test a tag"].exists, "operator test-a-tag link missing")
        print("RENDER-OK: all sign-in doors present on first paint")
    }

    @MainActor
    func testUnregisteredPhoneShowsDistinctMessage() throws {
        let app = XCUIApplication()
        app.launch()

        let phoneField = app.textFields["Phone number"]
        XCTAssertTrue(phoneField.waitForExistence(timeout: 5))
        phoneField.tap()
        phoneField.typeText("06699999999")

        let sendButton = app.buttons["Send code"]
        XCTAssertTrue(sendButton.isEnabled)
        sendButton.tap()

        let expected = "This number isn't on file. Please contact your administration so it can be added."
        let errorText = app.staticTexts[expected]
        XCTAssertTrue(errorText.waitForExistence(timeout: 10), "expected unregistered-phone message never appeared")
        print("UNREGISTERED-PHONE-OK: \"\(expected)\"")
    }

    @MainActor
    func testWrongEnrolmentCodeShowsDistinctMessage() throws {
        let app = XCUIApplication()
        app.launch()

        let codeField = app.textFields["Access code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 5))
        codeField.tap()
        codeField.typeText("99999")

        let submit = app.buttons["Sign in with code"]
        XCTAssertTrue(submit.waitForExistence(timeout: 3))
        submit.tap()

        let expected = "Code not accepted. Ask your admin for a new one."
        let errorText = app.staticTexts[expected]
        XCTAssertTrue(errorText.waitForExistence(timeout: 10), "expected wrong-code message never appeared")
        print("WRONG-ENROLMENT-CODE-OK: \"\(expected)\"")
    }

    @MainActor
    func testOperatorWriteScreenGate() throws {
        let app = XCUIApplication()
        app.launch()

        app.buttons["Write a tag"].tap()
        // Exact strings over 128 chars can't be used as an XCUIElement subscript identifier
        // (XCTest limitation) -- match by substring instead.
        let gate = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Until a code is entered, this screen reads no card at all.")).firstMatch
        XCTAssertTrue(gate.waitForExistence(timeout: 5), "operator gate sentence missing on Write a tag")

        let codeField = app.textFields["Operator code"]
        XCTAssertTrue(codeField.exists)
        codeField.tap()
        codeField.typeText("not-a-real-code")
        XCTAssertEqual(codeField.value as? String, "not-a-real-code", "XCUITest typed text did not land in the field")
        print("OPERATOR-GATE-OK, FIELD-TYPING-OK")
    }
}
