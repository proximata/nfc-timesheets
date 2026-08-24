//
//  VerifyZoneScreen.swift
//  NFCTimeSheets
//
//  THE TEST SCAN (decision-47): pick a zone FIRST, scan SECOND. Mirrors
//  android/.../nfc/VerifyZoneActivity.kt's shape. `POST /operator/zones/:id/verify`'s
//  equality check only means anything if the operator committed to which zone they were
//  testing before they knew what the card would say - "stamp whatever was scanned" would
//  happily bless a card mounted on the wrong door.
//
//  READ-ONLY WITH RESPECT TO SHIFTS, STRUCTURALLY: every call here goes out over
//  OperatorTagAPI, which carries ts_operator, and no route that touches a shift accepts it.
//
//  Reachable directly from the sign-in screen (TASK-252's iOS half - full parity with
//  android/.../nfc/VerifyZoneActivity.kt, gated the same way: `onResume` refuses to load
//  zones or scan at all while `!operatorReady`). The gate lives HERE, not only at the
//  navigation link, for the same reason WriteTagScreen.swift's does - a link on the
//  sign-in screen is reachable before anyone has proven they are an operator.
//

import SwiftUI

struct VerifyZoneScreen: View {
    @Environment(OperatorSession.self) private var operatorSession
    @State private var operatorCode = ""
    @State private var zones: [WireOperatorZone] = []
    @State private var loading = false
    @State private var loadError = false
    @State private var selected: WireOperatorZone?
    @State private var checking = false
    @State private var outcome: TagReaderProbe.Outcome?
    @State private var verifyResult: WireZoneVerifyResult?
    @State private var probe = TagReaderProbe()
    @State private var lastFailureCode: String?

    var body: some View {
        Form {
            switch operatorSession.state {
            case .unknown:
                Section { ProgressView() }
            case .signedOut(let reason):
                operatorSignInSection(reason: reason)
            case .signedIn:
                verifySections
            }
        }
        .navigationTitle("Test a tag")
        // Loading zones is an operator action (OperatorTagAPI carries ts_operator) - firing
        // it while signed out would just 401. `.task(id:)` re-runs the moment sign-in
        // flips the environment value, so the picker fills in without a manual refresh.
        .task(id: isSignedIn) { if isSignedIn { await load() } }
    }

    private var isSignedIn: Bool {
        if case .signedIn = operatorSession.state { return true }
        return false
    }

    @ViewBuilder
    private func operatorSignInSection(reason: String?) -> some View {
        Section {
            Text("This phone is not signed in as an operator. Only operators can test a tag.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        Section("Operator code") {
            TextField("Operator code", text: $operatorCode)
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
                    await operatorSession.signIn(code: operatorCode)
                    if operatorSession.operatorInfo != nil { operatorCode = "" }
                }
            }
            .disabled(operatorSession.busy || EnrolmentCode.normalise(operatorCode) == nil)
        }
    }

    @ViewBuilder
    private var verifySections: some View {
        Group {
            Section {
                Text("Proves a card resolves to this zone before a cleaner can clock in on it. This never opens a shift.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let selected {
                selectedZoneSection(selected)
            } else {
                pickerSection
            }
        }
    }

    @ViewBuilder
    private var pickerSection: some View {
        Section("Pick the zone you're testing") {
            if loading && zones.isEmpty {
                Text("Loading zones…")
            }
            if loadError {
                Text("Couldn't load zones. Showing the last saved list.")
                    .foregroundStyle(.red)
            }
            if !loading && zones.isEmpty && !loadError {
                Text("No zones need a test scan right now.")
            }
            ForEach(zones) { zone in
                Button {
                    selected = zone
                    outcome = nil
                    verifyResult = nil
                } label: {
                    VStack(alignment: .leading) {
                        Text("\(zone.locationName) · \(zone.name)")
                        Text(zone.isVerified
                             ? String(localized: "Verified \(zone.verifiedAt.map(formatted) ?? "")")
                             : String(localized: "Not verified yet"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func selectedZoneSection(_ zone: WireOperatorZone) -> some View {
        Section {
            Text("\(zone.name) at \(zone.locationName)")
                .font(.headline)
            Text(statusText)
                .accessibilityLabel(statusText)
            Button("Scan the card") { Task { await scan(zone) } }
                .disabled(checking)
            Button("Choose a different zone") {
                self.selected = nil
                outcome = nil
                verifyResult = nil
            }
        }
    }

    private func load() async {
        zones = OperatorZoneCache.read()
        loading = true
        do {
            let fresh = try await OperatorTagAPI.zones()
            OperatorZoneCache.write(fresh)
            zones = fresh
            loadError = false
        } catch {
            loadError = true
        }
        loading = false
    }

    private func scan(_ zone: WireOperatorZone) async {
        checking = true
        outcome = nil
        verifyResult = nil
        lastFailureCode = nil
        let result = await probe.scan(zones: zones)
        outcome = result
        if case .resolved(let placeId) = result {
            do {
                verifyResult = try await OperatorTagAPI.verifyZone(zoneId: zone.id, placeUuid: placeId)
            } catch let failure as APIFailure {
                verifyResult = nil
                lastFailureCode = failure.code
            } catch {
                verifyResult = nil
                lastFailureCode = "network"
            }
        }
        checking = false
    }

    private var statusText: String {
        if checking { return String(localized: "Checking…") }
        if let verifyResult {
            if verifyResult.alreadyVerified {
                return String(localized: "Already verified \(formatted(verifyResult.verifiedAt)).")
            }
            return String(localized: "Verified. This door is now a clock-in target.")
        }
        if let code = lastFailureCode {
            switch code {
            case "zone_mismatch": return String(localized: "This card belongs to a different zone.")
            case "tag_unbound": return String(localized: "This card was reported but nobody has claimed it yet. Ask an admin.")
            case "unknown_location": return String(localized: "This card isn't one of ours.")
            case "unknown_zone": return String(localized: "This zone isn't active any more.")
            case "network": return String(localized: "No connection - try again.")
            default: return String(localized: "Server trouble - try again.")
            }
        }
        switch outcome {
        case .unreadable:
            return String(localized: "Couldn't read a link or a known tag off this card.")
        case .unavailable(let message):
            return message
        case .lost(let reason):
            return String(localized: "Lost the connection (\(reason)). Try again.")
        case .resolved, nil:
            return String(localized: "Hold your phone near the card.")
        }
    }

    private func formatted(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}
