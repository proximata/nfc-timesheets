//
//  CodeSignInSection.swift
//  NFCTimeSheets
//
//  ONE code-entry form, for every login this app has (decision-54 §5). Before this there
//  were three visibly different ones: the worker's SMS section, the worker's enrolment-code
//  section, and the operator's bespoke inline field on WriteTagScreen/VerifyZoneScreen.
//  They are still THREE credentials with three different security arguments on the server
//  (lib/sms.js's arithmetic, lib/enrolment.js's 40-bit secret, and the `enrolop:`/`smsotpop:`
//  buckets that keep the two roles' lockouts apart) - what is unified here is the FORM, not
//  the wire shape.
//
//  THE ONE FIELD ACCEPTS EITHER SHAPE WITHOUT ASKING WHICH, and `sentTo` is the whole
//  switch: while an SMS challenge is live it is a 6-digit OTP field with
//  .textContentType(.oneTimeCode) so iOS offers the code straight off the lock screen
//  (decision-54 §6); otherwise it is the 8-character Crockford-base32 enrolment code, where
//  .oneTimeCode would be a lie - nothing ever sent that string in an SMS - and would suppress
//  the paste/autocapitalisation behaviour an admin-issued code actually needs.
//
//  The ROLE parameter changes two things and nothing else: which three calls are made, and
//  which copy a failure maps to. It is deliberately NOT a session type - this view owns no
//  identity, holds no cookie, and cannot tell whether either call succeeded except by the
//  caller's screen changing underneath it.
//

import SwiftUI

struct CodeSignInSection: View {
    enum Role {
        /// /auth/sms/request+verify and /auth/code, via Auth.swift's Session.
        case worker
        /// /auth/operator-sms/request+verify and /auth/operator-code, via OperatorSession.
        /// Not spelled `operator` - that is a Swift keyword and the backticks would spread
        /// to every call site.
        case tagOperator
    }

    let role: Role
    /// A call is in flight. The caller's own session object owns this - this view never
    /// derives it, so two forms on one screen could never disagree about it.
    let busy: Bool
    let requestSms: (String) async throws -> Void
    let verifySms: (String, String) async throws -> Void
    let submitCode: (String) async throws -> Void

    // `sentTo` mirrors Android's rememberSaveable shape: non-nil only once a request has
    // been ACCEPTED for this exact string, and the ONLY way back to phone entry is the
    // "Use a different number" button - so the code field can never sit next to a number
    // nothing was sent to.
    @State private var phone = ""
    @State private var sentTo: String?
    @State private var code = ""
    @State private var phoneErrorMessage: String?
    @State private var codeErrorMessage: String?

    /// SMS mode. The single source for every per-field difference below - keyboard,
    /// content type, filtering, button copy and which call the submit button makes.
    private var otpMode: Bool { sentTo != nil }

