// Runnable check: the enrolment code as typed by a human (decision-26, decision-63).
//
//   cd NFCTimeSheets && ./checks/run.sh          (or, on its own:)
//   cat NFCTimeSheets/EnrolmentCode.swift checks/enrolment-code-check.swift > /tmp/e.swift && swift /tmp/e.swift
//
// TASK-321: the server moved to five digits and no dash while both phones still validated
// the old 8-character Crockford form, so every real code was refused BEFORE it left the
// handset. There was no iOS check to catch it - Android's core-check.kt had one and this
// is its twin, including the "read the server as source" half, so the next shape change
// cannot pass on one platform and fail on the other.
//
// WHY IT MATTERS THAT THIS IS NOT MERELY COSMETIC: the client must never be MORE PERMISSIVE
// than the server (a lockout instead of an answer) and must never normalise DIFFERENTLY
// (a correct code refused). The limiter allows five attempts.

import Foundation

var failed = false
func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        failed = true
    }
}

let CODE = "73142"

check(EnrolmentCode.normalise(CODE) == CODE, "a canonical code survives untouched")
check(EnrolmentCode.length == 5, "canonical length is five digits")

// What a tired operator actually types, at a door, on a phone keyboard.
for (typed, why) in [
    ("73-142", "a hyphen typed out of habit"),
    ("  73 142  ", "spaces, including leading and trailing"),
    ("73\u{00a0}142", "a non-breaking space pasted out of a chat app"),
    ("73\u{2011}142", "a non-breaking hyphen, same source"),
    ("73_142", "underscore"),
    ("73.142", "full stop"),
    ("73\n142", "a newline from a paste"),
] {
    check(EnrolmentCode.normalise(typed) == CODE, "must forgive (\(why)): [\(typed)]")
}

// NO LETTER ALIASING ANY MORE (decision-63). Turning a typed O into 0 would now
// MANUFACTURE a wrong guess out of a string that is not a code at all.
for (typed, why) in [
    ("", "nothing typed"),
    ("7314", "one short"),
    ("731422", "one long"),
    ("-----", "five separators is zero digits, not five"),
    ("7314!", "punctuation is stripped, leaving four"),
    ("7314\u{00fc}", "a German umlaut is not a digit"),
    ("O3142", "O is no longer aliased to zero"),
    ("I3142", "I is no longer aliased to one"),
    ("l3142", "lower L is no longer aliased to one"),
    ("\u{0663}\u{0663}\u{0663}\u{0663}\u{0663}", "Arabic-Indic digits are not [0-9], as the server's strip has it"),
    (String(repeating: "7", count: EnrolmentCode.maxInput + 1), "longer than the server will even look at"),
] {
    check(EnrolmentCode.normalise(typed) == nil, "must refuse (\(why)): [\(typed)]")
}

// The cap is on INPUT length, exactly as the server applies it, not on real digits.
check(EnrolmentCode.normalise(CODE + String(repeating: " ", count: EnrolmentCode.maxInput - CODE.count)) == CODE,
      "separators may fill the input up to the cap")

// ---------------------------------------------------------------------------------
// The client against the SERVER, read as source. Not against a copy of it.
// ---------------------------------------------------------------------------------
let serverPath = "../server/lib/enrolment.js"
if let js = try? String(contentsOfFile: serverPath, encoding: .utf8) {
    func literal(_ pattern: String) -> String? {
        let re = try! NSRegularExpression(pattern: pattern)
        guard let m = re.firstMatch(in: js, range: NSRange(js.startIndex..., in: js)),
              let r = Range(m.range(at: 1), in: js) else { return nil }
        return String(js[r])
    }
    check(literal(#"const ALPHABET = "([^"]+)""#) == "0123456789",
          "server alphabet is the ten digits and nothing else (decision-63)")
    check(literal(#"const CODE_CHARS = (\d+)"#) == String(EnrolmentCode.length),
          "code length: server vs client \(EnrolmentCode.length)")
    check(literal(#"const MAX_INPUT = (\d+)"#) == String(EnrolmentCode.maxInput),
          "input cap: server vs client \(EnrolmentCode.maxInput)")
    // Every digit the server can issue must normalise as itself, LENGTH at a time.
    for ch in "0123456789" {
        let candidate = String(repeating: ch, count: EnrolmentCode.length)
        check(EnrolmentCode.normalise(candidate) == candidate,
              "the client rejects '\(ch)', which the server can issue")
    }
} else {
    check(false, "\(serverPath) is readable from NFCTimeSheets/")
}

if failed { exit(1) }
print("enrolment-code-check: OK")
