//
//  OperatorSignInScreen.swift
//  NFCTimeSheets
//
//  Reachable from Settings (ContentView.swift), for the same reason SettingsView itself
//  has no picker any more: "who is allowed to write tags" is not decided by tapping
//  around this screen, it is decided by whether the code an admin issued still redeems.
//  This screen only ever shows two things — a code field, or a name and a sign-out
//  button — because decision-45 ships exactly those two operations and nothing between
//  them.
//
//  A worker's phone may hold BOTH a worker session and an operator session at once (the
//  owner-cleans-a-building case, decision-45 §3), so this screen is additive to Settings
//  rather than a replacement for the sign-in flow above it, and touches nothing on the
//  worker's side of OperatorSession.swift's header.
//

import SwiftUI

struct OperatorSignInScreen: View {
    @Environment(OperatorSession.self) private var operatorSession
    @State private var code = ""

    var body: some View {
        Form {
            switch operatorSession.state {
            case .unknown:
                ProgressView()
            case .signedOut(let reason):
                signedOutContent(reason: reason)
            case .signedIn(let op):
                signedInContent(op)
            }
        }
        .navigationTitle("Operator sign-in")
    }

    @ViewBuilder
    private func signedOutContent(reason: String?) -> some View {
        Section {
            Text("For staff who mount and test NFC tags. This never opens a shift.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        Section("Operator code") {
            TextField("Operator code", text: $code)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .accessibilityLabel("Operator code")
            if let reason {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            Button("Sign in") {
                Task {
                    await operatorSession.signIn(code: code)
                    if operatorSession.operatorInfo != nil { code = "" }
                }
            }
            .disabled(operatorSession.busy || EnrolmentCode.normalise(code) == nil)
        }
    }

    @ViewBuilder
    private func signedInContent(_ op: WireOperator) -> some View {
        Section("Signed in as") {
            LabeledContent("Name", value: op.name)
                .accessibilityLabel("Signed in as \(op.name)")
        }
        // decision-49 / decision-47: reachable only once signed in as an operator, and
        // additive to sign-in the same way sign-in is additive to Settings.
        Section {
            NavigationLink("Write a tag") { WriteTagScreen() }
            NavigationLink("Test scan") { VerifyZoneScreen() }
        }
        Section {
            Button("Sign out", role: .destructive) {
                Task { await operatorSession.signOut() }
            }
            .disabled(operatorSession.busy)
        } footer: {
            Text("Signing out does not affect your worker sign-in above.")
                .font(.footnote)
        }
    }
}