    var body: some View {
        Section {
            if let target = sentTo {
                Text("A 6-digit code was sent to \(target).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                TextField("Phone number", text: $phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .onChange(of: phone) { _, _ in phoneErrorMessage = nil }
                    .accessibilityLabel("Phone number")
                if let phoneErrorMessage {
                    Text(phoneErrorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                } else {
                    Text("Start with 0 or +43, for example 0664 1234567.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("Send code") { requestOtp() }
                    .disabled(busy || phone.isEmpty)
            }

            TextField(otpMode ? "SMS code" : "Access code", text: $code)
                .keyboardType(otpMode ? .numberPad : .default)
                // nil, not .oneTimeCode, outside SMS mode - see the header.
                .textContentType(otpMode ? UITextContentType.oneTimeCode : nil)
                .textInputAutocapitalization(otpMode ? .never : .characters)
                .autocorrectionDisabled()
                .onChange(of: code) { _, new in
                    // Digits only, capped at 6 - an OTP has no alphabet to alias, so there
                    // is nothing here for an EnrolmentCode-style normaliser to do. The
                    // enrolment code is left exactly as typed and normalised on submit,
                    // because normalising under the cursor eats the hyphen people type.
                    if otpMode { code = String(new.filter(\.isNumber).prefix(6)) }
                    codeErrorMessage = nil
                }
                .accessibilityLabel(otpMode ? "SMS code" : "Access code")
            if let codeErrorMessage {
                Text(codeErrorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            } else if !otpMode {
                Text("The one-time code your administration gave you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button(otpMode ? "Confirm" : "Sign in with code") { submit() }
                .disabled(busy || !submittable)

            if otpMode {
                Button("Use a different number") {
                    sentTo = nil
                    code = ""
                    codeErrorMessage = nil
                }
                .disabled(busy)
            }
        } header: {
            Text(role == .worker ? "Sign in" : "Operator sign-in")
        }
    }

    private var submittable: Bool {
        otpMode ? code.count == 6 : EnrolmentCode.normalise(code) != nil
    }

    // MARK: Actions

    private func requestOtp() {
        guard !busy, !phone.isEmpty else { return }
        let requested = phone
        Task {
            do {
                try await requestSms(requested)
                sentTo = requested
                phoneErrorMessage = nil
                code = ""
                codeErrorMessage = nil
            } catch let failure as APIFailure {
                phoneErrorMessage = Self.phoneRequestMessage(for: failure)
            } catch {
                phoneErrorMessage = APIFailure(status: 0, code: "network").workerMessage
            }
        }
    }

    private func submit() {
        guard !busy, submittable else { return }
        Task {
            do {
                if let target = sentTo {
                    try await verifySms(target, code)
                } else {
                    try await submitCode(EnrolmentCode.normalise(code)!)
                }
                // Success moves the whole SCREEN - to .eligible, or past the operator
                // gate - so there is nothing left to reset here.
            } catch let failure as APIFailure {
                codeErrorMessage = otpMode
                    ? Self.otpVerifyMessage(for: failure)
                    : Self.codeMessage(for: failure, role: role)
            } catch {
                codeErrorMessage = APIFailure(status: 0, code: "network").workerMessage
            }
        }
    }

    // MARK: Error copy
    //
    // Distinct per outcome and per field (decision-50 §1): the SAME server code means a
    // different next action depending on which field is on screen, so none of these go
    // through APIFailure.workerMessage's generic switch - that one is shift-sync copy.
    // Consolidating the LAYOUT (decision-54 §5) does not consolidate these; every mapping
    // that existed before this file still exists, word for word.

    private static func phoneRequestMessage(for failure: APIFailure) -> String {
        switch failure.code {
        case "unknown_phone":
            // decision-51: the number is well-formed but not on file. Never the same
            // sentence as an invalid code - nobody re-issues this, the admin adds the number.
            return String(localized: "This number isn't on file. Please contact your administration so it can be added.")
        case "invalid_phone":
            return String(localized: "That phone number doesn't look right.")
        case "too_many_attempts":
            return String(localized: "Too many attempts - try again in a few minutes.")
        case "sms_not_configured":
            return String(localized: "SMS sign-in isn't set up on this server. Please use the access code below.")
        default:
            return failure.workerMessage
        }
    }

    private static func otpVerifyMessage(for failure: APIFailure) -> String {
        switch failure.code {
        case "invalid_code":
            // NEVER the enrolment field's "ask your admin for a new one" - an OTP is
            // re-requested by the WORKER, not reissued by an admin.
            return String(localized: "That code is wrong or has expired.")
        case "too_many_attempts":
            return String(localized: "Too many attempts - try again in a few minutes.")
        case "sms_not_configured":
            return String(localized: "SMS sign-in isn't set up on this server. Please use the access code below.")
        default:
            return failure.workerMessage
        }
    }

    /// The enrolment code, and the ONE place the two roles genuinely differ in copy.
    /// decision-45: for an operator, unknown / expired / already redeemed / revoked must
    /// stay indistinguishable, or the message becomes an oracle over a live code - so the
    /// worker's "ask your admin for a new one" (which names a cause) is not reused there.
    private static func codeMessage(for failure: APIFailure, role: Role) -> String {
        switch (failure.code, role) {
        case ("network", .tagOperator):
            // Kept apart from the one-message rule on purpose: "no signal" is not a
            // statement about the code, so it discloses nothing and telling an operator
            // standing in a stairwell to re-check a correct code is the worse answer.
            return String(localized: "No connection - try again.")
        case ("too_many_attempts", .tagOperator):
            return String(localized: "Too many attempts - try again shortly.")
        case ("too_many_attempts", .worker):
            return String(localized: "Too many attempts - try again in a few minutes.")
        case (_, .tagOperator):
            return String(localized: "Code not accepted. Check it and try again.")
        case ("invalid_code", .worker):
            return String(localized: "Code not accepted. Ask your admin for a new one.")
        default:
            return failure.workerMessage
        }
    }
}
