//
//  ContentView.swift
//  NFCTimeSheets
//

import AuthenticationServices
import SwiftUI
import SwiftData

// The API layer lives in API.swift, the sync engine in Sync.swift, identity in Auth.swift.
// There is no admin screen here: admin is password-authenticated on the web (decision-20).

/// The whole app is one of three screens, chosen by the server's answer to "who is this?"
/// (decision-22). There is no path from the ineligible screen into the tabs - not a
/// button, not a link, not a swipe - because the tabs are not built at all in that state.
struct ContentView: View {
    @Environment(Session.self) private var session

    var body: some View {
        switch session.state {
        case .unknown:
            ProgressView()
                .controlSize(.large)
                .accessibilityLabel("Checking your sign-in")
        case .signedOut(let reason):
            SignInView(reason: reason)
        case .ineligible(let email):
            IneligibleView(email: email)
        case .eligible(let worker):
            TabView {
                LogView(worker: worker).tabItem { Label("Log", systemImage: "wave.3.right") }
                HistoryView().tabItem { Label("History", systemImage: "list.bullet") }
                SettingsView(worker: worker).tabItem { Label("Settings", systemImage: "gear") }
            }
        }
    }
}

// MARK: - State (a): signed out

/// A title, a sentence, and Apple's own button. Nothing to tap that is not sign-in -
/// there is nothing in this app to see before the server says who you are.
struct SignInView: View {
    @Environment(Session.self) private var session
    @Environment(\.colorScheme) private var colorScheme
    /// Why the last attempt failed, if it did. nil after a plain cancel.
    let reason: String?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "wave.3.right")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("NFC TimeSheets")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Sign in to log your hours.")
                .font(.body)
                .foregroundStyle(.secondary)
            if let reason {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            // Apple's own control, not a lookalike: it is localised, accessible and
            // sized by the system, and the HIG rules about its appearance make a
            // hand-rolled version a review risk for no gain.
            SignInWithAppleButton(.signIn) { request in
                session.prepare(request)
            } onCompletion: { result in
                Task { await session.complete(result) }
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(maxWidth: 360, minHeight: 50)
            .disabled(session.busy)
            .opacity(session.busy ? 0.5 : 1)
        }
        .padding(28)
        .multilineTextAlignment(.center)
    }
}

// MARK: - State (c): signed in, not a worker

/// A DEAD END, deliberately. No tabs, no navigation, no retry-into-the-app.
///
/// The only way forward is a human one: the worker reads the address below to their
/// manager, who pastes it into the worker record in the admin panel. With Hide My Email
/// that address is a per-app relay nobody could have registered in advance, so a first
/// sign-in landing here is normal rather than an error - which is exactly why the
/// address has to be on screen, and why there is no approval queue to build.
///
/// Sign out is the one permitted control: they may simply have used the wrong Apple ID.
struct IneligibleView: View {
    @Environment(Session.self) private var session
    let email: String?

    private var message: String {
        email == nil
            ? "This Apple ID isn't registered as a worker. Ask your manager to add you, then sign in again."
            : "This Apple ID isn't registered as a worker yet. Read the address below to your manager and ask them to add it to your worker record, then sign in again."
    }

    var body: some View {
        // ScrollView, not VStack: at the largest accessibility text sizes this content is
        // taller than the screen, and a locked-out worker who cannot read WHY is worse
        // off than one who has to scroll.
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Image(systemName: "person.crop.circle.badge.xmark")
                    .font(.largeTitle)
                    .foregroundStyle(.orange)
                    .accessibilityHidden(true)   // decorative; the text below says it

                Text("You're not on the worker list")
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)

                Text(message)
                    .font(.body)
                    .foregroundStyle(.secondary)

                if let email {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your sign-in address")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(email)
                            .font(.body.monospaced())
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                    // Read as one item, and spelled out: "j7k2p" said as a word is
                    // useless to someone dictating it down a phone line.
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Your sign-in address: \(Self.spelledOut(email))")
                    .accessibilityValue(email)
                }

