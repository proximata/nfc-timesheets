//
//  WriteTagScreen.swift
//  NFCTimeSheets
//
//  Reachable ONLY through OperatorHomeScreen (decision-54 §4). Mints an id, presents the
//  system NFC sheet, shows exactly one Outcome, then reports it - and the report is SOFT,
//  never downgrading a verified write (decision-49). NOTHING here opens or closes a shift:
//  OperatorTagAPI carries the ts_operator cookie, which no shift route accepts (decision-45).
//
//  THE CODE FIELD THAT USED TO LIVE HERE IS GONE, and that is not a loosening: the gate
//  moved UPSTREAM of the navigation link, so this screen is unreachable without an operator
//  session instead of merely refusing to act without one. What is left is the DEFENSIVE
//  half - a session that dies while this screen is open pops back to the gate rather than
//  growing a second code-entry UI here, which is exactly the duplication decision-54 §5
//  set out to delete.
//

import SwiftUI

struct WriteTagScreen: View {
    @Environment(OperatorSession.self) private var operatorSession
    @Environment(\.dismiss) private var dismiss
    @State private var pendingId = UUID().uuidString.lowercased()
    // The actual bytes this build would write, computed the SAME way TagWriter.plan() does
    // (TagLink.uriFor), so what the operator sees here can never drift from what lands on
    // the card. Shown on screen because "Card id" alone is not something a person can
    // recognise as a scannable link - see the note on `pendingUri` below.
    @State private var writer = TagWriter()
    @State private var outcome: TagWriter.Outcome?
    @State private var confirmedFor: String?
    @State private var confirmText = ""
    @State private var busy = false
    @State private var report: ReportState = .idle
    // The id that actually LEFT this phone. `pendingId` is re-minted the moment a report
    // lands, so it is already the NEXT card by the time the zone step runs - resolving
    // against it would 404 on a tag nobody ever reported.
    @State private var reportedId: String?
    @State private var zone: ZoneState = .idle
    @State private var locations: [WireOperatorLocation] = []
    @State private var pickedLocationId: String?
    @State private var zoneName = ""

    private enum ReportState: Equatable {
        case idle, sending, sent
        case failed
    }

    /// The zone step, modelled the same way the report above it is: one enum, one line of
    /// text per case (see `zoneText`), no scattered booleans. `.failed` carries the server's
    /// error CODE rather than a sentence, because the sentence belongs next to the field.
    private enum ZoneState: Equatable {
        case idle, loading, picking, submitting
        case created(String)
        case failed(String)
    }

    var body: some View {
        Form {
            writeSections
        }
        .navigationTitle("Write a tag")
        // The session went away underneath us - expired, revoked, or signed out on another
        // screen. Back to the gate, which is the ONE place a code is typed now.
        .onChange(of: operatorSession.operatorInfo == nil) { _, gone in
            if gone { dismiss() }
        }
    }

