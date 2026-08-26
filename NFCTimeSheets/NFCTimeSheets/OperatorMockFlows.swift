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

/// The four branches decision-54 added, one case each. Named after what the OPERATOR does,
/// not after which endpoint gets mocked, because the button carries this label.
enum OperatorMockFlow: String, CaseIterable, Identifiable {
    case writeThenPickBuilding
    case writeThenSkipBuilding
    case bindUnboundZone
    case verifyBoundZone

    var id: String { rawValue }

    var label: String {
        switch self {
        case .writeThenPickBuilding: return "Mock: write, then pick a building"
        case .writeThenSkipBuilding: return "Mock: write, then skip the building"
        case .bindUnboundZone: return "Mock: bind an unbound zone"
        case .verifyBoundZone: return "Mock: verify a bound zone, then its zone page"
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
    static var scannedPlaceId: String? {
        active == .verifyBoundZone ? boundZoneId : nil
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
