//
//  ShiftScreen.swift
//  NFCTimeSheets
//
//  What the app looks like while a shift is running. Not a pill on a row - THE screen.
//
//  The failure this exists to prevent: a worker taps in at 06:02, pockets the phone, goes
//  home, and nothing on that phone ever mentions the shift again. At 14:02 the server
//  closes it, it leaves payroll (decision-10), and the office pays for a manual
//  correction. So while a shift runs the app is unmistakable from across a room and has
//  exactly one subject.
//
//  THE LOCK IS WORK DISCIPLINE, NOT SECURITY. Nothing here is enforcement and nothing
//  here traps anybody: the resolver, the materials tab, sign-out and the help text are
//  reachable at every moment, as labelled controls rather than gestures. The one thing
//  that goes away is History, because nothing in it is time-critical. See
//  ShiftSignal.visibleTabs, which is where that rule is written down and check-covered.
//

import SwiftUI
import UIKit    // openSettingsURLString - the one link out of the "notifications are off" card

struct ShiftScreen: View {
    let running: RunningShift
    /// Shifts the 8h timer closed that nobody has confirmed yet (decision-10). Shown in
    /// EVERY state, including this one - a locked screen may never hide the resolver.
    let unresolvedCount: Int
    let onResolve: () -> Void
    /// The "your open shift was moved to another building" sentence, when there is one.
    let notice: String?
    let onDismissNotice: () -> Void
    /// decision-56: end this shift NOW, without a tag. The confirmation lives here; the
    /// caller only ever hears about a decision the worker already confirmed.
    let onManualStop: () -> Void

    @Environment(ShiftSignalCenter.self) private var signals
    @Environment(\.openURL) private var openURL
    @State private var confirmingStop = false

    /// THE WHOLE SCREEN is inside one TimelineView, ticking once a minute, and that is
    /// deliberate rather than tidy: the 8h boundary has to flip the heading, the colour,
    /// the words AND the clock together. An earlier shape put the TimelineView around only
    /// the clock, and a shift that crossed 8 hours while the worker was looking at the
    /// screen kept a green "Clocked in" header above a stopped timer until something else
    /// happened to redraw the body.
    ///
    /// Once a minute, not once a second: the digits are ticked by the SYSTEM inside
    /// Text(timerInterval:), so nothing here needs to keep up with them.
    var body: some View {
        TimelineView(.periodic(from: running.startTime, by: 60)) { context in
            let overdue = ShiftSignal.phase(of: running, now: context.date) == .overdue
            // Colour is the SECOND signal, never the only one - the state is spelled out
            // in words directly under the clock. Green while it is fine, red once it is not.
            let tint: Color = overdue ? .red : .green

            // ScrollView, not a fixed stack: at 200% Dynamic Type this content is far
            // taller than the screen, and a locked screen that clips its own instructions
            // is worse than no lock at all.
            ScrollView {
                VStack(spacing: 24) {
                    header(overdue: overdue, tint: tint)
                    clock(overdue: overdue, now: context.date)
                    instruction(tint: tint)
                    stopButton
                    if let notice { noticeCard(notice) }
                    if unresolvedCount > 0 { resolverCard }
                    if signals.outOfAppSignalsSilenced { notificationsOffCard }
                    helpCard
                }
                .frame(maxWidth: .infinity)
                .padding(24)
            }
            .background(tint.opacity(0.14).ignoresSafeArea())
        }
        // The permission moment. AFTER the first clock-in, from the screen that is already
        // explaining what the reminder buys, and never on the tap path itself - the gate
        // is ShiftSignal.shouldAskForNotifications and it is check-covered. A worker asked
        // at a door at 06:02 with gloves on says no once, permanently.
        .task {
            await signals.requestAuthorizationIfNeeded()
        }
    }

    // MARK: - Pieces

