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
//  Reachable ONLY through OperatorHomeScreen (decision-54 §4). The inline operator-code
//  field this screen used to carry is gone for the same reason WriteTagScreen.swift's is:
//  the gate moved upstream of the navigation link, so there is nothing left here to gate.
//  A session that dies mid-screen pops back to that gate instead of re-growing a second
//  code-entry UI.
//
//  TWO ENDINGS SINCE decision-54, decided by the picked zone and not by anything scanned:
//  a zone with NO BUILDING gets the building picker and a bind, because `activePlace` cannot
//  resolve an unbound zone and there is therefore nothing a scan could prove; a BOUND zone
//  scans exactly as before and then shows its zone page - this month's shifts at that door,
//  paginated, hours only, no rate and no client (decision-54 §7).
//

import SwiftUI

struct VerifyZoneScreen: View {
    @Environment(OperatorSession.self) private var operatorSession
    @Environment(\.dismiss) private var dismiss
    @State private var zones: [WireOperatorZone] = []
    @State private var loading = false
    @State private var loadError = false
    @State private var selected: WireOperatorZone?
    @State private var checking = false
    @State private var outcome: TagReaderProbe.Outcome?
    @State private var verifyResult: WireZoneVerifyResult?
    @State private var probe = TagReaderProbe()
    @State private var lastFailureCode: String?
    @State private var locations: [WireOperatorLocation] = []
    @State private var pickedLocationId: String?
    @State private var bind: BindState = .idle
    @State private var shifts: WireZoneShiftsPage?
    @State private var shiftsPage = 1
    @State private var shiftsBusy = false
    @State private var shiftsError = false

    /// The bind step for an UNBOUND zone, modelled the same way WriteTagScreen models its
    /// zone step: one enum, one sentence per case, no scattered booleans. `.failed` carries
    /// the server's CODE, because the sentence belongs next to the field.
    private enum BindState: Equatable {
        case idle, loading, picking, submitting, bound
        case failed(String)
    }

    var body: some View {
        Form {
            verifySections
        }
        .navigationTitle("Test a tag")
        // Loading zones is an operator action (OperatorTagAPI carries ts_operator). The
        // gate upstream guarantees a session exists by the time this screen mounts, so
        // this is a plain .task now, not one keyed on sign-in flipping.
        .task { await load() }
        .onChange(of: operatorSession.operatorInfo == nil) { _, gone in
            if gone { dismiss() }
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

            #if DEBUG
            mockSection
            #endif
        }
    }

    #if DEBUG
    /// Absent from a Release build, byte for byte - see OperatorMockFlows.swift. Each button
    /// only swaps the worklist for a canned one and selects a row; the bind, the scan, the
    /// verify and the zone page that follow are the shipping code paths above, running
    /// against mocked responses.
    @ViewBuilder
    private var mockSection: some View {
        Section("Simulate (debug builds only)") {
            Text("No NFC, no network. A simulator has neither.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button(OperatorMockFlow.bindUnboundZone.label) {
                simulate(OperatorMockFlow.bindUnboundZone, zoneId: OperatorMocks.unboundZoneId)
            }
            Button(OperatorMockFlow.verifyBoundZone.label) {
                simulate(OperatorMockFlow.verifyBoundZone, zoneId: OperatorMocks.boundZoneId)
            }
        }
    }

