//
//  OperatorMockFlows.swift
//  NFCTimeSheets
//
//  THE OPERATOR FLOWS, WALKABLE ON A SIMULATOR (TASK-274 §5). A simulator has no NFC radio
//  and this Mac has no live SMS provider, so the four branches decision-54 added - write
//  then pick a building, write then skip it, bind an unbound zone, verify a bound one and
//  read its zone page - had no way of being exercised at all before this file. Android has
//  carried writeSimulations()/verifyTapSimulations() for exactly this; iOS had NOTHING
//  (DemoHooks.swift is the RECORDING hook - one injected universal link at launch - and
//  solves a different problem), so this is a new mechanism built to that shape, not an
//  extension of that one.
//
//  TWO HALVES, AND THE SPLIT IS THE WHOLE DESIGN:
//
//  1. `OperatorFlowAPI` is NOT debug-only. It is the one door WriteTagScreen and
//     VerifyZoneScreen go through, and in a Release build every method below is a
//     one-line passthrough to OperatorTagAPI / TagReaderProbe with the `#if DEBUG` branch
//     compiled out - no mock symbol, no mock string, no branch to reach. That is why the
//     existing Release-build check needs no new rule: there is nothing left to find.
//
//  2. `OperatorMocks` is entirely inside `#if DEBUG` and holds canned RESPONSES only. It
//     never draws a screen and never owns a state machine: a scenario arms the door and
//     then the operator taps the SHIPPING buttons, so what is being walked is the real
//     state machine with the network and the radio replaced, not a parallel demo of it.
//     Nothing here sends an SMS, opens a socket or presents an NFC sheet.
//
//  THE PAGE SIZE IS DELIBERATELY WRONG. The server pages by 50; the mock pages by 2, so
//  two taps of "Next page" are actually reachable by hand. And `totalMinutes` is 195 while
//  the pages hold 150 and 45 - it equals NEITHER page and neither is a prefix of it, so a
//  screen that quietly summed the visible rows and called it the month would read 150 and
//  be visibly wrong. That is the point of the number (decision-54 §7).
//

import Foundation

