// Runnable check: the byte encoder and its refusals. No test framework, no Xcode.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/Branding.swift NFCTimeSheets/TagLink.swift NFCTimeSheets/NdefTag.swift \
//       checks/ndef-tag-check.swift \
//     > /tmp/ndef-tag-check.swift && swift /tmp/ndef-tag-check.swift
//
// This is safety-critical in the way nothing else in this app is: wrong bytes here ruin a
// physical card mounted to a building. Every negative case below is something that WOULD
// reach a real tag if this file regressed - each one was run red (by temporarily loosening
// the guard it pins) before being committed green.

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

let uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
let uri = "https://\(TagLink.host)/t?l=\(uuid)"

// --- the exact byte layout, pinned against the Kotlin corpus's own comment ------------
// D1 01 <len> 55 04 <"<host>/t?l=<uuid>" as UTF-8>
let bytes = NdefTag.message(uri: uri)
check(bytes != nil, "a well-formed https uri encodes")
let rest = Array(uri.dropFirst(8).utf8) // scheme stripped
let payloadLength = 1 + rest.count
check(bytes?[0] == 0xD1, "header: MB|ME|SR|TNF=1 = 0xD1, got \(bytes.map { String(format: "%02x", $0[0]) } ?? "nil")")
check(bytes?[1] == 0x01, "type length is 1")
check(bytes?[2] == UInt8(payloadLength), "payload length byte matches the actual payload")
check(bytes?[3] == 0x55, "type is 'U', never 'T'")
check(bytes?[4] == 0x04, "payload[0] is the https:// abbreviation 0x04")
check(bytes?.count == 4 + payloadLength, "no trailing bytes, no missing ones")
check(Array(bytes![5...]) == rest, "the scheme is stripped, nothing else is touched")

// --- the round trip -------------------------------------------------------------------
check(NdefTag.uriFrom(bytes) == uri, "decoding our own encoding returns the exact uri back")

// --- message(uri:) refusals ------------------------------------------------------------
check(NdefTag.message(uri: nil) == nil, "nil uri refused")
check(NdefTag.message(uri: "") == nil, "empty uri refused")
check(NdefTag.message(uri: "http://\(TagLink.host)/t?l=\(uuid)") == nil, "not-https refused (we only ever WRITE https)")
check(NdefTag.message(uri: "https://") == nil, "empty remainder after the scheme refused")
check(NdefTag.message(uri: "https://ex ample.com/ä") == nil, "non-ASCII-printable byte refused")
check(NdefTag.message(uri: "HTTPS://\(TagLink.host)/t?l=\(uuid)") != nil, "scheme match is case-insensitive")

// --- uriFrom(_:) refusals: everything here is a way a foreign or damaged card could ----
// --- otherwise be misread as one of ours ------------------------------------------------
check(NdefTag.uriFrom(nil) == nil, "nil message refused")
check(NdefTag.uriFrom([]) == nil, "empty message refused")
check(NdefTag.uriFrom([0xD1, 0x01, 0x05, 0x55, 0x04, 0x61, 0x62, 0x63]) == nil,
      "payload length lying about the actual byte count is refused, not clamped")

/// `bytes`, with byte `index` replaced by the result of `transform`. Every negative case
/// below flips exactly one thing this app polices and nothing else, so a failure here
/// points at the one rule that broke.
func mutated(_ index: Int, _ transform: (UInt8) -> UInt8) -> [UInt8] {
    var b = bytes!
    b[index] = transform(b[index])
    return b
}

check(NdefTag.uriFrom(mutated(0) { $0 ^ 0x80 }) == nil, "MB cleared (not the first record) refused")
check(NdefTag.uriFrom(mutated(0) { $0 ^ 0x40 }) == nil, "ME cleared (more records follow) refused")
check(NdefTag.uriFrom(mutated(0) { $0 ^ 0x20 }) == nil, "CF (chunked) set is refused")
check(NdefTag.uriFrom(mutated(0) { $0 ^ 0x10 }) == nil, "SR cleared (long form - not what we write) refused")
check(NdefTag.uriFrom(mutated(0) { $0 ^ 0x08 }) == nil, "IL set (has an ID field) refused")
check(NdefTag.uriFrom(mutated(1) { _ in 2 }) == nil, "type length != 1 refused")
check(NdefTag.uriFrom(mutated(3) { _ in 0x54 }) == nil, "type 'T' (Text) refused, not silently accepted")
check(NdefTag.uriFrom(bytes! + [0x00]) == nil, "one trailing byte refused - EXACT length or nothing")
check(NdefTag.uriFrom(Array(bytes!.dropLast())) == nil, "truncated message refused")
check(NdefTag.uriFrom(mutated(4) { _ in 0x05 }) == nil,
      "an abbreviation code outside the five we write is refused, not guessed")

