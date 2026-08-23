//
//  NdefTag.swift
//  NFCTimeSheets
//
//  THE BYTES THAT GO ONTO A PHYSICAL CARD, and the three refusals that must happen before
//  they do. A faithful port of android/.../core/NdefTag.kt (decision-49) - same header
//  byte, same five accepted prefixes, same "capacity is a refusal, not a warning" rule.
//
//  WHY THIS IS PURE FOUNDATION, LIKE TagLink.swift. [message] and [uriFrom] are exercised
//  by checks/ndef-tag-check.swift on a laptop, with no tag, no phone and no CoreNFC
//  entitlement. TagWriter.swift still hands the sliced type/payload to CoreNFC's own
//  `NFCNDEFPayload` before writing, so the platform gets the last word on what actually
//  reaches the tag - it just does not get to choose the bytes.
//
//  THE SHAPE, fixed by NFC Forum RTD-URI and by what already works on the wall:
//
//      D1 01 3C 55 04 <"<tag host>/t?l=<uuid>" as UTF-8, scheme stripped>
//      ^  ^  ^  ^  ^
//      |  |  |  |  +-- payload[0]: URI abbreviation 0x04 = "https://"
//      |  |  |  +----- type: 'U' (0x55). NEVER 'T' (0x54): a Text record carries no URL,
//      |  |  |         so the OS has nothing to match a universal link against.
//      |  |  +-------- payload length, short form
//      |  +----------- type length (1)
//      +-------------- MB|ME|SR|TNF=1: first record, last record, short record, Well Known.
//
//  ONE RECORD, AND NOTHING AFTER IT. [uriFrom] refuses trailing bytes rather than ignoring
//  them, because "the reader ignored it" is how a tag reads as valid to us and as something
//  else to the next reader.
//
//  CAPACITY IS A REFUSAL, NOT A WARNING. The first adopted tag in the field holds 46 bytes
//  and our message needs ~64 - this is a case that HAS occurred, not a hypothetical. See
//  [Plan] and `TagWriter.swift`'s five-step order for where that refusal happens: BEFORE
//  any byte is written.
//
//  ONE DIVERGENCE FROM THE KOTLIN FILE, forced by the platform and not by choice: CoreNFC's
//  `NFCNDEFMessage` exposes only `records` and `length`, never the raw bytes it would write
//  or the bytes it read - there is no `toByteArray()` equivalent. So this file adds
//  [DecodedRecord] and a records-based [uriFrom(records:)], used by WriteGuard.swift and
//  TagWriter.swift to interpret what CoreNFC already parsed for us, alongside the
//  byte-level [uriFrom(_:)] this file shares with the Kotlin corpus for the pure
//  encode/decode round trip. Both decoders apply the SAME five-entry prefix table and the
//  same "exactly one record, no ID field, Well-Known 'U'" rule - only the input shape
//  differs.
//

import Foundation

enum NdefTag {
    /// URI abbreviation code 0x04 - "https://". The only prefix we ever WRITE.
    private static let prefixHTTPS: UInt8 = 0x04

    /// RTD type byte 'U'.
    static let typeURI: UInt8 = 0x55

    /// Record header bits.
    private static let flagMB: UInt8 = 0x80
    private static let flagME: UInt8 = 0x40
    private static let flagCF: UInt8 = 0x20
    private static let flagSR: UInt8 = 0x10
    private static let flagIL: UInt8 = 0x08
    private static let tnfMask: UInt8 = 0x07
    static let tnfWellKnown: UInt8 = 0x01

    /// The abbreviations we are willing to DECODE. Deliberately not the full 36-entry
    /// table: every entry is a way for two readers to disagree about what a card says, and
    /// we only ever write one of them. An unknown code is refused, not guessed.
    private static let prefixes: [UInt8: String] = [
        0x00: "",
        0x01: "http://www.",
        0x02: "https://www.",
        0x03: "http://",
        0x04: "https://",
    ]

    /// Short-record payload ceiling. Our message is ~64 bytes; this can only fire on a bug.
    private static let maxShortPayload = 255

    // MARK: - encode

