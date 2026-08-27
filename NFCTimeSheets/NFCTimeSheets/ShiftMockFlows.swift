//
//  ShiftMockFlows.swift
//  NFCTimeSheets
//
//  THE TWO decision-56 FLOWS, WALKABLE ON A SIMULATOR. Built to OperatorMockFlows.swift's
//  shape, deliberately - read that file's header first; everything it says about the split
//  applies here word for word:
//
//  1. `ShiftFlowAPI` is NOT debug-only. It is the one door Sync.swift's pushOpen/pushClose
//     go through, and in a Release build each method is a one-line passthrough to ShiftAPI
//     with the `#if DEBUG` branch compiled out - no mock symbol, no mock string, no branch
//     to reach.
//
//  2. `ShiftMocks` is entirely inside `#if DEBUG` and holds canned RESPONSES only. It draws
//     no screen and owns no state machine: the debug section ARMS it and the worker then
//     presses the SHIPPING buttons, so what gets walked is the real "Start without a tag"
//     and the real Stop, with the network replaced.
//
//  WHY IT IS NEEDED AT ALL. Both new paths end in a POST, and until TASK-287 ships there is
//  no server that takes `manual: true`; a simulator additionally has no roster unless it can
//  reach a live API. Arming this makes the two confirmations, the picker, the local row, the
//  Live Activity and the flagged pills all reachable on a Mac.
//
//  THE CANNED ROW ECHOES WHAT THE PHONE SENT, rather than deciding for it - same rule as
//  OperatorMocks.createdZone. A close comes back with `corrected_at` stamped because that is
//  what decision-56 §3 says the server does in the SAME update, so a screen that ignored the
//  flag and rendered "needs resolution" would be visibly wrong here.
//

import Foundation

enum ShiftFlowAPI {
    static func open(clientUuid: String, locationId: String, startTime: Date,
                     manual: Bool) async throws -> WireShiftEnvelope
    {
        #if DEBUG
        if ShiftMocks.active != nil {
            return ShiftMocks.opened(clientUuid: clientUuid, locationId: locationId,
                                     startTime: startTime, manual: manual)
        }
        #endif
        return try await ShiftAPI.open(clientUuid: clientUuid, locationId: locationId,
                                       startTime: startTime, manual: manual)
    }

    static func close(clientUuid: String, endTime: Date, autoClosed: Bool,
                      manual: Bool) async throws -> WireShiftEnvelope
    {
        #if DEBUG
        if ShiftMocks.active != nil {
            return ShiftMocks.closed(clientUuid: clientUuid, endTime: endTime,
                                     autoClosed: autoClosed, manual: manual)
        }
        #endif
        return try await ShiftAPI.close(clientUuid: clientUuid, endTime: endTime,
                                        autoClosed: autoClosed, manual: manual)
    }
}

#if DEBUG

/// Named after what the WORKER does, not after which endpoint gets mocked, because the
/// button carries this label. Two scenarios, one per decision-56 §4 bullet.
enum ShiftMockFlow: String, CaseIterable, Identifiable {
    case manualStart
    case manualStop

    var id: String { rawValue }

    /// NOT run through String(localized:) and that is on purpose: these strings never ship,
    /// so translating them would put debug copy in the German catalogue. It is also why
    /// they are a computed property rather than a Text("...") literal - checks/
    /// localisation-check.swift's extractor would otherwise demand a catalogue entry.
    var label: String {
        switch self {
        case .manualStart: return "Mock: the server accepts a manual start"
        case .manualStop: return "Mock: the server accepts a manual stop"
        }
    }
}

enum ShiftMocks {
    /// Distinctive on purpose, the same way DemoHooks' and OperatorMocks' markers are: a
    /// Release binary that contains this string has a broken `#if DEBUG` somewhere.
    static let marker = "TSShiftMockFlowArmed"

    /// nil means LIVE.
    static private(set) var active: ShiftMockFlow?

    static func arm(_ flow: ShiftMockFlow?) {
        active = flow
        if let flow { print("[\(marker)] \(flow.rawValue)") }
    }

    /// A building to pick when there is no reachable roster to cache one from. Merged into
    /// the picker's list ONLY while a mock is armed - it must never reach the SwiftData
    /// `Site` cache, or a scenario walked once would leave a fake building in the picker.
    static let locations: [WireLocation] = [
        WireLocation(id: "11111111-1111-4111-8111-111111111111",
                     slug: "musterhaus-wien-3", name: "Musterhaus Wien 3 (mock)"),
    ]

    static func opened(clientUuid: String, locationId: String, startTime: Date,
                       manual: Bool) -> WireShiftEnvelope
    {
        WireShiftEnvelope(shift: row(clientUuid: clientUuid, locationId: locationId,
                                     startTime: startTime, endTime: nil,
                                     autoClosed: false, correctedAt: nil,
                                     manualStart: manual, manualClose: false),
                          duplicate: false)
    }

    /// `corrected_at` stamped in the SAME response as `manual_close`, because that is what
    /// decision-56 §3 makes the server do - a mock that left it null would let a client bug
    /// that routes manual stops back into the decision-10 resolver pass.
    static func closed(clientUuid: String, endTime: Date, autoClosed: Bool,
                       manual: Bool) -> WireShiftEnvelope
    {
        WireShiftEnvelope(shift: row(clientUuid: clientUuid, locationId: locations[0].id,
                                     startTime: endTime.addingTimeInterval(-3600),
                                     endTime: endTime,
                                     autoClosed: autoClosed,
                                     correctedAt: manual ? endTime : nil,
                                     manualStart: false, manualClose: manual),
                          duplicate: false)
    }

    private static func row(clientUuid: String, locationId: String, startTime: Date,
                            endTime: Date?, autoClosed: Bool, correctedAt: Date?,
                            manualStart: Bool, manualClose: Bool) -> WireShift
    {
        WireShift(id: 900_001, workerId: 1, locationId: locationId,
                  startTime: startTime, endTime: endTime,
                  autoClosed: autoClosed, correctedAt: correctedAt,
                  manualStart: manualStart, manualClose: manualClose,
                  clientUuid: clientUuid, locationSlug: locations[0].slug,
                  locationName: locations[0].name)
    }
}

#endif