                Button("Sign out") { Task { await session.signOut() } }
                    .buttonStyle(.bordered)
                    .disabled(session.busy)
                    .accessibilityHint("Returns to the sign-in screen so you can use a different Apple ID")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(28)
        }
        // VoiceOver lands on a screen with no obvious focus otherwise, and the reason for
        // being locked out is the entire content of this screen. Say it out loud.
        .task {
            try? await Task.sleep(for: .milliseconds(600))  // let the screen settle first
            AccessibilityNotification.Announcement(
                email.map { "\(message) \(Self.spelledOut($0))" } ?? message
            ).post()
        }
    }

    /// Local part letter by letter, domain as words. A relay address is random noise
    /// before the @ and a fixed hostname after it.
    private static func spelledOut(_ email: String) -> String {
        guard let at = email.firstIndex(of: "@") else {
            return email.map(String.init).joined(separator: " ")
        }
        let local = email[..<at].map(String.init).joined(separator: " ")
        return "\(local) at \(email[email.index(after: at)...])"
    }
}

// MARK: - Log tab

struct LogView: View {
    @Environment(\.modelContext) private var context
    @Environment(TapInbox.self) private var inbox
    /// Who the SERVER says is holding this phone. Not a preference, not editable, and
    /// never sent in a shift body - it is here to stamp local rows and to keep another
    /// account's queued rows from being pushed under this session (decision-22).
    let worker: WireWorker
    @Query(sort: \Shift.startTime, order: .reverse) private var shifts: [Shift]
    @Query private var sites: [Site]
    @State private var alertMsg: String?
    @State private var unresolved: [WireShift] = []
    @State private var showResolver = false

    private var open: [Shift] { shifts.filter(\.isOpen) }
    private var recent: [Shift] { Array(shifts.filter { !$0.isOpen }.prefix(5)) }
    private func siteName(_ id: String) -> String {
        sites.first { $0.locationId == id }?.name ?? "Unknown location"
    }

