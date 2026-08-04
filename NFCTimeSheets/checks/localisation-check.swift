// Runnable check: the German string catalogue. No test framework, no Xcode.
//
//   cd NFCTimeSheets && swift checks/localisation-check.swift
//
// The default language of this product is German (decision-8) and the crew using the iOS
// app every morning is Austrian. Until now the app had NO localisation at all - no
// .xcstrings, no .lproj, English literals throughout - while the Android app has shipped
// German-by-default since its first commit. This file is what keeps the catalogue honest
// once somebody adds the 113th string.
//
// WHAT THIS CANNOT PROVE, and only Xcode can: that the catalogue's key set still MATCHES
// what the compiler extracts from the source. A new Text("...") with no catalogue entry
// renders its English literal - a silent, harmless-looking regression. To find those:
//
//   xcodebuild -exportLocalizations -project NFCTimeSheets.xcodeproj \
//     -localizationPath /tmp/loc -exportLanguage de
//   # then diff the <source> elements in /tmp/loc/de.xcloc against this catalogue
//
// That is how the 112 keys in the catalogue were produced in the first place: extracted by
// the compiler, never typed by hand, because a mistyped key is invisible.

import Foundation

var failed = false
func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        failed = true
    }
}

let path = "NFCTimeSheets/Localizable.xcstrings"
guard let data = FileManager.default.contents(atPath: path),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let strings = root["strings"] as? [String: Any]
else {
    FileHandle.standardError.write(Data("FAIL: \(path) is missing or is not a string catalogue\n".utf8))
    exit(1)
}

check(root["sourceLanguage"] as? String == "en",
      "the source language is English: the KEYS are the English sentences, so a missing "
      + "translation degrades to today's behaviour instead of to an empty screen")
check(strings.count > 100, "the catalogue covers the whole app, not one new screen (\(strings.count) keys)")

// Every placeholder in the key must appear in the translation, and vice versa. A German
// sentence that drops a %@ prints a building name into nowhere; one that invents an extra
// one reads off the end of the varargs list in the C-style formatter.
//
// The POSITION MARKER IS STRIPPED before comparing, and that is the whole subtlety of this
// file. The key the runtime looks up is the NON-positional form the compiler extracts
// ("%lld of %lld confirmed"), while a translation is usually positional because German
// reorders ("%2$lld ... %1$lld"). Comparing them literally would reject every correct
// translation; comparing the multiset of TYPES catches the mistakes that matter - a
// dropped placeholder, an extra one, or %@ where the argument is an integer.
//
// Hand-writing the positional form as the KEY is exactly the bug this comparison exists
// to survive: it looks right, it never matches, and the sentence silently ships in
// English. Get the key list from the compiler:
//   xcodebuild -exportLocalizations ...   (see the header)
let placeholder = try! NSRegularExpression(pattern: #"%(?:\d+\$)?(?:lld|d|@|s)"#)
let position = try! NSRegularExpression(pattern: #"(\d+)\$"#)
func placeholders(_ s: String) -> [String] {
    placeholder.matches(in: s, range: NSRange(s.startIndex..., in: s))
        .map { String(s[Range($0.range, in: s)!]) }
        .map { position.stringByReplacingMatches(in: $0, range: NSRange($0.startIndex..., in: $0), withTemplate: "") }
        .sorted()
}

// ...and the key itself must never carry one. A positional key is one the compiler never
// emits, so it can only have been typed by hand, and it will never be looked up.
for key in strings.keys {
    check(position.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)) == nil,
          "'\(key)' is a POSITIONAL key. The compiler extracts non-positional keys, so this "
          + "one is never looked up and its sentence ships in English.")
}

var translated = 0
for (key, value) in strings {
    guard let entry = value as? [String: Any] else {
        check(false, "'\(key)' is not an object"); continue
    }
    guard let locales = entry["localizations"] as? [String: Any],
          let german = locales["de"] as? [String: Any],
          let unit = german["stringUnit"] as? [String: Any],
          let text = unit["value"] as? String
    else {
        check(false, "'\(key)' has no German translation (decision-8: German is the default language)")
        continue
    }
    check(unit["state"] as? String == "translated",
          "'\(key)' is not marked translated - a 'needs_review' string ships as English")
    check(!text.isEmpty, "'\(key)' has an EMPTY German translation, which renders as nothing at all")
    check(placeholders(key) == placeholders(text),
          "'\(key)' -> '\(text)': the placeholders do not match")
    translated += 1
}
check(translated == strings.count, "every key is translated (\(translated)/\(strings.count))")

// The vocabulary has to be the one the worker already reads in the web admin and in the
// Android app: Objekt for a building, Schicht for a shift, Mitarbeiter for a worker.
// Two words for the same thing across three surfaces is how a crew stops trusting any of
// them. Same assertion shape as android/checks/core-check.kt's German-locale test.
let all = String(data: data, encoding: .utf8)!
for word in ["Objekt", "Schicht", "Mitarbeiter", "eingestempelt", "Verwaltung"] {
    check(all.contains(word), "the German catalogue uses the house word '\(word)' (web/messages/de.json)")
}
check(!all.contains("Gebäude"), "buildings are Objekte, never Gebäude - that is the admin panel's word")

if failed { exit(1) }
print("localisation-check: OK (\(strings.count) keys, all German)")
