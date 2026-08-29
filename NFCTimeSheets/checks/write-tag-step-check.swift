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

print("write-tag-step-check: OK")
