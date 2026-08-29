// Runnable check: WriteTagScreen's step machine, TWO CARDS IN ONE SESSION. No Xcode, no
// simulator, no radio.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/WriteTagStep.swift checks/write-tag-step-check.swift \
//     > /tmp/write-tag-step-check.swift && swift /tmp/write-tag-step-check.swift
//
// WHAT WENT WRONG WITHOUT THIS FILE: card 1 written and reported, card 2 written in the
// SAME screen session - and the screen showed THREE panels at once (card 2's mint plan,
// card 2's result, card 1's leftover report failure), because the three sections were
// independent `if`s over state that was never reset between cards. Every line below is a
// step of that exact session; each one asserts EXACTLY ONE panel.

//
// PART 2 OF THIS FILE READS WriteTagScreen.swift, and that half exists because part 1 went
// green over a genuinely broken screen. The state walk below calls `startWrite()` from the
// `.zone` case - a transition the REAL view had no control for once the panels became a
// switch, because both Write buttons live on the other two panels. A state machine that CAN
// move is not a screen that CAN BE moved. So every step now has to name a Release-reachable
// button that performs the transition, checked against the view's own source.

import Foundation

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

/// The screen's three facts, moved together the way the screen moves them.
struct Screen {
    var hasOutcome = false
    var reportSent = false
    var hasReportedId = false

    var step: WriteTagStep {
        WriteTagStep.current(hasOutcome: hasOutcome, reportSent: reportSent,
                             hasReportedId: hasReportedId)
    }

    /// `resetForNewWrite()` - the fix, in one line, called at the TOP of write().
    mutating func startWrite() { self = Screen() }
    mutating func wrote() { hasOutcome = true }
    mutating func reportFailed() { reportSent = false }
    mutating func reportLanded() { reportSent = true; hasReportedId = true }
}

var s = Screen()
check(s.step == .plan, "a fresh screen shows the mint plan")

// --- card 1 -----------------------------------------------------------------------------
s.startWrite()
check(s.step == .plan, "while the card is being written, the plan is still the panel")
s.wrote()
check(s.step == .result, "a write outcome replaces the plan - it does not stack on it")
s.reportFailed()
check(s.step == .result, "a failed report keeps the SAME panel, which is where Retry lives")
s.reportLanded()
check(s.step == .zone, "a landed report moves to the zone step, and only that")

// --- card 2, SAME session: the regression --------------------------------------------
s.startWrite()
check(s.step == .plan,
      "card 2 starts on the plan - card 1's report and zone step must not survive the reset")
s.wrote()
check(s.step == .result, "card 2's result is the only panel; card 1's zone step is gone")
s.reportLanded()
check(s.step == .zone, "card 2 reaches its own zone step")

// --- and a third, because 'reset once' is not the same as 'reset every time' -------------
s.startWrite()
check(s.step == .plan, "every attempt resets, not just the second one")

// The panels are cases of ONE enum, so 'exactly one panel' is not something a view body
// can quietly break by adding a fourth `if`.
for (has, sent, id) in [(false, false, false), (true, false, false), (true, true, true),
                        (true, true, false), (false, true, true)] {
    let step = WriteTagStep.current(hasOutcome: has, reportSent: sent, hasReportedId: id)
    check([.plan, .result, .zone].contains(step), "every state maps to exactly one panel")
}
// A report marked sent with no id to resolve is NOT the zone step - resolving nil 404s.
check(WriteTagStep.current(hasOutcome: true, reportSent: true, hasReportedId: false) == .result,
      "sent-but-no-id stays on the result panel")

// =========================================================================================
// PART 2: THE PANELS THE STEPS ACTUALLY RENDER, AND THE WAY OUT OF EACH ONE.
// =========================================================================================

guard let wholeScreen = try? String(contentsOfFile: "NFCTimeSheets/WriteTagScreen.swift",
                                    encoding: .utf8) else {
    let why = "FAIL: NFCTimeSheets/WriteTagScreen.swift is missing "
        + "(run this from the NFCTimeSheets/ directory)\n"
    FileHandle.standardError.write(Data(why.utf8))
    exit(1)
}

/// Everything a RELEASE build compiles - every `#if DEBUG ... #endif` removed, nesting
/// included. Every assertion below runs against THIS, never the whole file: the DEBUG
/// Simulate section renders outside the step switch, so on a debug build there is always a
/// way to start a new write from any panel. That is exactly what made the dead end
/// invisible, and it is why no mock symbol may satisfy a rule here.
func releaseOnly(_ source: String) -> String {
    var kept: [Substring] = []
    var depth = 0
    for line in source.split(separator: "\n", omittingEmptySubsequences: false) {
        let bare = line.trimmingCharacters(in: .whitespaces)
        if bare.hasPrefix("#if DEBUG") { depth += 1; continue }
        if depth > 0 {
            if bare.hasPrefix("#if") { depth += 1; continue }
            if bare.hasPrefix("#endif") { depth -= 1; continue }
            continue
        }
        if bare.hasPrefix("#endif") { continue }
        kept.append(line)
    }
    return kept.joined(separator: "\n")
}