    /// The complete NDEF message for an `https://` URI, or nil if it cannot be encoded in
    /// the one shape this app writes. Nil, never a partial or a fallback encoding: the
    /// caller's only correct response to "I cannot encode this" is to refuse the write.
    static func message(uri: String?) -> [UInt8]? {
        guard let uri, !uri.isEmpty else { return nil }
        guard uri.lowercased().hasPrefix("https://") else { return nil }
        let rest = String(uri.dropFirst(8))
        guard !rest.isEmpty else { return nil }
        // A non-ASCII byte is not wrong per RTD-URI, but it is not something we mint, and a
        // card is the wrong place to discover an encoding disagreement.
        guard rest.utf8.allSatisfy({ (0x21...0x7E).contains($0) }) else { return nil }

        let restBytes = Array(rest.utf8)
        let payloadLength = 1 + restBytes.count
        guard payloadLength <= maxShortPayload else { return nil }

        var out = [UInt8](repeating: 0, count: 4 + payloadLength)
        out[0] = flagMB | flagME | flagSR | tnfWellKnown
        out[1] = 1 // type length
        out[2] = UInt8(payloadLength)
        out[3] = typeURI
        out[4] = prefixHTTPS
        out.replaceSubrange(5..<out.count, with: restBytes)
        return out
    }

    // MARK: - decode (byte-level, the pure encode/decode round trip)

    /// The URI in a single-record NDEF URI message, or nil.
    ///
    /// STRICT ON PURPOSE. This is what [plan]'s own round trip is checked through: one
    /// Well Known 'U' record, short form, no ID field, no chunking, nothing before it and
    /// nothing after it.
    static func uriFrom(_ message: [UInt8]?) -> String? {
        guard let message, message.count >= 5 else { return nil }

        let header = message[0]
        if header & flagMB == 0 { return nil } // not the first record
        if header & flagME == 0 { return nil } // more records follow
        if header & flagCF != 0 { return nil } // chunked
        if header & flagSR == 0 { return nil } // long form: not what we write
        if header & flagIL != 0 { return nil } // has an ID field
        if header & tnfMask != tnfWellKnown { return nil }

        let typeLength = message[1]
        if typeLength != 1 { return nil }
        let payloadLength = Int(message[2])
        if payloadLength < 1 { return nil }
        if message[3] != typeURI { return nil } // 'T' (Text) lands here

        // EXACT: 4 header bytes + payload and not one byte more.
        if message.count != 4 + payloadLength { return nil }

        guard let prefix = prefixes[message[4]] else { return nil }
        let rest = String(decoding: message[5...], as: UTF8.self)
        return prefix + rest
    }

    // MARK: - decode (record-level, what CoreNFC hands back)

    /// The logical contents of one `NFCNDEFPayload`, carried as plain Foundation types so
    /// this file stays free of `import CoreNFC` - TagWriter.swift does the mapping.
    /// `typeNameFormatRaw` is the raw NFC Forum TNF byte; CoreNFC's `NFCTypeNameFormat`
    /// enum is documented to use these exact values (0x00-0x06).
    struct DecodedRecord {
        let typeNameFormatRaw: UInt8
        let type: [UInt8]
        let identifier: [UInt8]
        let payload: [UInt8]

        init(typeNameFormatRaw: UInt8, type: [UInt8], identifier: [UInt8], payload: [UInt8]) {
            self.typeNameFormatRaw = typeNameFormatRaw
            self.type = type
            self.identifier = identifier
            self.payload = payload
        }
    }

    /// The URI carried by a CoreNFC-decoded message, under the SAME strict rule
    /// [uriFrom(_:)] applies to raw bytes: exactly one record, Well Known, type 'U', no ID
    /// field. CoreNFC has already stripped away the short/long-form and chunking questions
    /// for us, so this only re-checks the parts that are still ours to police.
    static func uriFrom(records: [DecodedRecord]?) -> String? {
        guard let records, records.count == 1 else { return nil }
        let record = records[0]
        guard record.typeNameFormatRaw == tnfWellKnown else { return nil }
        guard record.identifier.isEmpty else { return nil }
        guard record.type == [typeURI] else { return nil }
        guard !record.payload.isEmpty else { return nil }
        guard let prefix = prefixes[record.payload[0]] else { return nil }
        let rest = String(decoding: record.payload[1...], as: UTF8.self)
        return prefix + rest
    }

