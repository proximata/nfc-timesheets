//
//  OperatorZoneCache.swift
//  NFCTimeSheets
//
//  The last successful GET /operator/zones answer, verbatim - mirrors
//  android/.../nfc/OperatorZoneCache.kt (decision-47 §6.4).
//
//  WHY THIS EXISTS. Picking a zone off the worklist is the first step of the test scan,
//  and it has to work with the card already in hand: an operator standing in a stairwell
//  in front of the door they just mounted a card at is exactly the phone with no signal,
//  and a picker that needs a fresh network round trip to open is a picker that cannot be
//  used at the one moment it is needed.
//
//  RE-ENCODED THROUGH THE SAME Wire.encoder/decoder THE LIVE CALL USES, not a second
//  hand-written cache format - the scar core/Wire.kt's own header names for a camelCase
//  reinvention of the wire contract, avoided here the same way.
//
//  A STALE LIST IS A LABEL, NEVER A GATE. Nothing downstream trusts `verifiedAt` read from
//  here for anything but display: VerifyZoneScreen always resolves the card through the
//  live server (`POST .../verify`), so a cache that is a day old can show the wrong status
//  text but can never stamp the wrong zone or skip a check.
//

import Foundation

enum OperatorZoneCache {
    private static let key = "operator.zones.json"

    /// Persist the exact list just fetched.
    static func write(_ zones: [WireOperatorZone]) {
        guard let data = try? Wire.encoder.encode(zones) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    /// The last cached worklist, or empty if never fetched.
    static func read() -> [WireOperatorZone] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let zones = try? Wire.decoder.decode([WireOperatorZone].self, from: data)
        else { return [] }
        return zones
    }
}