    var body: some View {
        NavigationStack {
            List {
                if !unresolved.isEmpty {
                    Section {
                        Button { showResolver = true } label: {
                            Label("\(unresolved.count) unfinished shift(s) need a finish time",
                                  systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                    }
                }
                if !open.isEmpty {
                    Section("In progress") {
                        ForEach(open) { ShiftRow(shift: $0, name: siteName($0.locationId)) }
                    }
                }
                Section("Recent") {
                    if recent.isEmpty { Text("No completed shifts yet.").foregroundStyle(.secondary) }
                    ForEach(recent) { ShiftRow(shift: $0, name: siteName($0.locationId)) }
                }
            }
            .navigationTitle("TimeSheet")
            .refreshable { await refresh() }
            // There is no in-app scan button. Clocking in happens by holding the phone to
            // the tag while the app is closed: iOS reads the tag itself and opens the
            // universal link, which lands in `inbox` via onOpenURL. That path needs no
            // CoreNFC entitlement and no reader session.
            //
            // The button that used to live here drove NFCNDEFReaderSession. Building against
            // the iOS 26 SDK, `NDEF` is no longer permitted in
            // com.apple.developer.nfc.readersession.formats (App Store error 90778) - it now
            // demands `TAG`, i.e. NFCTagReaderSession. Rather than port a scanner that was
            // always meant to be deleted once background tap worked, it is gone.
            // Ceiling: if background tap proves unreliable on real hardware, the fallback is
            // NFCTagReaderSession + `TAG` in the entitlement, NOT the old NDEF session.
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 6) {
                    Image(systemName: "wave.3.right")
                        .font(.title2)
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                    Text(open.isEmpty
                         ? "Hold your phone to the tag by the entrance to start."
                         : "Hold your phone to the tag again to finish.")
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(.bar)
                .accessibilityElement(children: .combine)
            }
            .onChange(of: inbox.pendingLocationId) { _, id in
                guard id != nil, let tapped = inbox.take() else { return }
                handleTap(tapped)
            }
            .task {
                if let pending = inbox.take() { handleTap(pending) }  // tap that launched the app
                await refresh()
            }
            .sheet(isPresented: $showResolver) {
                ResolveSheet(shifts: $unresolved, siteName: siteName)
            }
            .alert("Can't log", isPresented: .constant(alertMsg != nil)) {
                Button("OK") { alertMsg = nil }
            } message: { Text(alertMsg ?? "") }
        }
    }

    private func refresh() async {
        await refreshRoster(context: context)
        await adoptServerOpenShift(context: context)
        await syncPending(context: context, workerId: worker.id)
        unresolved = await fetchUnresolved()
    }

    /// One tap = one toggle. The row is written locally first (so a tap in a basement
    /// still counts) and pushed straight after.
    private func handleTap(_ locationId: String) {
        guard unresolved.isEmpty else {
            alertMsg = "Finish your unresolved shift first — tap the warning at the top."
            return
        }
        guard sites.contains(where: { $0.locationId == locationId }) else {
            alertMsg = "Unknown tag — this location isn't registered. Ask your admin to add it."
            return
        }

        if let running = shifts.first(where: \.isOpen) {
            running.endTime = .now
            running.closeSyncedAt = nil
            if running.locationId != locationId {
                // The worker left the last building without tapping out and is now at a
                // new one. Auto-closing is the only non-deadlocking option: the server
                // allows one open shift per worker, and they cannot walk back to the old
                // tag. Say so out loud rather than doing it behind their back.
                //
                // Flagged, not silent: the end time we just wrote is the moment they
                // arrived at the NEXT building, so the walk between sites lands on this
                // one's labour cost and no human ever confirmed the real finish time.
                // Marking it sends it through the same resolution screen as an 8h timeout
                // (decision-10), which keeps the invariant that no shift reaches payroll
                // with an unconfirmed end time. A normal tap-out stays unflagged.
                running.autoClosed = true
                alertMsg = "Finished your open shift at \(siteName(running.locationId)) and started at \(siteName(locationId)). Confirm when you actually left \(siteName(running.locationId)) — it will not count until you do."
                startShift(at: locationId)
            }
        } else {
            startShift(at: locationId)
        }
        try? context.save()
        Task { await syncPending(context: context, workerId: worker.id) }
    }

    private func startShift(at locationId: String) {
        context.insert(Shift(workerId: worker.id, workerName: worker.name, locationId: locationId))
    }
}

// MARK: - Rows

struct ShiftRow: View {
    let shift: Shift
    let name: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name).font(.headline)
                Spacer()
                if shift.isOpen { pill("In progress", .orange) }
                else if shift.autoClosed && shift.correctedAt == nil { pill("Auto-closed", .red) }
                else if shift.correctedAt != nil { pill("Corrected", .purple) }
            }
            Text(shift.startTime.formatted(date: .abbreviated, time: .shortened))
                .font(.caption).foregroundStyle(.secondary)
            if let end = shift.endTime, let d = shift.duration {
                Text("\(shift.startTime.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))  ·  \(fmtDur(d))")
                    .font(.caption)
            }
            syncStatus
        }
    }

    /// A failed sync is never invisible. `syncBlocked` means nobody is retrying and the
    /// worker has to involve the admin, so it says that in red rather than "pending".
    @ViewBuilder private var syncStatus: some View {
        if let err = shift.syncError {
            Label(err, systemImage: shift.syncBlocked ? "xmark.octagon.fill" : "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90")
                .font(.caption2)
                .foregroundStyle(shift.syncBlocked ? .red : .orange)
        } else if shift.isFullySynced {
            Label("Sent", systemImage: "checkmark.icloud").font(.caption2).foregroundStyle(.green)
        } else {
            Label("Sending…", systemImage: "arrow.up.circle").font(.caption2).foregroundStyle(.secondary)
        }
    }
}

private func pill(_ t: String, _ c: Color) -> some View {
    Text(t).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
        .background(c.opacity(0.2)).foregroundStyle(c).clipShape(Capsule())
}

