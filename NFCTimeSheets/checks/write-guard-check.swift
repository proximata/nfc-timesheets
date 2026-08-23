// Runnable check: the overwrite guard (TASK-220, decision-49). No test framework, no Xcode.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/Branding.swift NFCTimeSheets/TagLink.swift NFCTimeSheets/NdefTag.swift \
//       NFCTimeSheets/WriteGuard.swift checks/write-guard-check.swift \
//     > /tmp/write-guard-check.swift && swift /tmp/write-guard-check.swift
//
// WHAT WENT WRONG WITHOUT THIS FILE (TASK-220): a card already carrying one of our
// location ids was overwritten with the id the write screen happened to be offering, and
// the screen reported success. Every case below is a way that could still happen if this
// file regressed.

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

let ourId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
let otherId = "6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d"

func recordsFor(uri: String) -> [NdefTag.DecodedRecord] {
    let bytes = NdefTag.message(uri: uri)!
    return [NdefTag.DecodedRecord(typeNameFormatRaw: 0x01, type: [0x55], identifier: [], payload: Array(bytes[4...]))]
}

// --- classify: blank -------------------------------------------------------------------
check(WriteGuard.classify(records: nil) == .blank, "no NDEF message at all is blank")
check(WriteGuard.classify(records: []) == .blank, "an empty records array is blank")

// --- classify: ours ----------------------------------------------------------------------
let ourUri = "https://\(TagLink.host)/t?l=\(ourId)"
check(WriteGuard.classify(records: recordsFor(uri: ourUri)) == .ours(locationId: ourId),
      "a card carrying one of our ids classifies as ours")

// --- classify: foreign -------------------------------------------------------------------
check(WriteGuard.classify(records: recordsFor(uri: "https://evil.example.com/t?l=\(ourId)")) != .ours(locationId: ourId),
      "the WRONG HOST is never ours, even carrying a well-formed uuid")
let textRecord = [NdefTag.DecodedRecord(typeNameFormatRaw: 0x01, type: [0x54], identifier: [], payload: [0x00, 0x61])]
if case .foreign = WriteGuard.classify(records: textRecord) {} else {
    check(false, "a Text record (someone else's tag) classifies as foreign, never blank")
}
let twoRecords = recordsFor(uri: ourUri) + recordsFor(uri: ourUri)
if case .foreign = WriteGuard.classify(records: twoRecords) {} else {
    check(false, "more than one record - not our shape - classifies as foreign even if record 1 is ours")
}

// --- decide: blank and foreign write with no question asked -----------------------------
if case .proceed = WriteGuard.decide(existing: .blank, offered: otherId) {} else {
    check(false, "a blank card always proceeds")
}
if case .proceed = WriteGuard.decide(existing: .foreign(summary: "x"), offered: otherId) {} else {
    check(false, "a foreign card proceeds - overwriting it destroys nothing of ours")
}

// --- decide: OURS IS REFUSED, THE TASK-220 CASE ------------------------------------------
let ours = WriteGuard.Existing.ours(locationId: ourId)
if case .occupied(let onTag, let offered, let token) = WriteGuard.decide(existing: ours, offered: otherId) {
    check(onTag == ourId, "occupied names the id ON THE CARD")
    check(offered == otherId, "occupied names what the screen was offering")
    check(token == WriteGuard.token(ourId), "occupied carries the real override token")
} else {
    check(false, "a card holding one of our ids, offered a DIFFERENT id, MUST be refused")
}

// THE RETRY PATH MUST SURVIVE: the SAME id over the SAME card proceeds with no
// confirmation at all - a half-written card must be repairable.
if case .proceed = WriteGuard.decide(existing: ours, offered: ourId) {} else {
    check(false, "re-presenting the SAME id over the SAME card must proceed unconditionally")
}

// --- decide: the confirmation is bound to ONE id, not "something was confirmed" ---------
if case .proceed = WriteGuard.decide(existing: ours, offered: otherId, confirmedFor: ourId) {} else {
    check(false, "confirming the id ON THE CARD authorises the overwrite")
}
let differentCard = WriteGuard.Existing.ours(locationId: otherId)
if case .occupied = WriteGuard.decide(existing: differentCard, offered: ourId, confirmedFor: ourId) {} else {
    check(false, "a confirmation for card A must NOT authorise card B - confirmedFor is checked against the CARD, not remembered")
}
if case .occupied = WriteGuard.decide(existing: ours, offered: otherId, confirmedFor: otherId) {} else {
    check(false, "confirming the WRONG id (e.g. the one being offered) never authorises anything")
}

// --- token / confirms: the six-character override ---------------------------------------
check(WriteGuard.token(ourId) == String(ourId.suffix(6)).lowercased(), "token is the last six characters, lowercased")
check(WriteGuard.token(ourId).count == 6, "the token is exactly six characters")
check(WriteGuard.token(ourId) != String(ourId.prefix(6)).lowercased(),
      "the LAST six, never the first - a tired eye compares the front of two ids")
check(WriteGuard.confirms(locationId: ourId, typed: WriteGuard.token(ourId)), "the correct token confirms")
check(WriteGuard.confirms(locationId: ourId, typed: WriteGuard.token(ourId).uppercased()), "case is forgiven")
check(WriteGuard.confirms(locationId: ourId, typed: "  \(WriteGuard.token(ourId))  "), "surrounding whitespace is forgiven")
check(!WriteGuard.confirms(locationId: ourId, typed: ""), "an empty box never confirms")
check(!WriteGuard.confirms(locationId: ourId, typed: nil), "no input never confirms")
check(!WriteGuard.confirms(locationId: ourId, typed: WriteGuard.token(otherId)),
      "the token for a DIFFERENT id never confirms this one")
// THE OBVIOUS WRONG THING TO COPY: the id being OFFERED is right there on the same
// screen, and typing IT BACK must not accidentally authorise anything.
check(!WriteGuard.confirms(locationId: ourId, typed: otherId), "the OFFERED id itself is not a valid token")
check(WriteGuard.confirms(locationId: ourId, typed: ourId), "the full id also confirms (belt and braces), matching the Kotlin corpus")
check(!WriteGuard.confirms(locationId: nil, typed: "abcdef"), "no card id at all never confirms")

print("write-guard-check: OK")