// The five prefixes we are willing to DECODE - not the full 36-entry NFC Forum table.
let prefixVectors: [(UInt8, String)] = [
    (0x00, ""), (0x01, "http://www."), (0x02, "https://www."), (0x03, "http://"), (0x04, "https://"),
]
for (code, prefix) in prefixVectors {
    let msg: [UInt8] = [0xD1, 0x01, 0x04, 0x55, code, 0x61, 0x62, 0x63] // "abc"
    check(NdefTag.uriFrom(msg) == prefix + "abc", "prefix 0x0\(code) decodes to \(prefix)")
}

// --- the record-level decode CoreNFC's own parsing hands us ----------------------------
let decodedGood = [NdefTag.DecodedRecord(typeNameFormatRaw: 0x01, type: [0x55], identifier: [], payload: [0x04] + rest)]
check(NdefTag.uriFrom(records: decodedGood) == uri, "records-level decode agrees with the byte-level one")
check(NdefTag.uriFrom(records: nil) == nil, "nil records refused")
check(NdefTag.uriFrom(records: []) == nil, "empty records refused")
check(NdefTag.uriFrom(records: decodedGood + decodedGood) == nil, "more than one record refused")
check(NdefTag.uriFrom(records: [NdefTag.DecodedRecord(typeNameFormatRaw: 0x02, type: [0x55], identifier: [], payload: [0x04, 0x61])]) == nil,
      "TNF other than Well-Known refused")
check(NdefTag.uriFrom(records: [NdefTag.DecodedRecord(typeNameFormatRaw: 0x01, type: [0x54], identifier: [], payload: [0x04, 0x61])]) == nil,
      "type other than 'U' refused")
check(NdefTag.uriFrom(records: [NdefTag.DecodedRecord(typeNameFormatRaw: 0x01, type: [0x55], identifier: [0x01], payload: [0x04, 0x61])]) == nil,
      "a non-empty identifier field refused")
check(NdefTag.uriFrom(records: [NdefTag.DecodedRecord(typeNameFormatRaw: 0x01, type: [0x55], identifier: [], payload: [])]) == nil,
      "empty payload refused")

// --- reencodeShortWellKnownURI: the pure re-serialiser TagWriter's read-back uses -------
check(NdefTag.reencodeShortWellKnownURI(payload: [0x04] + rest) == bytes,
      "reconstructing from the payload alone matches message(uri:) exactly")
check(NdefTag.reencodeShortWellKnownURI(payload: []) == nil, "empty payload cannot be reencoded")

// --- the write decision: order and refusals ---------------------------------------------
let goodPlan = NdefTag.plan(locationId: uuid, capacity: 999, writable: true)
if case .write(let planBytes, let planUri, let planId) = goodPlan {
    check(planBytes == bytes, "plan() produces the exact bytes message(uri:) would")
    check(planUri == uri, "plan() mints the current-host uri")
    check(planId == uuid, "plan() returns the normalised id")
} else {
    check(false, "a writable, big-enough, well-formed id must plan to WRITE")
}

if case .badId = NdefTag.plan(locationId: "not-a-uuid", capacity: 999, writable: true) {} else {
    check(false, "a malformed id is refused as badId")
}
if case .badId = NdefTag.plan(locationId: nil, capacity: 999, writable: true) {} else {
    check(false, "a nil id is refused as badId")
}

// CAPACITY IS A REFUSAL, NOT A WARNING. The tag mounted at HOIV holds 46 bytes; this
// message needs more than that - this is the exact case that has occurred in the field.
if case .tooSmall(let needed, let capacity) = NdefTag.plan(locationId: uuid, capacity: 46, writable: true) {
    check(needed == bytes!.count, "tooSmall reports the real byte count needed")
    check(capacity == 46, "tooSmall echoes the tag's own capacity")
} else {
    check(false, "a 46-byte tag (the HOIV case) must be refused as tooSmall, not written")
}

// ORDER MATTERS: a locked tag reports READ-ONLY even when it is ALSO too small, so the
// operator is not sent to fetch a bigger tag that would hit the same wall.
if case .readOnly = NdefTag.plan(locationId: uuid, capacity: 4, writable: false) {} else {
    check(false, "writable is checked BEFORE capacity - a locked+small tag must say readOnly")
}
if case .notWritable = NdefTag.plan(locationId: uuid, capacity: 0, writable: true) {} else {
    check(false, "zero capacity on an otherwise-writable tag is notWritable")
}

// --- the read-back verdict ---------------------------------------------------------------
check(NdefTag.verified(written: bytes!, readBack: bytes!), "identical bytes verify")
check(!NdefTag.verified(written: bytes!, readBack: nil), "a nil read-back (tag moved, field dropped) is NEVER 'probably fine'")
check(!NdefTag.verified(written: bytes!, readBack: bytes! + [0x00]), "one extra byte fails verification")
check(!NdefTag.verified(written: bytes!, readBack: Array(bytes!.dropLast())), "one missing byte fails verification")

check(NdefTag.hex([0xDE, 0xAD, 0xBE, 0xEF]) == "de ad be ef", "hex is lowercase, space-separated")

print("ndef-tag-check: OK")
