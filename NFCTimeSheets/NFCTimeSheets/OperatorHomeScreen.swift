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
//  NO NETWORK CALL DECIDES WHAT IS ON SCREEN. `OperatorSession.refresh()` reads the
//  ts_operator cookie URLSession already holds on disk, so an operator who signed in
//  yesterday walks into a basement today and gets the two actions with no signal and
//  nothing to fail. Whether the cookie is still GOOD is the server's answer to the first
//  real call, not a gate at the door.
//
//  EVERY APPEARANCE, not once at launch (TASK-276). The cookie can go away underneath
//  this screen - a worker sign-out clears every cookie for API.base, a 401 elsewhere
//  drops the session - and a gate answered once at process start never notices.
//

import SwiftUI

struct OperatorHomeScreen: View {
    @Environment(OperatorSession.self) private var operatorSession
    @Environment(\.scenePhase) private var scenePhase
    /// The SMS half of the sign-in form, gated on GET /auth/capabilities (decision-59 §2).
    /// False until the server says otherwise, and re-read on every appearance and resume -
    /// see the note on the modifiers below, and SignInView, which does the identical thing
    /// for the worker door. The operator's SMS routes are gated by the SAME `sms_login`
    /// flag server-side, so one capability read is the honest answer for both roles.
    @State private var smsAvailable = false

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
                                  smsAvailable: smsAvailable,
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
        .onAppear { operatorSession.refresh() }
        // The capability is asked the same way and on the same schedule as the cookie above
        // it: every appearance, plus every return to foreground, so turning `sms_login` off
        // (or back on) takes effect on the next look at this screen rather than on the next
        // cold launch. Unlike the cookie read this one IS a network call - and nothing on
        // screen waits for it, because it can only ever REMOVE a control.
        .task { smsAvailable = await AuthAPI.smsDoorAvailable() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { smsAvailable = await AuthAPI.smsDoorAvailable() }
        }
    }
}
