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

// A German localization is either a flat stringUnit or a plural variation (TASK-40: "4 alte
// Schichts" was a Swift-side 's' suffix smuggled past the catalogue - the fix is CLDR
// one/other variants, where noun and verb can both agree, not another string trick). Both
// shapes are checked the same way: translated, non-empty, and the same placeholder TYPES
// as the key.
func checkUnit(_ unit: [String: Any]?, key: String, label: String) -> Bool {
    guard let unit,
          let text = unit["value"] as? String
    else {
        check(false, "'\(key)' (\(label)) has no German translation (decision-8: German is the default language)")
        return false
    }
    check(unit["state"] as? String == "translated",
          "'\(key)' (\(label)) is not marked translated - a 'needs_review' string ships as English")
    check(!text.isEmpty, "'\(key)' (\(label)) has an EMPTY German translation, which renders as nothing at all")
    check(placeholders(key) == placeholders(text),
          "'\(key)' (\(label)) -> '\(text)': the placeholders do not match")
    return true
}

var translated = 0
for (key, value) in strings {
    guard let entry = value as? [String: Any] else {
        check(false, "'\(key)' is not an object"); continue
    }
    guard let locales = entry["localizations"] as? [String: Any],
          let german = locales["de"] as? [String: Any]
    else {
        check(false, "'\(key)' has no German translation (decision-8: German is the default language)")
        continue
    }
    if let unit = german["stringUnit"] as? [String: Any] {
        if checkUnit(unit, key: key, label: "stringUnit") { translated += 1 }
    } else if let plural = (german["variations"] as? [String: Any])?["plural"] as? [String: Any] {
        check(plural["other"] != nil, "'\(key)' has a plural variation with no 'other' form - every count needs one")
        var allOk = true
        for (category, unitBox) in plural {
            let unit = (unitBox as? [String: Any])?["stringUnit"] as? [String: Any]
            allOk = checkUnit(unit, key: key, label: "plural.\(category)") && allOk
        }
        if allOk { translated += 1 }
    } else {
        check(false, "'\(key)' has no German translation (decision-8: German is the default language)")
    }
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

// TASK-40: the migration receipt's two counts must be real plural variations, not a Swift
// 's' suffix smuggled through a second %@ - RED if either regresses to a flat stringUnit.
for key in ["%lld old shifts need your admin", "We cleaned up %lld old records"] {
    let hasPluralVariation = ((((strings[key] as? [String: Any])?["localizations"] as? [String: Any])?["de"] as? [String: Any])?["variations"] as? [String: Any])?["plural"] != nil
    check(hasPluralVariation, "'\(key)' must use a plural variation (TASK-40), not a Swift-side 's' suffix")
}

// MARK: - Literals in the source that never reached the catalogue (TASK-278)
//
// The header above says only Xcode can prove the key set still matches what the compiler
// extracts. That was true and it cost four release-visible German sentences: 'Write or
// test tags' (twice), 'Sign in as an operator...' and .navigationTitle('Operator') shipped
// in English because nobody re-ran -exportLocalizations after adding them.
//
// This is the POOR MAN'S EXTRACTOR and it is deliberately narrow: the one-argument, plain
// string-literal form of the handful of view builders this app actually uses. It cannot
// see an interpolated literal, a string built in a variable, or a modifier not listed
// here - so it is a floor, not a proof, and -exportLocalizations stays the real answer.
// What it DOES catch is exactly how those four got in: someone typed Text("...") and
// stopped.
//
// RED CASE: delete 'Write or test tags' from the catalogue and this fails naming
// ContentView.swift.
let literal = try! NSRegularExpression(
    pattern: #"(?:Text|Button|NavigationLink|Section|navigationTitle)\("([^"\\%]{4,})"\)?"#)
let sources = (try? FileManager.default.contentsOfDirectory(atPath: "NFCTimeSheets"))?
    .filter { $0.hasSuffix(".swift") }.sorted() ?? []
check(!sources.isEmpty, "the source directory was found")

for file in sources where file != "DemoHooks.swift" {  // demo builds only, see TASK-278
    guard let text = try? String(contentsOfFile: "NFCTimeSheets/\(file)", encoding: .utf8) else { continue }
    for match in literal.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        let key = String(text[Range(match.range(at: 1), in: text)!])
        check(strings[key] != nil,
              "\(file) shows the literal '\(key)' and the catalogue has no entry for it, so it "
              + "renders in English on a German phone (AGENTS.md: both languages, same commit)")
    }
}

if failed { exit(1) }
print("localisation-check: OK (\(strings.count) keys, all German)")
