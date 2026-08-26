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
//  TWO WAYS IN SINCE decision-55, and the older one is UNCHANGED. Worklist-first is still
//  exactly the flow above: pick the zone, then scan, and `zone_mismatch` still protects that
//  commitment. SCAN-FIRST is the added one (decision-55 §1/§2): the operator scans a card
//  nobody selected - one out of a drawer, one on a door with no worklist entry - and
//  `GET /operator/tags/:id` says what it IS. A live zone lands in the branches below, bound
//  or unbound, THE SAME ONES, because that is the point of the route returning the zone body
//  verbatim; the other four kinds are a sentence and no action. `zone_mismatch` cannot fire
//  on that path - there is no pre-selected target to mismatch against - and it stays exactly
//  as protective as it was on the path that does have one.
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
    @State private var unbind: UnbindState = .idle
    @State private var confirmingUnbind = false
    @State private var classify: ClassifyState = .idle
    @State private var reassign: ReassignState = .idle
    @State private var reassignLocationId: String?
    // The WRITE half, needed here only for a reassignment - which rewrites the physical card
    // before the server is told anything (decision-55 §3). Nothing else on this screen writes,
    // and the sequence itself lives in OperatorTagMint.swift, shared with Write a tag.
    @State private var writer = TagWriter()

    /// SCAN-FIRST (decision-55 §1). `.notAZone` carries the server's `kind` rather than a
    /// sentence for the same reason `.failed` carries a code: the wording belongs next to the
    /// place it is shown. A live zone is NOT a case here - it leaves this state machine
    /// entirely and becomes `selected`, which is what makes it the same screen as the
    /// worklist path and not a copy of it.
    private enum ClassifyState: Equatable {
        case idle, scanning
        case notAZone(kind: String)
        /// The radio failed before any classification happened - message already localized.
        case scanFailed(String)
        case failed(String)
    }

    /// REASSIGN (decision-55 §3). Its own state machine and not a case inside `bind`, because
    /// it is a different act on a different zone: bind gives a buildingless zone a building,
    /// this CLOSES a live zone and mints a replacement on a rewritten card.
    ///
    /// `.writeRefused` is separate from `.failed` for the same reason `zone_has_shifts` is
    /// separate above: the card in the operator's hand is the problem, not the server, and
    /// the next move (take another card) differs completely from retrying.
    private enum ReassignState: Equatable {
        case idle, loading, picking, writing, submitting, done
        case writeRefused(String)
        case failed(String)
    }

    /// The bind step for an UNBOUND zone, modelled the same way WriteTagScreen models its
    /// zone step: one enum, one sentence per case, no scattered booleans. `.failed` carries
    /// the server's CODE, because the sentence belongs next to the field.
    private enum BindState: Equatable {
        case idle, loading, picking, submitting, bound
        case failed(String)
    }

    /// UNBIND (TASK-277), the way back out of a wrong building - and the only one there is:
    /// `bindZone` refuses a zone that already has a building, and decision-54 §2/§3 removed
    /// the admin panel's ability to touch a zone's building at all.
    ///
    /// IT IS NOT A DELETE, and the confirmation says so. The zone, its card, its name and its
    /// proof all survive - only the building goes, and binding it again puts one back.
    ///
    /// `zone_has_shifts` IS ITS OWN CASE, not a code inside `.failed`. The server refuses a
    /// zone any shift has ever referenced (a composite FK in migration 013, not a check in
    /// this app), and that refusal is a fact an operator standing at the door can act on -
    /// "this is the right building after all" - where a code is not.
    private enum UnbindState: Equatable {
        case idle, submitting, unbound
        case hasShifts
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
                scanFirstSection
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
            // Two scenarios, one screen, visibly different endings: the first drops the zone
            // into the building picker, the second leaves it exactly where it is and says why.
            Button(OperatorMockFlow.unbindBoundZone.label) {
                simulate(OperatorMockFlow.unbindBoundZone, zoneId: OperatorMocks.boundZoneId)
            }
            Button(OperatorMockFlow.unbindZoneWithShifts.label) {
                simulate(OperatorMockFlow.unbindZoneWithShifts, zoneId: OperatorMocks.boundZoneId)
            }
            // decision-55: the six answers a scanned card can produce, walked through the
            // SHIPPING scan-first path - only the radio and the network are canned. Two of
            // them end on the zone branches the buttons above reach by picking instead.
            ForEach([OperatorMockFlow.scanBoundZone, .scanUnboundZone, .scanBuildingCard,
                     .scanRetiredCard, .scanReportedCard, .scanUnknownCard]) { flow in
                Button(flow.label) { Task { await simulateScan(flow) } }
            }
            // Arms and selects only: the reassignment itself is driven by tapping the real
            // buttons on the zone page, which is where its state machine lives.
            Button(OperatorMockFlow.reassignBuilding.label) {
                simulate(OperatorMockFlow.reassignBuilding, zoneId: OperatorMocks.boundZoneId)
            }
        }
    }

    private func simulateScan(_ flow: OperatorMockFlow) async {
        OperatorMocks.arm(flow)
        loadError = false
        zones = OperatorMocks.zones
        select(nil)
        await scanFirst()
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

    /// THE SCAN-FIRST DOOR (decision-55 §2). Above the worklist, not instead of it: an
    /// operator who knows which door they are at still picks it and gets the mismatch check;
    /// an operator holding a card they cannot place scans it and is told what it is.
    @ViewBuilder
    private var scanFirstSection: some View {
        Section("Test any card") {
            Text("Scan a card and this says what it is. Nothing is written and no shift is opened.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let text = classifyText {
                Text(text)
                    .font(.footnote)
                    .foregroundStyle(classifyIsError ? Color.red : Color.primary)
                    .accessibilityLabel(text)
            }
            Button("Scan a card") { Task { await scanFirst() } }
                .disabled(classify == .scanning || checking)
        }
    }

    private var classifyIsError: Bool {
        if case .failed = classify { return true }
        if case .scanFailed = classify { return true }
        return false
    }

    /// One sentence per kind, and each one tells the operator something different about the
    /// card in their hand - which is the entire reason the route tells `building`, `retired`
    /// and `tag_reported` apart from `unknown` instead of collapsing them (decision-55 §1).
    /// NO ACTION is offered from any of them, by decision.
    private var classifyText: String? {
        switch classify {
        case .idle: return nil
        case .scanning: return String(localized: "Reading the card…")
        case .notAZone(let kind):
            switch kind {
            case "building":
                return String(localized: "This is an object card, not a zone card. It stays as it is.")
            case "retired":
                return String(localized: "This card belonged to a zone that has since been closed. Write it again to put it back in use.")
            case "tag_reported":
                return String(localized: "The office knows this card, but nobody has made it a zone yet.")
            default:
                return String(localized: "This card isn't one of ours.")
            }
        case .scanFailed(let message): return message
        case .failed(let code):
            switch code {
            case "network": return String(localized: "No connection - try again.")
            default: return String(localized: "Server trouble - try again.")
            }
        }
    }

    /// Scan, then ASK - and nothing is selected first, on purpose. A live zone is fed into
    /// `select`, the same function the worklist uses, so what follows is the existing screen:
    /// bound zones auto-verify (the card just proved itself, and there was no other target it
    /// could have been meant for), unbound zones get the building picker.
    private func scanFirst() async {
        classify = .scanning
        let result = await OperatorFlowAPI.scan(probe, zones: zones)
        guard case .resolved(let placeId) = result else {
            classify = .scanFailed(outcomeText(result))
            return
        }
        do {
            let classified = try await OperatorFlowAPI.classifyTag(id: placeId)
            guard classified.kind == "zone", let zone = classified.zone else {
                classify = .notAZone(kind: classified.kind)
                return
            }
            classify = .idle
            select(zone)
            // decision-55 §2: the verify is the EXISTING call, reached without the worklist
            // detour. An unbound zone is not verified because `activePlace` cannot resolve one
            // - there is nothing yet for a scan to prove.
            if zone.isBound { await verify(zone, placeId: placeId) }
        } catch let failure as APIFailure {
            classify = .failed(failure.code)
        } catch {
            classify = .failed("network")
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
            unbindRows(zone)
            reassignRows(zone)
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

    /// The unbind outcome sentence, plus - for a BOUND zone only - the button and its
    /// confirmation. Both live here rather than in the bound branch above because a successful
    /// unbind flips the zone to UNBOUND and therefore to the bind form: the sentence that
    /// explains why the building picker just appeared has to outlive the branch that caused it.
    ///
    /// The dialog NAMES THE BUILDING. An operator with a worklist of near-identical stairwells
    /// is exactly who this is for, and "are you sure?" over an unnamed building is a question
    /// nobody can answer.
    @ViewBuilder
    private func unbindRows(_ zone: WireOperatorZone) -> some View {
        if let text = unbindText {
            Text(text)
                .font(.footnote)
                .foregroundStyle(unbind == .unbound || unbind == .submitting ? Color.primary : Color.red)
                .accessibilityLabel(text)
        }
        if zone.isBound {
            Button("Remove this zone from its building") { confirmingUnbind = true }
                .disabled(unbind == .submitting)
                .confirmationDialog(
                    Text("Remove this zone from \(zone.locationName ?? String(localized: "this building"))? This does not delete anything, and it can be undone by assigning a building again."),
                    isPresented: $confirmingUnbind,
                    titleVisibility: .visible
                ) {
                    Button("Remove", role: .destructive) { Task { await unbindZone(zone) } }
                    Button("Cancel", role: .cancel) {}
                }
        }
    }

    /// REASSIGN BUILDING (decision-55 §3), offered on a BOUND zone and nowhere else: a zone
    /// with no building has nothing to move, and the server says so too (409 zone_unbound).
    ///
    /// It is NOT unbind-then-bind. That path is refused by the database the moment anybody has
    /// clocked in here (a composite FK, migration 013) - which is exactly the door this is for.
    /// This one CLOSES the zone and mints a fresh one on a rewritten card, so the old zone's
    /// shifts stay where they are, under an id nothing new can reference.
    @ViewBuilder
    private func reassignRows(_ zone: WireOperatorZone) -> some View {
        if let text = reassignText {
            Text(text)
                .font(.footnote)
                .foregroundStyle(reassignIsError ? Color.red : Color.primary)
                .accessibilityLabel(text)
        }
        if zone.isBound {
            switch reassign {
            case .idle, .done:
                Button("Move this zone to another object") { Task { await startReassign() } }
            case .loading, .writing, .submitting:
                EmptyView()
            case .picking, .writeRefused, .failed:
                BuildingPicker(locations: locations, allowsSkip: false, selection: $reassignLocationId)
                // The zone's CURRENT building is not a move. Disabled rather than hidden: an
                // operator scanning the list for the building they meant needs to see the one
                // they are leaving.
                Button("Write a new card and move the zone") { Task { await reassignZone(zone) } }
                    .disabled(reassignLocationId == nil || reassignLocationId == zone.locationId)
            }
        }
    }

    private var reassignIsError: Bool {
        if case .failed = reassign { return true }
        if case .writeRefused = reassign { return true }
        return false
    }

    /// Its own fetch rather than `loadLocations()`, which drives the BIND state machine: two
    /// acts, two states, and a shared loader would have one of them narrating the other.
    private func startReassign() async {
        reassign = .loading
        do {
            locations = try await OperatorFlowAPI.locations()
            reassignLocationId = nil
            reassign = .picking
        } catch {
            locations = []
            reassign = .failed("locations")
        }
    }

    /// MINT -> WRITE -> REPORT -> reassign, in that order and no other. The card must carry
    /// the new id and the office must know it BEFORE the server is asked to move anything -
    /// an unreported id is a guaranteed 404 there. The first three steps are
    /// OperatorTagMint.writeAndReport, the SAME function Write a tag runs; no CoreNFC call is
    /// made from this file.
    ///
    /// A written-but-unreported card is NOT a dead end and NOT a lost card: the id is on the
    /// tag, the button is still up, and pressing it again writes a fresh id to the same card.
    /// ponytail: that leaves the first id orphaned server-side (never reported, so never a
    /// zone). Harmless - it is a uuid nothing references - and the alternative, a resume path
    /// that remembers a half-finished reassignment across screens, is a lot of state for a
    /// case a retry already covers.
    private func reassignZone(_ zone: WireOperatorZone) async {
        guard let locationId = reassignLocationId else { return }
        reassign = .writing
        let minted = await OperatorTagMint.writeAndReport(
            writer: writer, id: OperatorTagMint.mintId(), confirmedOverwriteOf: nil)
        guard minted.written else {
            reassign = .writeRefused(writeFailureText(minted.outcome))
            return
        }
        guard minted.reported else {
            reassign = .failed("report")
            return
        }
        reassign = .submitting
        do {
            let moved = try await OperatorFlowAPI.reassignBuilding(
                zoneId: zone.id, newTagId: minted.id, locationId: locationId)
            adopt(moved, locationId: locationId)
        } catch let failure as APIFailure {
            reassign = .failed(failure.code)
        } catch {
            reassign = .failed("network")
        }
    }

    /// The reassignment landed: the OLD zone is inactive server-side, so it leaves the
    /// worklist and its cache here in the same breath - showing it as a live door again, even
    /// once, would invite a test scan of a card that no longer exists.
    ///
    /// The screen then IS the new zone's page: bound, `verified_at` nil, no shifts (there
    /// cannot be any - the row was created a moment ago). No navigation, because this screen
    /// already renders exactly that for any bound, unverified zone.
    private func adopt(_ moved: WireReassignedZone, locationId: String) {
        let fresh = WireOperatorZone(
            id: moved.zone.id,
            locationId: moved.zone.locationId,
            // Same reason bindZone rebuilds it locally: the route selects off `zones` alone
            // and sends no `location_name`, and the operator just picked the building by name.
            locationName: locations.first { $0.id == locationId }?.name,
            name: moved.zone.name,
            tagSerial: moved.zone.tagSerial,
            tagDeployedAt: moved.zone.tagDeployedAt,
            verifiedAt: nil)
        zones = zones.filter { $0.id != moved.retiredZoneId && $0.id != fresh.id } + [fresh]
        OperatorFlowAPI.cacheZones(zones)
        selected = fresh
        outcome = nil
        verifyResult = nil
        lastFailureCode = nil
        shifts = nil
        shiftsPage = 1
        shiftsError = false
        bind = .idle
        pickedLocationId = nil
        unbind = .idle
        confirmingUnbind = false
        reassignLocationId = nil
        reassign = .done
    }

    /// The card refused the write. Only the cases this flow can actually produce get their own
    /// sentence - overwriting an occupied card needs the typed confirmation, which lives in
    /// Write a tag and is deliberately not re-grown here.
    private func writeFailureText(_ outcome: TagWriter.Outcome) -> String {
        switch outcome {
        case .unavailable(let message): return message
        case .refusedOccupied(let onTag, _, _):
            return String(localized: "This card already belongs to \(onTag). Use Write a tag to overwrite it.")
        case .lost(let reason):
            return String(localized: "Lost the connection (\(reason)). Try again.")
        default:
            return String(localized: "Couldn't write this card. Try another card.")
        }
    }

    private var reassignText: String? {
        switch reassign {
        case .idle: return nil
        case .loading: return String(localized: "Loading buildings…")
        case .picking:
            return locations.isEmpty
                ? String(localized: "No buildings loaded - try again with a signal.")
                : String(localized: "Pick the new object. The card is rewritten, this zone closes with its hours intact, and a fresh zone takes over.")
        case .writing: return String(localized: "Hold your phone near the card.")
        case .submitting: return String(localized: "Moving the zone…")
        case .done:
            return String(localized: "Moved. This is the new zone - scan its card to prove it before anybody clocks in.")
        case .writeRefused(let message): return message
        case .failed(let code):
            switch code {
            case "unknown_zone": return String(localized: "This zone isn't active any more.")
            case "zone_unbound": return String(localized: "This zone has no object yet, so there is nothing to move.")
            case "unknown_reported_tag", "report":
                return String(localized: "The card is written, but the office hasn't heard about it. Try again with a signal.")
            case "already_resolved", "id_in_use":
                return String(localized: "That new card is already in use. Take another card.")
            case "duplicate_zone_name":
                return String(localized: "That building already has a zone with this name.")
            case "unknown_location":
                return String(localized: "That building isn't one of ours any more.")
            case "locations", "network": return String(localized: "No connection - try again.")
            default: return String(localized: "Server trouble - try again.")
            }
        }
    }

    private var unbindText: String? {
        switch unbind {
        case .idle: return nil
        case .submitting: return String(localized: "Removing the building…")
        case .unbound: return String(localized: "The zone no longer has a building. Pick one now.")
        case .hasShifts:
            return String(localized: "Somebody has already clocked in at this door, so it stays with this building.")
        case .failed(let code):
            switch code {
            case "already_unbound": return String(localized: "This zone has no building anyway.")
            case "unknown_zone": return String(localized: "This zone isn't active any more.")
            case "network": return String(localized: "No connection - try again.")
            default: return String(localized: "Server trouble - try again.")
            }
        }
    }

    /// POST /operator/zones/:id/unbind. The zone comes back with no building, so the row is
    /// patched in place exactly as `bindZone` patches it and the screen falls through to the
    /// building picker - the honest next question. `verifiedAt` is carried through UNCHANGED:
    /// the server deliberately does not clear it on an unbind, and clearing it here would be
    /// this screen inventing a rule the API does not have.
    private func unbindZone(_ zone: WireOperatorZone) async {
        unbind = .submitting
        do {
            let unboundZone = try await OperatorFlowAPI.unbindZone(zoneId: zone.id)
            let renamed = WireOperatorZone(
                id: zone.id,
                locationId: nil,
                locationName: nil,
                name: unboundZone.name,
                tagSerial: zone.tagSerial,
                tagDeployedAt: zone.tagDeployedAt,
                verifiedAt: zone.verifiedAt)
            selected = renamed
            zones = zones.map { $0.id == renamed.id ? renamed : $0 }
            OperatorFlowAPI.cacheZones(zones)
            // The scan's leftovers name a door this zone no longer resolves to.
            outcome = nil
            verifyResult = nil
            lastFailureCode = nil
            shifts = nil
            shiftsPage = 1
            shiftsError = false
            pickedLocationId = nil
            unbind = .unbound
            await loadLocations()
        } catch let failure as APIFailure {
            // The refusal an operator can act on gets a sentence; everything else a code.
            unbind = failure.code == "zone_has_shifts" ? .hasShifts : .failed(failure.code)
        } catch {
            unbind = .failed("network")
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
        unbind = .idle
        confirmingUnbind = false
        reassign = .idle
        reassignLocationId = nil
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
        checking = false
        if case .resolved(let placeId) = result { await verify(zone, placeId: placeId) }
    }

    /// The verify half, split out because decision-55's scan-first path reaches it WITHOUT
    /// this screen's radio step - the card was already read and already classified. One copy,
    /// so the two entry points cannot end differently.
    private func verify(_ zone: WireOperatorZone, placeId: String) async {
        checking = true
        do {
            verifyResult = try await OperatorFlowAPI.verifyZone(zoneId: zone.id, placeUuid: placeId)
            lastFailureCode = nil
        } catch let failure as APIFailure {
            verifyResult = nil
            lastFailureCode = failure.code
        } catch {
            verifyResult = nil
            lastFailureCode = "network"
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
        return outcomeText(outcome)
    }

    /// What the RADIO said, with no server answer involved - shared by the worklist path's
    /// status line and the scan-first door, because a card that cannot be read reads the same
    /// either way.
    private func outcomeText(_ outcome: TagReaderProbe.Outcome?) -> String {
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