    private func header(overdue: Bool, tint: Color) -> some View {
        VStack(spacing: 6) {
            Text(overdue ? "Over 8 hours" : "Clocked in")
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
                .accessibilityAddTraits(.isHeader)
            Text(running.locationName)
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
            Text("Started \(running.startTime.formatted(date: .omitted, time: .shortened))")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    /// The dominant element on the screen, and the whole reason this screen exists.
    ///
    /// The digits are ticked by the SYSTEM (Text(timerInterval:)) - no timer of ours, no
    /// battery, no redraw loop. The whole card is ONE accessibility element and the digits
    /// are inside it rather than beside it, because a per-second change under VoiceOver is
    /// unusable. Its label is recomputed once a minute from `now`; updating a label is not
    /// an announcement, so nothing is interrupted.
    private func clock(overdue: Bool, now: Date) -> some View {
        let elapsed = ShiftSignal.elapsed(from: running.startTime, to: now)
        return VStack(spacing: 10) {
            if overdue {
                // No running clock on a shift the 8h timer has closed (or is about to):
                // a ticking number there would be a lie about a row that is already out
                // of payroll until a human fixes it.
                Text("8:00:00+")
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                Text("This shift passed 8 hours and was closed automatically. It will not be paid until you confirm when you actually finished.")
                    .font(.callout)
                    .multilineTextAlignment(.center)
            } else {
                Text(timerInterval: running.startTime...ShiftSignal.autoCloseDeadline(after: running.startTime),
                     countsDown: false)
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                Text("Running")
                    .font(.headline)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            overdue
                ? Text("Shift at \(running.locationName) passed 8 hours and was closed automatically. Confirm when you finished.")
                : Text("Shift running for \(elapsed.hours) hours \(elapsed.minutes) minutes at \(running.locationName)")
        )
    }

    /// The PRIMARY way to end the shift, and still the only silent one.
    ///
    /// This comment used to read "there is no in-app button and there must not be one:
    /// clocking out is a tag tap, and a second path to the same row is how two mechanisms
    /// start disagreeing about somebody's hours". decision-56 supersedes that for this one
    /// action, and the reasoning survives intact rather than being deleted, because it is
    /// exactly WHY the button below is safe: the second path is not silent. A manual stop
    /// sends `manual: true`, the server stamps `manual_close` (and `corrected_at` in the
    /// same update), and every list that shows shifts shows it - forever. The two mechanisms
    /// cannot disagree about somebody's hours without an admin being able to see which one
    /// produced the row. Prevention was never on the table (a worker with a broken tag had
    /// no way to clock out at all); visibility is.
    private func instruction(tint: Color) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "wave.3.right")
                .font(.system(size: 40))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text("Hold your phone to the tag again to finish.")
                .font(.title3.weight(.medium))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .combine)
    }

    /// SECONDARY, and below the tap instruction on purpose: the tag is still the normal way
    /// out. `.bordered` + a confirmation dialog, never a single destructive tap - decision-56
    /// §4 requires the confirmation on both new paths, and the dialog NAMES the building so
    /// a mis-tap on the wrong phone is caught before it costs somebody an afternoon.
    private var stopButton: some View {
        Button(role: .destructive) { confirmingStop = true } label: {
            Label("Finish shift without a tag", systemImage: "stop.circle")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .confirmationDialog(Text("Finish your shift at \(running.locationName) now?"),
                            isPresented: $confirmingStop,
                            titleVisibility: .visible) {
            Button("Finish now", role: .destructive, action: onManualStop)
        } message: {
            Text("This ends the shift at this moment and is marked for the office to review. Use the tag when you can.")
        }
    }

    private func noticeCard(_ text: String) -> some View {
        // A CARD, not an alert. SwiftUI will not present an alert and a sheet at once and
        // silently drops one of them, so the old alert could eat the decision-10 resolver
        // on exactly the tap that produced an auto-closed shift. A card cannot collide
        // with anything.
        card(icon: "arrow.triangle.swap", tint: .orange) {
            Text(text)
                .accessibilityAddTraits(.isStaticText)
            Button("Dismiss", action: onDismissNotice)
                .buttonStyle(.bordered)
        }
    }

    private var resolverCard: some View {
        card(icon: "exclamationmark.triangle.fill", tint: .orange) {
            Text("\(unresolvedCount) unfinished shift(s) need a finish time before they can be paid.")
            Button("Confirm finish times", action: onResolve)
                .buttonStyle(.borderedProminent)
        }
    }

    /// Said ONCE, as a sentence, never as a modal and never as a nag. A denied permission
    /// is a weaker signal, not a broken app - the screen you are reading is the floor and
    /// it is unaffected.
    private var notificationsOffCard: some View {
        card(icon: "bell.slash", tint: .secondary) {
            Text("Notifications are off, so this phone cannot remind you to clock out. Everything else still works.")
                .font(.footnote)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            .buttonStyle(.bordered)
        }
    }

    /// The escape that is not a gesture. Sign-out lives one tab away in Settings and the
    /// materials tab is next to it; this says so out loud, because a worker who believes
    /// they are stuck is the failure this whole screen is not allowed to cause.
    private var helpCard: some View {
        card(icon: "questionmark.circle", tint: .secondary) {
            Text("Something wrong? Ask what to do — hours, locations and payroll are managed by your admin on the web. You can still request material and sign out from the tabs below.")
                .font(.footnote)
        }
    }

    @ViewBuilder
    private func card(icon: String, tint: Color, @ViewBuilder content: () -> some View) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .accessibilityHidden(true)     // decorative; the text beside it says it
            VStack(alignment: .leading, spacing: 10) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }
}
