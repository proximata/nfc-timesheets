//
//  Zones.swift
//  NFCTimeSheets
//
//  Pure decision logic for the operator's test scan (decision-47, decision-44), ported
//  from android/.../core/Zones.kt's `normaliseSerial` only - the rest of that file is
//  Android's own roster/building-resolution logic and has no iOS counterpart yet.
//
//  ONE COPY. A second hand-written serial normaliser is exactly the scar TagLink's
//  '+'-vs-space case already left in this codebase once (see TagLink.swift's header).
//

import Foundation

enum Zones {
    /// Uppercase hex, colon-separated - the shape the server's `zones.tag_serial` column
    /// holds, and the shape a hardware UID has to be normalised into on BOTH sides before
    /// they can be compared. No serial ever travels TOWARDS the server (decision-44): this
    /// is used only to match a scanned UID against the worklist already on the phone.
    static func normaliseSerial(_ serial: String?) -> String? {
        guard let serial else { return nil }
        let cleaned = serial.uppercased().filter { $0.isHexDigit }
        guard !cleaned.isEmpty else { return nil }
        var chunks: [String] = []
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let end = cleaned.index(index, offsetBy: 2, limitedBy: cleaned.endIndex) ?? cleaned.endIndex
            chunks.append(String(cleaned[index..<end]))
            index = end
        }
        return chunks.joined(separator: ":")
    }
}