private func fmtDur(_ s: TimeInterval) -> String { "\(Int(s) / 3600)h \((Int(s) % 3600) / 60)m" }

// MARK: - Resolution (decision-10)

/// The 8h timer closed these at start+8h, which is a guess. A human has to say what the
/// real finish time was before that guess becomes payroll truth.
struct ResolveSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Binding var shifts: [WireShift]
    let siteName: (String) -> String

    @State private var picked: [Int: Date] = [:]
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("These shifts were closed automatically after 8 hours. Enter when you actually finished.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(shifts) { shift in
                    Section(shift.locationName ?? siteName(shift.locationId)) {
                        LabeledContent("Started",
                                       value: shift.startTime.formatted(date: .abbreviated, time: .shortened))
                        DatePicker("Finished",
                                   selection: binding(for: shift),
                                   in: Self.range(for: shift))
                        Button("Save finish time") { Task { await save(shift) } }
                            .disabled(busy)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.footnote) } }
            }
            .navigationTitle("Unfinished shifts")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Later") { dismiss() } }
            }
        }
    }

    /// A DatePicker traps on an empty range, so the bounds are clamped rather than
    /// trusted: a phone with a skewed clock could otherwise report a start in the future.
    private static func range(for shift: WireShift) -> ClosedRange<Date> {
        let now = Date.now
        return min(shift.startTime, now.addingTimeInterval(-60))...now
    }

    private func binding(for shift: WireShift) -> Binding<Date> {
        Binding(get: { picked[shift.id] ?? shift.endTime ?? .now },
                set: { picked[shift.id] = $0 })
    }

    private func save(_ shift: WireShift) async {
        busy = true
        defer { busy = false }
        let end = picked[shift.id] ?? shift.endTime ?? .now
        if let failure = await resolveShift(context: context, shift: shift, end: end) {
            error = failure
            return
        }
        error = nil
        shifts.removeAll { $0.id == shift.id }
        if shifts.isEmpty { dismiss() }
    }
}

// MARK: - History tab

struct HistoryView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Shift.startTime, order: .reverse) private var shifts: [Shift]
    @Query private var sites: [Site]
    private func siteName(_ id: String) -> String {
        sites.first { $0.locationId == id }?.name ?? "Unknown location"
    }

    private var completed: [Shift] { shifts.filter { !$0.isOpen } }
    private var totalHours: Double { completed.compactMap(\.duration).reduce(0, +) / 3600 }
    private var weekHours: Double {
        let start = Calendar.current.dateInterval(of: .weekOfYear, for: .now)?.start ?? .now
        return completed.filter { $0.startTime >= start }.compactMap(\.duration).reduce(0, +) / 3600
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Summary") {
                    LabeledContent("This week", value: String(format: "%.1f h", weekHours))
                    LabeledContent("Total", value: String(format: "%.1f h", totalHours))
                }
                Section("Shifts") {
                    if shifts.isEmpty { Text("No shifts yet.").foregroundStyle(.secondary) }
                    ForEach(shifts) { ShiftRow(shift: $0, name: siteName($0.locationId)) }
                        // Deleting only drops the local copy; anything already sent stays
                        // on the server, which is what payroll is paid from.
                        .onDelete { idx in idx.map { shifts[$0] }.forEach(context.delete); try? context.save() }
                }
            }
            .navigationTitle("History")
        }
    }
}

// MARK: - Settings tab

/// No picker any more (decision-22). "Who are you" is not a setting a worker gets to
/// choose - it is the server's answer to their Apple ID, shown here read-only.
struct SettingsView: View {
    @Environment(Session.self) private var session
    let worker: WireWorker

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in as") {
                    LabeledContent("Name", value: worker.name)
                        .accessibilityLabel("Signed in as \(worker.name)")
                }
                Section {
                    Text("Hours, locations and payroll are managed by your admin on the web.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        .disabled(session.busy)
                } footer: {
                    Text("Shifts already sent stay on the server. Anything still waiting to send will be blocked until you sign back in.")
                        .font(.footnote)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