let screen = releaseOnly(wholeScreen)

// The stripper is load-bearing, so it is proved rather than trusted: if these survive, it
// silently kept a DEBUG block and every rule below could be satisfied by the mock.
for debugOnly in ["mockSection", "simulateWrite", "OperatorMocks"] {
    check(!screen.contains(debugOnly),
          "the DEBUG stripper works - \(debugOnly) must not survive into the Release source "
          + "this check reasons about")
}
check(wholeScreen.contains("mockSection"),
      "...and it stripped something real: the debug section is still in the file")

/// The text between the braces of `private var <name>: some View {` - the panel's body.
func bodyOf(_ declaration: String, in source: String) -> String? {
    guard let head = source.range(of: declaration),
          let open = source[head.upperBound...].firstIndex(of: "{") else { return nil }
    var depth = 0
    var i = open
    while i < source.endIndex {
        if source[i] == "{" { depth += 1 }
        if source[i] == "}" {
            depth -= 1
            if depth == 0 { return String(source[source.index(after: open)..<i]) }
        }
        i = source.index(after: i)
    }
    return nil
}

/// Every `Button("label") { action }` in a panel, as (label, action source). Brace- and
/// paren-matched rather than regexed, because the actions nest closures.
func buttons(in body: String) -> [(label: String, action: String)] {
    var found: [(String, String)] = []
    var cursor = body.startIndex
    while let call = body.range(of: "Button(\"", range: cursor..<body.endIndex) {
        guard let labelEnd = body[call.upperBound...].firstIndex(of: "\"") else { break }
        let label = String(body[call.upperBound..<labelEnd])
        // Past the argument list, then the trailing closure.
        var i = labelEnd
        var parens = 1
        while i < body.endIndex, parens > 0 {
            if body[i] == "(" { parens += 1 }
            if body[i] == ")" { parens -= 1 }
            i = body.index(after: i)
        }
        guard let open = body[i...].firstIndex(of: "{") else { break }
        var depth = 0
        var j = open
        var action = ""
        while j < body.endIndex {
            if body[j] == "{" { depth += 1 }
            if body[j] == "}" {
                depth -= 1
                if depth == 0 {
                    action = String(body[body.index(after: open)..<j])
                    break
                }
            }
            j = body.index(after: j)
        }
        found.append((label, action))
        cursor = j < body.endIndex ? body.index(after: j) : body.endIndex
    }
    return found
}

/// EXHAUSTIVE ON PURPOSE. A fourth `WriteTagStep` case does not make this check fail - it
/// makes it fail to COMPILE, so a new panel cannot be added without naming the view that
/// draws it and, below, the button that leaves it.
func panel(for step: WriteTagStep) -> String {
    switch step {
    case .plan: return "planSection"
    case .result: return "resultSection"
    case .zone: return "zoneSection"
    }
}

/// A tap that puts the screen back on a FRESH write. `resetForNewWrite()` is the whole of
/// it - directly, or via `write()`, which calls it as its first line.
func startsAFreshWrite(_ action: String) -> Bool {
    action.contains("resetForNewWrite()") || action.contains("write()")
}

for step in [WriteTagStep.plan, .result, .zone] {
    let name = panel(for: step)
    check(screen.contains("case .\(step == .plan ? "plan" : step == .result ? "result" : "zone"): \(name)"),
          "the step switch renders \(name) for this step - one panel, named where it is chosen")
    guard let body = bodyOf("private var \(name): some View", in: screen) else {
        check(false, "\(name) is declared in the Release half of WriteTagScreen")
        break
    }
    let exits = buttons(in: body).filter { startsAFreshWrite($0.action) }
    check(!exits.isEmpty,
          "\(name) has at least ONE Release-reachable button that starts a new card. Without "
          + "it this panel is a dead end: exactly one panel renders at a time, so a step "
          + "whose own source contains no such control cannot be left except by popping the "
          + "navigation stack, which nothing on screen says. THIS IS THE REGRESSION: the "
          + "zone step shipped with none, and the state walk above passed anyway because it "
          + "called startWrite() from .zone with no button behind it.")
    print("  \(name): exit via \(exits.map { "Button(\"\($0.label)\")" }.joined(separator: ", "))")
}

// And the reset really does land on the plan panel - a button wired to a reset that left
// `reportedId` behind would satisfy the rule above and still not move the screen.
guard let reset = bodyOf("private func resetForNewWrite()", in: screen) else {
    FileHandle.standardError.write(Data("FAIL: resetForNewWrite() is missing\n".utf8))
    exit(1)
}
for cleared in ["outcome = nil", "report = .idle", "reportedId = nil"] {
    check(reset.contains(cleared),
          "resetForNewWrite() clears `\(cleared)` - all three facts, or `step` does not "
          + "return to .plan and the button is decoration")
}
check(WriteTagStep.current(hasOutcome: false, reportSent: false, hasReportedId: false) == .plan,
      "...and those three cleared facts ARE the plan step")

print("write-tag-step-check: OK")