    private func simulate(_ flow: OperatorMockFlow, zoneId: String) {
        OperatorMocks.arm(flow)
        loadError = false
        zones = OperatorMocks.zones
        // Through `select`, not by assigning `selected`: that function is the one place the
        // four pieces of per-zone state are reset, and it is also what kicks off the building
        // fetch for an unbound zone. A scenario that set `selected` directly would be testing
        // a state the app cannot otherwise reach.
        select(zones.first { $0.id == zoneId })
    }
    #endif

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
                    select(zone)
                } label: {
                    VStack(alignment: .leading) {
                        Text("\(zone.locationName ?? String(localized: "No building yet")) · \(zone.name)")
                        Text(zone.isBound
                             ? (zone.isVerified
                                ? String(localized: "Verified \(zone.verifiedAt.map(formatted) ?? "")")
                                : String(localized: "Not verified yet"))
                             : String(localized: "Needs a building before it can be tested"))
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
            Text(zone.locationName.map { String(localized: "\(zone.name) at \($0)") }
                 ?? String(localized: "\(zone.name), no building yet"))
                .font(.headline)
            // AN UNBOUND ZONE IS NEVER SCANNED. `activePlace` INNER JOINs `locations`, so a
            // zone with no building resolves to no tap at all - there is literally nothing
            // for a verify to prove yet (decision-54 §7). The building question comes first,
            // and the scan button does not exist until it is answered.
            if zone.isBound {
                Text(statusText)
                    .accessibilityLabel(statusText)
                Button("Scan the card") { Task { await scan(zone) } }
                    .disabled(checking)
            } else {
                bindRows(zone)
            }
            Button("Choose a different zone") { select(nil) }
        }
        if zone.isBound, verifyResult != nil {
            zonePageSection(zone)
        }
    }

    @ViewBuilder
    private func bindRows(_ zone: WireOperatorZone) -> some View {
        Text(bindText)
            .font(.footnote)
            .accessibilityLabel(bindText)
        switch bind {
        case .idle, .loading, .submitting, .bound:
            EmptyView()
        case .picking, .failed:
            // Skip is NOT offered here: this zone already has no building, so "no building"
            // is not an answer to anything. See BuildingPicker.swift.
            BuildingPicker(locations: locations, allowsSkip: false, selection: $pickedLocationId)
            if locations.isEmpty {
                // The one dead end this step can reach: no list, so nothing to pick. Unlike
                // the write flow, "carry on without a building" is not an option here.
                Button("Try again") { Task { await loadLocations() } }
            }
            Button("Put this zone in that building") { Task { await bindZone(zone) } }
                .disabled(pickedLocationId == nil)
        }
    }

    /// THE ZONE PAGE (decision-54 §7). Hours and names, never a rate, a euro figure or a
    /// client - the server does not send those and this screen would have nowhere to put
    /// them. The total is the SERVER's month total, not a sum of the rows on screen: with 50
    /// to a page, adding up what is visible and calling it the month is a lie that gets
    /// bigger the busier the door is.
    @ViewBuilder
    private func zonePageSection(_ zone: WireOperatorZone) -> some View {
        Section("This month at this door") {
            if let shifts {
                LabeledContent("Total this month", value: fmtDur(shifts.totalMinutes * 60))
                if shifts.shifts.isEmpty {
                    Text("Nobody has clocked in here this month.")
                        .foregroundStyle(.secondary)
                }
                ForEach(shifts.shifts) { shift in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(shift.workerName).font(.headline)
                        Text(shiftLine(shift))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if shifts.matching > shifts.pageSize {
                    LabeledContent("Page", value: "\(shifts.page) / \(pageCount(shifts))")
                        .font(.footnote)
                    Button("Previous page") { Task { await loadShifts(zone, page: shifts.page - 1) } }
                        .disabled(shiftsBusy || shifts.page <= 1)
                    Button("Next page") { Task { await loadShifts(zone, page: shifts.page + 1) } }
                        .disabled(shiftsBusy || !shifts.hasNextPage)
                }
            }
            if shiftsBusy {
                Text("Loading shifts…").font(.footnote).foregroundStyle(.secondary)
            }
            if shiftsError {
                Text("Couldn't load this month's shifts.").foregroundStyle(.red)
                Button("Try again") { Task { await loadShifts(zone, page: shiftsPage) } }
                    .disabled(shiftsBusy)
            }
        }
    }

    private func pageCount(_ page: WireZoneShiftsPage) -> Int {
        max(1, (page.matching + page.pageSize - 1) / page.pageSize)
    }

    /// An OPEN shift has no end time and its duration is the time so far, computed by the
    /// server. Saying "still running" is the honest rendering of that; an em dash where the
    /// end time goes would read as a data hole.
    private func shiftLine(_ shift: WireZoneShift) -> String {
        let start = shift.startTime.formatted(date: .abbreviated, time: .shortened)
        let duration = fmtDur(shift.durationMinutes * 60)
        guard let end = shift.endTime else {
            return String(localized: "\(start) · still running · \(duration)")
        }
        return String(localized: "\(start) – \(end.formatted(date: .omitted, time: .shortened)) · \(duration)")
    }

    /// One place the whole per-zone state is reset, because there are now four pieces of it
    /// and "the previous zone's shifts under this zone's name" is the bug that shape invites.
    private func select(_ zone: WireOperatorZone?) {
        selected = zone
        outcome = nil
        verifyResult = nil
        lastFailureCode = nil
        shifts = nil
        shiftsPage = 1
        shiftsError = false
        bind = .idle
        pickedLocationId = nil
        if let zone, !zone.isBound { Task { await loadLocations() } }
    }

    /// Unlike the zone worklist there is no cache here: an operator standing at a door with
    /// no signal cannot bind a zone anyway (the POST needs the network), so a stale building
    /// list would only ever produce a nicer-looking failure.
    private func loadLocations() async {
        bind = .loading
        do {
            locations = try await OperatorFlowAPI.locations()
            bind = .picking
        } catch {
            locations = []
            bind = .failed("locations")
        }
    }

    private func bindZone(_ zone: WireOperatorZone) async {
        guard let locationId = pickedLocationId else { return }
        bind = .submitting
        do {
            let bound = try await OperatorFlowAPI.bindZone(zoneId: zone.id, locationId: locationId)
            bind = .bound
            // Rebuilt locally rather than re-fetched: the bind response carries no
            // `location_name` (it selects off `zones` alone) and the name is already in hand
            // from the list the operator just picked from. `verifiedAt` goes to nil because
            // the SERVER cleared it - the old proof was taken against a zone that resolved to
            // nothing - so the screen must offer the scan again, not claim the door is done.
            let renamed = WireOperatorZone(
                id: zone.id,
                locationId: bound.locationId,
                locationName: locations.first { $0.id == locationId }?.name,
                name: bound.name,
                tagSerial: zone.tagSerial,
                tagDeployedAt: zone.tagDeployedAt,
                verifiedAt: nil)
            selected = renamed
            // The worklist behind this screen is now wrong about this zone, and its cache is
            // what the next visit opens with. Patch both in place; a full refresh needs a
            // round trip this screen does not need to wait for.
            zones = zones.map { $0.id == renamed.id ? renamed : $0 }
            OperatorFlowAPI.cacheZones(zones)
        } catch let failure as APIFailure {
            bind = .failed(failure.code)
        } catch {
            bind = .failed("network")
        }
    }

    private func loadShifts(_ zone: WireOperatorZone, page: Int) async {
        shiftsBusy = true
        shiftsError = false
        shiftsPage = page
        do {
            shifts = try await OperatorFlowAPI.zoneShifts(zoneId: zone.id, page: page)
        } catch {
            shiftsError = true
        }
        shiftsBusy = false
    }

    private var bindText: String {
        switch bind {
        case .idle: return ""
        case .loading: return String(localized: "Loading buildings…")
        case .picking:
            return locations.isEmpty
                ? String(localized: "No buildings loaded - try again with a signal.")
                : String(localized: "This zone has no building yet, so a tap on its card resolves to nothing. Pick its building first.")
        case .submitting: return String(localized: "Binding the zone…")
        case .bound: return String(localized: "Bound. Scan the card to prove it.")
        case .failed(let code):
            switch code {
            case "already_bound": return String(localized: "Somebody already gave this zone a building.")
            case "duplicate_zone_name": return String(localized: "That building already has a zone with this name.")
            case "serial_taken": return String(localized: "Another zone already claims this card.")
            case "unknown_zone": return String(localized: "This zone isn't active any more.")
            case "unknown_location": return String(localized: "That building isn't one of ours any more.")
            case "locations", "network": return String(localized: "No connection - try again.")
            default: return String(localized: "Server trouble - try again.")
            }
        }
    }

    private func load() async {
        zones = OperatorZoneCache.read()
        loading = true
        do {
            let fresh = try await OperatorFlowAPI.zones()
            OperatorFlowAPI.cacheZones(fresh)
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
        let result = await OperatorFlowAPI.scan(probe, zones: zones)
        outcome = result
        if case .resolved(let placeId) = result {
            do {
                verifyResult = try await OperatorFlowAPI.verifyZone(zoneId: zone.id, placeUuid: placeId)
            } catch let failure as APIFailure {
                verifyResult = nil
                lastFailureCode = failure.code
            } catch {
                verifyResult = nil
                lastFailureCode = "network"
            }
        }
        checking = false
        // A re-scan of a door already proved counts: `alreadyVerified` means the card is
        // right, which is the only precondition the zone page has.
        if verifyResult != nil { await loadShifts(zone, page: 1) }
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
