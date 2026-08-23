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

import SwiftUI

struct VerifyZoneScreen: View {
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
        .navigationTitle("Test scan")
        .task { await load() }
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