    @ViewBuilder
    private var writeSections: some View {
        Group {
            Section {
                Text("This never opens a shift. A fresh id is minted on this phone before anything is written.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                // THE ACTUAL LINK, not just its id - this is what a phone reads back when it
                // taps the card, and the only thing on this screen an operator can visually
                // recognise as "a working tag" versus "some text".
                LabeledContent("Will write", value: pendingUri)
                    .font(.system(.footnote, design: .monospaced))
                LabeledContent("Card id", value: pendingId)
                    .font(.system(.footnote, design: .monospaced))
            }

            Section {
                Text(statusText)
                    .accessibilityLabel(statusText)
                if let occupied = occupiedOutcome, confirmedFor != occupied.onTag {
                    TextField("Last six characters", text: $confirmText)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Button("Overwrite") {
                        confirmedFor = occupied.onTag
                        confirmText = ""
                    }
                    .disabled(!WriteGuard.confirms(locationId: occupied.onTag, typed: confirmText))
                }
                Button("Write") { Task { await write() } }
                    .disabled(busy)
            }

            if case .written(let locationId, _, _, _, _) = outcome, report != .sent {
                Section {
                    Text(reportText)
                        .font(.footnote)
                    Button("Tell the office") { Task { await sendReport(locationId) } }
                        .disabled(busy)
                }
            }

            // ONLY after the office knows about the card. Resolving a tag the server has
            // never heard of is a guaranteed 404, so this step cannot come earlier - and a
            // failed report is not a dead end, because the retry button above is still up.
            if report == .sent, reportedId != nil {
                zoneSection
            }

            #if DEBUG
            mockSection
            #endif
        }
    }

    #if DEBUG
    /// Absent from a Release build, byte for byte - see OperatorMockFlows.swift. The button
    /// does NOT draw a canned screen: it hands the state machine the outcome a successful
    /// write would have produced and then lets the SHIPPING report + zone steps run against
    /// mocked responses, so what gets walked here is this file's real code.
    @ViewBuilder
    private var mockSection: some View {
        Section("Simulate (debug builds only)") {
            Text("No NFC, no network. A simulator has neither.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button(OperatorMockFlow.writeThenPickBuilding.label) {
                Task { await simulateWrite(OperatorMockFlow.writeThenPickBuilding) }
            }
            .disabled(busy)
            Button(OperatorMockFlow.writeThenSkipBuilding.label) {
                Task { await simulateWrite(OperatorMockFlow.writeThenSkipBuilding) }
            }
            .disabled(busy)
        }
    }

    /// The only thing bypassed is the radio. Everything after this line - the report, the
    /// re-mint of `pendingId`, the building fetch, the picker, `createZone()` - is untouched
    /// shipping code talking to OperatorFlowAPI's mocked half.
    private func simulateWrite(_ flow: OperatorMockFlow) async {
        OperatorMocks.arm(flow)
        busy = true
        let id = UUID().uuidString.lowercased()
        outcome = OperatorMocks.writtenOutcome(id: id)
        busy = false
        await sendReport(id)
        // The difference between the two scenarios, seeded rather than narrated: one arrives
        // at the picker with a building already chosen, the other with Skip standing.
        pickedLocationId = flow == .writeThenPickBuilding ? OperatorMocks.locations.first?.id : nil
        zoneName = "Stiege 2"
    }
    #endif

    @ViewBuilder
    private var zoneSection: some View {
        Section("Make this card a zone") {
            Text(zoneText)
                .font(.footnote)
                .accessibilityLabel(zoneText)
            switch zone {
            case .idle, .loading, .submitting, .created:
                EmptyView()
            case .picking, .failed:
                TextField("Zone name", text: $zoneName)
                    .autocorrectionDisabled()
                // "Skip" is an OPTION INSIDE the picker rather than a second button:
                // skipping is an answer to the building question, not a way out of the zone
                // step, and a separate button would read as the latter. An unbound zone is a
                // legitimate resting state (decision-54 §1). Same control VerifyZoneScreen
                // binds an existing zone with - see BuildingPicker.swift.
                BuildingPicker(locations: locations, allowsSkip: true, selection: $pickedLocationId)
                Button("Create zone") { Task { await createZone() } }
                    .disabled(busy || zoneName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private var occupiedOutcome: (onTag: String, offered: String, token: String)? {
        guard case .refusedOccupied(let onTag, let offered, let token) = outcome else { return nil }
        return (onTag, offered, token)
    }

    /// The full link for [pendingId], for display only - TagWriter recomputes the real bytes
    /// itself via NdefTag.plan(), this never feeds a write. Falls back to the bare id in the
    /// impossible case TagLink can't build one (badId), so the label is never blank.
    private var pendingUri: String {
        TagLink.uriFor(pendingId)?.absoluteString ?? pendingId
    }

    private func write() async {
        busy = true
        defer { busy = false }
        let result = await writer.write(locationId: pendingId, confirmedOverwriteOf: confirmedFor)
        outcome = result
        if case .written = result {
            // The confirmation is SPENT: it authorised one card, and the next card
            // presented starts from refused again.
            confirmedFor = nil
            confirmText = ""
            if case .written(let locationId, _, _, _, _) = result {
                await sendReport(locationId)
            }
        }
    }

    private func sendReport(_ locationId: String) async {
        guard !busy || report != .sending else { return }
        report = .sending
        do {
            _ = try await OperatorFlowAPI.reportTag(id: locationId)
            report = .sent
            reportedId = locationId
            // The id has now left this phone, so the NEXT card must not reuse it.
            pendingId = UUID().uuidString.lowercased()
            await loadLocations()
        } catch {
            report = .failed
        }
    }

    /// The building list is a CONVENIENCE, never a gate: if it fails to load, the picker
    /// still opens with Skip as its only choice and the zone can still be created unbound,
    /// which is exactly what an operator who cannot answer the building question wanted
    /// anyway. So there is no retry button and no error state of its own here.
    private func loadLocations() async {
        zone = .loading
        locations = (try? await OperatorFlowAPI.locations()) ?? []
        pickedLocationId = nil
        zoneName = ""
        zone = .picking
    }

    private func createZone() async {
        guard let reportedId else { return }
        busy = true
        defer { busy = false }
        zone = .submitting
        do {
            let created = try await OperatorFlowAPI.resolveZone(
                tagId: reportedId,
                name: zoneName.trimmingCharacters(in: .whitespacesAndNewlines),
                locationId: pickedLocationId)
            zone = .created(created.locationId == nil
                            ? String(localized: "Zone created: \(created.name). No building yet - bind it in Test a tag.")
                            : String(localized: "Zone created: \(created.name)."))
        } catch let failure as APIFailure {
            zone = .failed(failure.code)
        } catch {
            zone = .failed("network")
        }
    }

    private var zoneText: String {
        switch zone {
        case .idle: return ""
        case .loading: return String(localized: "Loading buildings…")
        case .picking:
            return locations.isEmpty
                ? String(localized: "Name this door. No buildings loaded - the zone will be created without one.")
                : String(localized: "Name this door and pick its building, or skip the building for now.")
        case .submitting: return String(localized: "Creating the zone…")
        case .created(let message): return message
        case .failed(let code):
            switch code {
            case "duplicate_zone_name": return String(localized: "That building already has a zone with this name.")
            case "already_resolved": return String(localized: "Somebody already made this card into a zone.")
            case "unknown_reported_tag": return String(localized: "The office doesn't know this card yet. Tell the office first.")
            case "unknown_location": return String(localized: "That building isn't one of ours any more.")
            case "network": return String(localized: "No connection - try again.")
            default: return String(localized: "Server trouble - try again.")
            }
        }
    }

    private var reportText: String {
        switch report {
        case .idle: return ""
        case .sending: return String(localized: "Telling the office…")
        case .sent: return String(localized: "Reported.")
        case .failed: return String(localized: "Couldn't reach the office yet - the card is fine. Retry.")
        }
    }

    private var statusText: String {
        guard let outcome else {
            return busy ? String(localized: "Hold your phone near the card.") : ""
        }
        switch outcome {
        case .written(let locationId, let uri, let bytes, let capacity, let replaced):
            let base = String(localized: "Written: \(uri) — \(bytes) of \(capacity) bytes.")
            _ = locationId // kept in the pattern to match TagWriter.Outcome; the URL is what matters here
            switch replaced {
            case .blank:
                return base
            case .foreign(let summary):
                return base + " " + String(localized: "This card held something else before: \(summary).")
            case .ours(let onTag):
                return base + " " + String(localized: "This card held one of our own ids before: \(onTag).")
            }
        case .refusedTooSmall(let needed, let capacity):
            return String(localized: "Too small for this tag: needs \(needed) bytes, this tag holds \(capacity).")
        case .refusedReadOnly:
            return String(localized: "This tag is locked read-only.")
        case .refusedNoCapacity:
            return String(localized: "This tag reports no writable space.")
        case .refusedNotFormatted:
            return String(localized: "This tag isn't NDEF-formatted.")
        case .refusedBadId:
            return String(localized: "Couldn't build a tag for this id.")
        case .refusedOccupied(let onTag, _, let token):
            if confirmedFor == onTag {
                return String(localized: "Present the card again to overwrite \(onTag).")
            }
            return String(localized: "This card already belongs to \(onTag). Type the last six characters to overwrite it: \(token).")
        case .unverified(let reason):
            return String(localized: "The write didn't verify (\(reason)). Present this card again.")
        case .lost(let reason):
            return String(localized: "Lost the connection (\(reason)). Try again.")
        case .unavailable(let message):
            return message
        }
    }
}