enum OperatorFlowAPI {
    static func reportTag(id: String) async throws -> WireReportedTag {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.reportedTag(id: id) }
        #endif
        return try await OperatorTagAPI.reportTag(id: id)
    }

    static func locations() async throws -> [WireOperatorLocation] {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.locations }
        #endif
        return try await OperatorTagAPI.locations()
    }

    static func resolveZone(tagId: String, name: String, locationId: String?) async throws -> WireCreatedZone {
        #if DEBUG
        if OperatorMocks.active != nil {
            return OperatorMocks.createdZone(name: name, locationId: locationId)
        }
        #endif
        return try await OperatorTagAPI.resolveZone(tagId: tagId, name: name, locationId: locationId)
    }

    static func zones() async throws -> [WireOperatorZone] {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.zones }
        #endif
        return try await OperatorTagAPI.zones()
    }

    static func bindZone(zoneId: String, locationId: String) async throws -> WireCreatedZone {
        #if DEBUG
        if OperatorMocks.active != nil {
            return OperatorMocks.boundZone(zoneId: zoneId, locationId: locationId)
        }
        #endif
        return try await OperatorTagAPI.bindZone(zoneId: zoneId, locationId: locationId)
    }

    static func unbindZone(zoneId: String) async throws -> WireCreatedZone {
        #if DEBUG
        if OperatorMocks.active != nil { return try OperatorMocks.unboundZone(zoneId: zoneId) }
        #endif
        return try await OperatorTagAPI.unbindZone(zoneId: zoneId)
    }

    static func verifyZone(zoneId: String, placeUuid: String) async throws -> WireZoneVerifyResult {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.verifyResult(zoneId: zoneId) }
        #endif
        return try await OperatorTagAPI.verifyZone(zoneId: zoneId, placeUuid: placeUuid)
    }

    static func zoneShifts(zoneId: String, page: Int) async throws -> WireZoneShiftsPage {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.shiftsPage(page: page) }
        #endif
        return try await OperatorTagAPI.zoneShifts(zoneId: zoneId, page: page)
    }

    static func classifyTag(id: String) async throws -> WireTagClassification {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.classification(id: id) }
        #endif
        return try await OperatorTagAPI.classifyTag(id: id)
    }

    static func reassignBuilding(zoneId: String, newTagId: String,
                                 locationId: String) async throws -> WireReassignedZone {
        #if DEBUG
        if OperatorMocks.active != nil {
            return try OperatorMocks.reassigned(zoneId: zoneId, newTagId: newTagId, locationId: locationId)
        }
        #endif
        return try await OperatorTagAPI.reassignBuilding(zoneId: zoneId, newTagId: newTagId,
                                                         locationId: locationId)
    }

    /// The WRITE, behind the same door as everything else - a simulator has no radio, so a
    /// mocked reassign would otherwise die at the card and never reach the endpoint it exists
    /// to exercise. Live, this is a plain passthrough to the ported CoreNFC writer.
    @MainActor
    static func write(writer: TagWriter, id: String, confirmedOverwriteOf: String?) async -> TagWriter.Outcome {
        #if DEBUG
        if OperatorMocks.active != nil { return OperatorMocks.writtenOutcome(id: id) }
        #endif
        return await writer.write(locationId: id, confirmedOverwriteOf: confirmedOverwriteOf)
    }

    /// The radio, behind the same door as the network. A mocked scan resolves to the picked
    /// zone's own place id, which is the ONLY outcome that gets past `verifyZone`'s equality
    /// check - a mock that resolved to something else would be testing the mismatch branch,
    /// and that branch is reachable today by scanning the wrong card at a real door.
    @MainActor
    static func scan(_ probe: TagReaderProbe, zones: [WireOperatorZone]) async -> TagReaderProbe.Outcome {
        #if DEBUG
        if let placeId = OperatorMocks.scannedPlaceId { return .resolved(placeId: placeId) }
        #endif
        return await probe.scan(zones: zones)
    }

    /// The zone worklist cache is the NEXT visit's opening screen, so a mocked worklist must
    /// never reach it - a scenario walked once would otherwise leave a fake door in the
    /// picker until the next successful load.
    static func cacheZones(_ zones: [WireOperatorZone]) {
        #if DEBUG
        if OperatorMocks.active != nil { return }
        #endif
        OperatorZoneCache.write(zones)
    }
}

#if DEBUG

/// The branches decision-54 added, plus the seven decision-55 added (six classifications of
/// a scanned card, and the reassign), one case each. Named after what the OPERATOR does, not
/// after which endpoint gets mocked, because the button carries this label.
enum OperatorMockFlow: String, CaseIterable, Identifiable {
    case writeThenPickBuilding
    case writeThenSkipBuilding
    case bindUnboundZone
    case verifyBoundZone
    case unbindBoundZone
    case unbindZoneWithShifts
    case scanBoundZone
    case scanUnboundZone
    case scanBuildingCard
    case scanRetiredCard
    case scanReportedCard
    case scanUnknownCard
    case reassignBuilding

    var id: String { rawValue }

    /// The SIX kinds GET /operator/tags/:id can answer with, one scenario each (decision-55
    /// §1 names five kinds; "zone" splits in the UI into bound and unbound, which is the
    /// whole reason it feeds the existing screen instead of a new one). nil for the scenarios
    /// that never scan a stranger's card.
    var classifiedKind: String? {
        switch self {
        case .scanBoundZone, .scanUnboundZone: return "zone"
        case .scanBuildingCard: return "building"
        case .scanRetiredCard: return "retired"
        case .scanReportedCard: return "tag_reported"
        case .scanUnknownCard: return "unknown"
        default: return nil
        }
    }

    var label: String {
        switch self {
        case .writeThenPickBuilding: return "Mock: write, then pick a building"
        case .writeThenSkipBuilding: return "Mock: write, then skip the building"
        case .bindUnboundZone: return "Mock: bind an unbound zone"
        case .verifyBoundZone: return "Mock: verify a bound zone, then its zone page"
        case .unbindBoundZone: return "Mock: unbind a bound zone (works)"
        case .unbindZoneWithShifts: return "Mock: unbind a zone somebody clocked in at (refused)"
        case .scanBoundZone: return "Mock: scan a card - a bound zone"
        case .scanUnboundZone: return "Mock: scan a card - an unbound zone"
        case .scanBuildingCard: return "Mock: scan a card - a building card"
        case .scanRetiredCard: return "Mock: scan a card - a retired zone"
        case .scanReportedCard: return "Mock: scan a card - reported, not a zone yet"
        case .scanUnknownCard: return "Mock: scan a card - not one of ours"
        case .reassignBuilding: return "Mock: move a bound zone to another building"
        }
    }
}

