//
//  OperatorHomeScreen.swift
//  NFCTimeSheets
//
//  THE GATE (decision-54 §4). One entry point for the operator interface: the shared
//  sign-in form while there is no operator session, the two actions once there is.
//
//  This deliberately REVERSES the design that shipped before it, where the sign-in screen
//  carried "Write a tag" and "Test a tag" as two direct links and each of those screens
//  gated the ACTION behind its own inline code field. That reasoning was correct for its
//  own requirement ("don't gate reaching the screen, gate the action") and is superseded
//  by an explicit one ("don't reveal the screen at all"). So the retired
//  OperatorSignInScreen.swift is back, in substance, under a new name and using the SAME
//  form the worker's door uses.
//
//  NO NETWORK CALL DECIDES WHAT IS ON SCREEN. `OperatorSession` reads its cached identity
//  out of UserDefaults at init, beside the ts_operator cookie URLSession already holds, so
//  an operator who signed in yesterday walks into a basement today and gets the two
//  actions with no signal and nothing to fail. Whether the cookie is still good is the
//  server's answer to the FIRST real call, not a gate at the door.
//

import SwiftUI

struct OperatorHomeScreen: View {
    @Environment(OperatorSession.self) private var operatorSession

    var body: some View {
        Form {
            switch operatorSession.state {
            case .unknown:
                Section { ProgressView() }
            case .signedOut(let reason):
                Section {
                    Text("Sign in as an operator to write and test tags. This never opens a shift.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let reason {
                        Text(reason)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                CodeSignInSection(role: .tagOperator,
                                  busy: operatorSession.busy,
                                  requestSms: { try await operatorSession.requestSmsCode(phone: $0) },
                                  verifySms: { try await operatorSession.verifySmsCode(phone: $0, code: $1) },
                                  submitCode: { try await operatorSession.signIn(code: $0) })
            case .signedIn:
                Section {
                    NavigationLink("Write a tag") { WriteTagScreen() }
                    NavigationLink("Test a tag") { VerifyZoneScreen() }
                } footer: {
                    Text("For staff who mount and test NFC tags. This never opens a shift.")
                        .font(.footnote)
                }
            }
        }
        .navigationTitle("Operator")
        .scrollDismissesKeyboard(.interactively)
    }
}
