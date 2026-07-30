// Runnable check: the cold-launch tap ordering. No test framework, no Xcode.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/TapInbox.swift checks/tap-inbox-check.swift \
//     > /tmp/tap-inbox-check.swift && swift /tmp/tap-inbox-check.swift
//
// This is the defect that shipped: a tag tap on a fresh install produced no shift at all.
// One half of that was a bad guard in ContentView; the other half is ordering, and
// ordering is what this pins. LogView consumes the inbox in two places and they must
// between them handle a tap exactly ONCE, whether it arrived before or after LogView
// mounted:
//
//     .task        { if let pending = inbox.take() { handleTap(pending) } }
//     .onChange(of: inbox.pendingLocationId) { _, id in
//         guard id != nil, let tapped = inbox.take() else { return }
//         handleTap(tapped)
//     }
//
// The simulation below is that consumer, spelled out, so a refactor of either call site
// that drops or doubles a tap fails here first.

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

let siteA = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
let siteB = "6b3a2c1d-0e4f-4a8b-9c7d-1e2f3a4b5c6d"

/// Stands in for LogView: `.task` on mount, `.onChange` on every write afterwards.
final class Consumer {
    private let inbox: TapInbox
    private var mounted = false
    private(set) var handled: [String] = []

    init(_ inbox: TapInbox) { self.inbox = inbox }

    /// SwiftUI's `.onChange(of:)` without `initial: true` fires only for writes that
    /// happen while the view is in the hierarchy. Nothing is delivered on mount.
    func write(_ id: String?) {
        guard mounted else { return }
        guard id != nil, let tapped = inbox.take() else { return }
        handled.append(tapped)
    }

    func mount() {
        mounted = true
        if let pending = inbox.take() { handled.append(pending) }
    }
}

/// `accept` then observe: every mutation of pendingLocationId is reported to the
/// consumer, exactly as @Observable + .onChange does.
func accept(_ inbox: TapInbox, _ consumer: Consumer, _ id: String) {
    let before = inbox.pendingLocationId
    inbox.accept(id)
    if inbox.pendingLocationId != before { consumer.write(inbox.pendingLocationId) }
}

// --- ordering 1: set BEFORE mount (the tap that launched the app) -------------------
// onOpenURL fires while Session.restore() is still running, so ContentView is a spinner
// and LogView does not exist yet. This is the exact case that must not be lost.
do {
    let inbox = TapInbox()
    let consumer = Consumer(inbox)
    accept(inbox, consumer, siteA)                 // no consumer yet
    check(consumer.handled.isEmpty, "nothing is handled before LogView mounts")
    consumer.mount()                               // .task takes it
    check(consumer.handled == [siteA], "launch tap survives to mount: \(consumer.handled)")
    // take() flipped the value to nil, which fires .onChange again. The guard drops it.
    consumer.write(inbox.pendingLocationId)
    check(consumer.handled == [siteA], "the nil echo after take() is not a second tap")
}

// --- ordering 2: set AFTER mount (app already open) ---------------------------------
do {
    let inbox = TapInbox()
    let consumer = Consumer(inbox)
    consumer.mount()
    check(consumer.handled.isEmpty, "mounting with an empty inbox handles nothing")
    accept(inbox, consumer, siteA)
    check(consumer.handled == [siteA], "foreground tap handled once: \(consumer.handled)")
    consumer.write(inbox.pendingLocationId)
    check(consumer.handled == [siteA], "still once after the nil echo")
}

// --- the 3s dedupe window must survive both orderings -------------------------------
// One physical tap can be delivered twice (in-app read AND the universal link). Without
// the window that clocks in and straight back out.
do {
    let inbox = TapInbox()
    let consumer = Consumer(inbox)
    consumer.mount()
    accept(inbox, consumer, siteA)
    accept(inbox, consumer, siteA)                 // same tag, same instant
    check(consumer.handled == [siteA], "a duplicate delivery of one tap is swallowed")

    accept(inbox, consumer, siteB)                 // a different building is never a dupe
    check(consumer.handled == [siteA, siteB], "a different tag inside the window still counts")
}

// Set-before-mount is deduped too: the second delivery must not queue a second tap that
// only surfaces once LogView appears.
do {
    let inbox = TapInbox()
    let consumer = Consumer(inbox)
    accept(inbox, consumer, siteA)
    accept(inbox, consumer, siteA)
    consumer.mount()
    check(consumer.handled == [siteA], "one launch tap, not two: \(consumer.handled)")
}

print("tap-inbox-check: OK")