enum OperatorMocks {
    /// Distinctive on purpose, the same way DemoHooks' marker is: a Release binary that
    /// contains this string has a broken `#if DEBUG` somewhere.
    static let marker = "TSOperatorMockFlowArmed"

    /// nil means LIVE. Set by the debug section on either screen and cleared by it.
    static private(set) var active: OperatorMockFlow?

    /// Non-nil only while a scan is being mocked, so the write flow (which never scans)
    /// cannot accidentally arm the radio mock.
    /// The SCAN-FIRST scenarios each need one too, and WHICH id they hand back is what makes
    /// the six branches different runs of the same code: the classification below is keyed
    /// off the armed scenario, not off the id, because a simulator has no card to read it
    /// from.
    static var scannedPlaceId: String? {
        switch active {
        case .verifyBoundZone, .scanBoundZone: return boundZoneId
        case .scanUnboundZone: return unboundZoneId
        case .scanBuildingCard: return locations[0].id
        case .scanRetiredCard: return retiredZoneId
        case .scanReportedCard: return reportedOnlyTagId
        case .scanUnknownCard: return strangerTagId
        default: return nil
        }
    }

    /// GET /operator/tags/:id. `zone` is attached ONLY for the zone kinds, exactly as the
    /// route does - a canned body that always carried one would let a screen bug that ignores
    /// `kind` pass.
    static func classification(id: String) -> WireTagClassification {
        let kind = active?.classifiedKind ?? "unknown"
        guard kind == "zone" else { return WireTagClassification(kind: kind, zone: nil) }
        return WireTagClassification(kind: kind, zone: zones.first { $0.id == id } ?? zones[1])
    }

    /// POST /operator/zones/:id/reassign-building. The refusal is canned for a zone with no
    /// building because the screen must not offer the action there at all - if this ever
    /// throws in a walk-through, the button appeared somewhere it should not have.
    static func reassigned(zoneId: String, newTagId: String, locationId: String) throws -> WireReassignedZone {
        guard zones.first(where: { $0.id == zoneId })?.locationId != nil else {
            throw APIFailure(status: 409, code: "zone_unbound")
        }
        let fresh = WireOperatorZone(
            id: newTagId, locationId: locationId, locationName: nil,
            name: "Haupteingang (mock)", tagSerial: nil, tagDeployedAt: Date(), verifiedAt: nil)
        return WireReassignedZone(zone: fresh, retiredZoneId: zoneId)
    }

    /// `POST /operator/zones/:id/unbind`, both answers - and WHICH answer is decided by the
    /// armed scenario, not by the zone, because the difference lives in shift rows this side
    /// has never seen. The refusal is a composite FK in migration 013; it needs a real shift
    /// to trigger, so without a canned 409 the one branch that has to render as a sentence
    /// rather than a code would be unreachable on a simulator.
    static func unboundZone(zoneId: String) throws -> WireCreatedZone {
        if active == .unbindZoneWithShifts {
            throw APIFailure(status: 409, code: "zone_has_shifts")
        }
        return WireCreatedZone(id: zoneId, locationId: nil, name: "Haupteingang (mock)")
    }

    static func arm(_ flow: OperatorMockFlow?) {
        active = flow
        if flow != nil { print("[\(marker)] \(flow!.rawValue)") }
    }

    // MARK: - Canned rows

    static let locations: [WireOperatorLocation] = [
        WireOperatorLocation(id: "11111111-1111-4111-8111-111111111111", name: "Musterhaus Wien 3"),
        WireOperatorLocation(id: "22222222-2222-4222-8222-222222222222", name: "Musterhaus Wien 9"),
    ]