    /// Reconstructs the exact bytes [message(uri:)] would have produced for a
    /// single-record, short-form, Well-Known 'U' message carrying [payload] - i.e. the
    /// header this app always writes, rebuilt from a CoreNFC read-back instead of from a
    /// URI string. This is the "pure re-serialiser" TagWriter.swift's read-back compare
    /// runs: CoreNFC exposes no raw bytes for a message it read or wrote (see this file's
    /// header), so byte equality is proven by reconstructing both sides through the ONE
    /// encoder this app has, rather than by asking CoreNFC for bytes it does not have.
    static func reencodeShortWellKnownURI(payload: [UInt8]) -> [UInt8]? {
        guard !payload.isEmpty, payload.count <= maxShortPayload else { return nil }
        var out = [UInt8](repeating: 0, count: 4 + payload.count)
        out[0] = flagMB | flagME | flagSR | tnfWellKnown
        out[1] = 1
        out[2] = UInt8(payload.count)
        out[3] = typeURI
        out.replaceSubrange(4..<out.count, with: payload)
        return out
    }

    // MARK: - the write decision

    /// What a tag presented to the writer is: bytes to write, or a named refusal. Every
    /// refusal is a separate case because the operator's next physical action differs.
    enum Plan {
        /// `bytes` is exactly what goes on the card. Nothing recomputes it downstream.
        case write(bytes: [UInt8], uri: String, locationId: String)
        /// The tag holds fewer bytes than the message needs. The 46-byte case.
        case tooSmall(needed: Int, capacity: Int)
        /// Locked by a previous owner. Unlocked is our own policy (decision-15), not theirs.
        case readOnly
        /// No NDEF at all, and CoreNFC exposes no way to format one from this API.
        case notWritable
        /// We could not encode a message for this id at all - a bug, surfaced not swallowed.
        case badId
    }

    /// Decide, from facts read off the tag and BEFORE any write.
    ///
    /// THERE IS NO `uri` PARAMETER, AND THAT IS THE DESIGN (see NdefTag.kt's own header for
    /// the '+'-trap history behind this). The URI is MINTED here from [TagLink.uriFor],
    /// which always uses the current tag host and never a legacy one.
    ///
    /// AND THE BYTES GO BACK THROUGH THE PARSER BEFORE THEY GO ONTO THE CARD: [uriFrom(_:)]
    /// of the exact array about to be written, fed to the same [TagLink.locationId] a tap
    /// uses, must return the same id.
    ///
    /// - Parameters:
    ///   - capacity: the maximum NDEF MESSAGE size in bytes (CoreNFC's
    ///     `queryNDEFStatus` capacity), the same unit as the `bytes` in `.write`.
    ///   - writable: `true` for CoreNFC's `.readWrite` status.
    static func plan(locationId: String?, capacity: Int, writable: Bool) -> Plan {
        guard let raw = locationId, let id = TagLink.normalizedUUID(raw) else { return .badId }
        guard let uri = TagLink.uriFor(id)?.absoluteString else { return .badId }
        guard let bytes = message(uri: uri) else { return .badId }
        // The round trip, on the bytes themselves. Not on the string they came from.
        guard let decodedUri = uriFrom(bytes),
              let decodedURL = URL(string: decodedUri),
              TagLink.locationId(from: decodedURL) == id
        else { return .badId }
        // Order matters: a locked tag reports LOCKED even when it is also too small, so the
        // operator is not sent to fetch a bigger tag that would hit the same wall.
        if !writable { return .readOnly }
        if capacity <= 0 { return .notWritable }
        if capacity < bytes.count { return .tooSmall(needed: bytes.count, capacity: capacity) }
        return .write(bytes: bytes, uri: uri, locationId: id)
    }

    // MARK: - the read-back

    /// Did the card come back holding EXACTLY what we wrote? Byte equality, not "does it
    /// parse" and not "does it contain the uuid". `nil` readBack (the tag moved, the field
    /// dropped, the read failed) is a FAILURE, never "probably fine".
    static func verified(written: [UInt8], readBack: [UInt8]?) -> Bool {
        guard let readBack else { return false }
        return written == readBack
    }

    /// Lowercase hex, for the check output and for the diagnostic line in the app.
    static func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined(separator: " ")
    }
}
