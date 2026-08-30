//
//  EnrolmentCode.swift
//  NFCTimeSheets
//
//  The enrolment code, as the phone sees it (decision-26, decision-45). A MIRROR of
//  server/lib/enrolment.js normaliseCode() and android/.../core/EnrolmentCode.kt, and it
//  must stay one. The server is authoritative — it normalises the string again before it
//  hashes it — so nothing here is a security control. What this buys is the two things
//  the server cannot do from Vienna:
//
//    1. It does not spend one of the operator's few rate-limited attempts on a string
//       that could not possibly be a code. The limiter is LOAD-BEARING on a 100_000-value
//       space (5 failures, then 30s doubling to 15 min), so a fat-fingered paste must not push
//       a tired operator into a lockout at a door.
//    2. It lets the button stay disabled until the input is plausibly a code, which is
//       the only feedback that may safely be given — see OperatorSession.signIn.
//
//  IT MUST NEVER BE MORE PERMISSIVE THAN THE SERVER. If it accepted something the server
//  rejects, the operator gets a lockout instead of an answer. If it normalised something
//  DIFFERENTLY, they would get "code not accepted" for a code that is correct.
//
//  Foundation-only on purpose, same discipline as TagLink.swift and MigrationCore.swift:
//  it must compile and be exercised outside Xcode by a runnable check.
//
//  THE ALPHABET IS DIGITS ONLY — 0123456789, five of them, no dash (decision-63,
//  TASK-319). It used to be 8 characters of Crockford base32 with O->0 and I,L->1 aliased
//  on the way in; with no letters left there is nothing to alias, so THAT STEP IS GONE.
//  Anything that is not a digit is dropped, because people type the hyphen, and spaces,
//  and sometimes a non-breaking space out of a chat app.
//

import Foundation

enum EnrolmentCode {
    /// Canonical length. 10^5 = 100_000; the arithmetic is in server/lib/enrolment.js.
    static let length = 5

    /// Longest input worth looking at, matching the server's cap. Applied to the RAW
    /// string, before separators are stripped, exactly as the server does it.
    static let maxInput = 64

    private static let canonicalPattern = try! NSRegularExpression(pattern: "^[0-9]{5}$")

    /// Whatever was typed -> the canonical 5-digit code, or nil.
    ///
    /// nil is the only failure signal, and the caller must treat it exactly like a
    /// server rejection — no distinction between "too short" and "bad character",
    /// for the same reason the server collapses unknown / expired / already-used /
    /// revoked into one byte-identical 401 (decision-45): any distinction confirms
    /// something about a live code.
    ///
    /// No case folding and no aliasing: the alphabet has no letters left for either to
    /// touch, and the server's own normaliseCode() is now exactly this one strip. ASCII
    /// digits only — `isNumber` alone would also accept Arabic-Indic digits, which the
    /// server's `[^0-9]` strip would delete instead.
    static func normalise(_ input: String) -> String? {
        guard input.count <= maxInput else { return nil }
        var canonical = ""
        canonical.reserveCapacity(input.count)
        for ch in input where ch.isASCII && ch.isNumber {
            canonical.append(ch)
        }
        let range = NSRange(canonical.startIndex..., in: canonical)
        return canonicalPattern.firstMatch(in: canonical, range: range) != nil ? canonical : nil
    }
}