    static let unboundZoneId = "33333333-3333-4333-8333-333333333333"
    static let boundZoneId = "44444444-4444-4444-8444-444444444444"
    /// Three cards that are NOT in the worklist and never can be: a zone that a reassignment
    /// retired, a card reported and left undecided, and a stranger's. They exist only as ids
    /// a scan can produce, which is precisely the case decision-55 §1 was written for.
    static let retiredZoneId = "55555555-5555-4555-8555-555555555555"
    static let reportedOnlyTagId = "66666666-6666-4666-8666-666666666666"
    static let strangerTagId = "77777777-7777-4777-8777-777777777777"

    /// One of each state the worklist can now hold (decision-54 §1): a zone with no building
    /// at all, and a bound one that is scannable.
    static let zones: [WireOperatorZone] = [
        WireOperatorZone(id: unboundZoneId, locationId: nil, locationName: nil,
                         name: "Stiege 2 (mock, unbound)", tagSerial: nil,
                         tagDeployedAt: nil, verifiedAt: nil),
        WireOperatorZone(id: boundZoneId, locationId: locations[0].id, locationName: locations[0].name,
                         name: "Haupteingang (mock)", tagSerial: nil,
                         tagDeployedAt: nil, verifiedAt: nil),
    ]

    static func reportedTag(id: String) -> WireReportedTag {
        WireReportedTag(id: id, reportedAt: Date(), resolvedAt: nil)
    }

    /// ECHOES what the screen sent, rather than deciding for it: that is what makes the two
    /// write scenarios genuinely different runs of the same code and not two canned endings.
    /// Skip really does come back unbound, because the screen really did send no building.
    static func createdZone(name: String, locationId: String?) -> WireCreatedZone {
        WireCreatedZone(id: unboundZoneId, locationId: locationId, name: name)
    }

    static func boundZone(zoneId: String, locationId: String) -> WireCreatedZone {
        WireCreatedZone(id: zoneId, locationId: locationId, name: "Stiege 2 (mock, unbound)")
    }

    /// `alreadyVerified: false` - the interesting ending, the one that stamps the door and
    /// opens the zone page. The re-scan wording is a one-field difference and is not worth a
    /// fifth scenario.
    static func verifyResult(zoneId: String) -> WireZoneVerifyResult {
        WireZoneVerifyResult(id: zoneId, name: "Haupteingang (mock)",
                             locationId: locations[0].id, locationName: locations[0].name,
                             verifiedAt: Date(), alreadyVerified: false)
    }

    /// Three shifts over two pages of two. See this file's header for why `totalMinutes` is
    /// 195 and not 150.
    static func shiftsPage(page: Int) -> WireZoneShiftsPage {
        let day = Calendar.current.startOfDay(for: Date())
        let all: [WireZoneShift] = [
            WireZoneShift(workerId: 1, workerName: "Ana M.",
                          startTime: day.addingTimeInterval(6 * 3600),
                          endTime: day.addingTimeInterval(7 * 3600), durationMinutes: 60),
            WireZoneShift(workerId: 2, workerName: "Boris K.",
                          startTime: day.addingTimeInterval(9 * 3600),
                          endTime: day.addingTimeInterval(10.5 * 3600), durationMinutes: 90),
            // Still running: no end time, duration is the time so far. The row shape the
            // zone page words differently, and the only one a canned page can prove.
            WireZoneShift(workerId: 3, workerName: "Clara T.",
                          startTime: day.addingTimeInterval(13 * 3600),
                          endTime: nil, durationMinutes: 45),
        ]
        let pageSize = 2
        let start = max(0, (page - 1) * pageSize)
        let slice = start < all.count ? Array(all[start..<min(all.count, start + pageSize)]) : []
        return WireZoneShiftsPage(shifts: slice, page: page, pageSize: pageSize,
                                  matching: all.count, totalMinutes: 195)
    }

    /// The write outcome a real successful write would hand back, for the two write
    /// scenarios: the id is a fresh uuid so `reportTag` and `resolveZone` see the same shape
    /// they would in the field, and `.blank` because a mocked card was never occupied.
    static func writtenOutcome(id: String) -> TagWriter.Outcome {
        .written(locationId: id,
                 uri: TagLink.uriFor(id)?.absoluteString ?? id,
                 bytes: 57, capacity: 492, replaced: .blank)
    }
}

#endif
