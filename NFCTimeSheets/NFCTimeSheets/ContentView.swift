//
//  ContentView.swift
//  NFCTimeSheets
//

import SwiftUI
import SwiftData

// The API layer lives in API.swift, the sync engine in Sync.swift, identity in Auth.swift.
// There is no admin screen here: admin is password-authenticated on the web (decision-20).

/// The whole app is one of two screens, chosen by the server's answer to "who is this?"
/// (decision-22). Sign-in offers SMS and the admin-issued code, both always visible, never
/// gated (decision-50) - there is no third, dead-end screen any more.
struct ContentView: View {
    @Environment(Session.self) private var session
    /// Rows an on-device migration archived, shown once as a receipt. Loaded lazily and
    /// only inside the eligible branch: that branch mounts after the launch task has run
    /// the migrations, so there is no race between "what happened" and "telling them".
    @State private var receipt: [ArchivedShift] = []
    @State private var showReceipt = false
    /// Material requests. Owned HERE and not in NFCTimeSheetsApp on purpose: it is only
    /// needed once the server has said who this is, and it dies on sign-out, which is
    /// exactly the lifetime a queue of one worker's own words should have. It is a plain
    /// observable object over a JSON file - it does NOT touch the SwiftData store that
    /// holds unpushed shifts. See the header of Materials.swift.
    @State private var materials = MaterialStore()
    /// The lock reads this and nothing else. A separate @Query rather than a value passed
    /// up from LogView: the TAB BAR is what changes, and it is built here.
    @Query private var shifts: [Shift]

    private var shiftRunning: Bool { shifts.contains(where: \.isOpen) }

    var body: some View {
        switch session.state {
        case .unknown:
            ProgressView()
                .controlSize(.large)
                .accessibilityLabel("Checking your sign-in")
        case .signedOut(let reason):
            SignInView(reason: reason)
        case .eligible(let worker):
            // THE LOCK. While a shift runs the tab bar is shorter: History goes, because
            // nothing in it is time-critical. Materials and Settings never go, because a
            // worker standing in a building needs to ask for supplies and a handed-over
            // phone must be signable-out (decision-22). The resolver is not a tab - it is
            // a banner on the Log tab, present in every state (decision-10).
            //
            // This is WORK DISCIPLINE and not a security boundary: the rule lives in the
            // pure ShiftSignal.visibleTabs, which checks/shift-signal-check.swift asserts
            // can never return a set without Materials and Settings in it.
            TabView {
                ForEach(ShiftSignal.visibleTabs(shiftRunning: shiftRunning), id: \.self) { tab in
                    switch tab {
                    case .log:
                        LogView(worker: worker).tabItem { Label("Log", systemImage: "wave.3.right") }
                    case .materials:
                        // The badge counts requests the warehouse has and the worker has
                        // not been told about. There is no push in this system
                        // (decision-23: the server's dependencies are pg + @sentry/node),
                        // so this number only moves when the app is opened, and the
                        // screen says so in words.
                        //
                        // This is the TAB badge. The APP-ICON badge is a different
                        // surface and belongs to the open shift alone - see
                        // ShiftSignalCenter.arm.
                        MaterialsView(worker: worker)
                            .tabItem { Label("Materials", systemImage: "shippingbox") }
                            .badge(materials.unseenArrivalCount)
                    case .history:
                        HistoryView().tabItem { Label("History", systemImage: "list.bullet") }
                    case .settings:
                        SettingsView(worker: worker).tabItem { Label("Settings", systemImage: "gear") }
                    }
                }
            }
            .environment(materials)
            // At LAUNCH, not when the Materials tab is opened: the badge is the only
            // thing telling a worker something is waiting for them at the warehouse, and
            // a badge that only appears once you have looked is not a badge. Its own
            // task, so a slow or missing materials API cannot delay the Log tab.
            .task(id: worker.id) { await materials.start(workerId: worker.id) }
            // Four rows must not vanish between launches without a word. If the archive
            // is empty there is nothing to report, so the flag is simply cleared.
            .task {
                guard MigrationReceipt.unseen else { return }
                receipt = MigrationReceipt.archived()
                if receipt.isEmpty { MigrationReceipt.unseen = false } else { showReceipt = true }
            }
            .sheet(isPresented: $showReceipt, onDismiss: { MigrationReceipt.unseen = false }) {
                MigrationReceiptSheet(shifts: receipt)
            }
        }
    }
}

// MARK: - State (a): signed out

/// Two doors: an SMS one-time code, and the admin-issued enrolment code. ONE FORM SERVES
/// BOTH (decision-54 §5) - see CodeSignInSection.swift, which the operator gate uses too.
///
/// THE SMS DOOR IS CAPABILITIES-GATED (decision-59 §2), which STRIKES decision-50 §1's
/// "no `GET /auth/capabilities` check here, unlike Android". That rule reasoned that with
/// Apple gone, hiding SMS could leave a phone with exactly one door. The owner accepted
/// that consequence explicitly for THIS flag: `sms_login` exists for controlled testing
/// windows, and every phone in one has an admin a phone call away who can issue an
/// enrolment code on demand. One rule now - capabilities decides visibility - on every
/// platform, with no iOS carve-out to remember.
struct SignInView: View {
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    /// Why the last attempt failed, if it did. Screen-level only (e.g. a dropped
    /// session) - the field-level SMS/code errors below are local @State.
    let reason: String?
    /// FALSE UNTIL THE SERVER SAYS OTHERWISE, and false again the moment it says so. The
    /// initial value is the fail-closed one, so the first frame - drawn before any request
    /// can possibly have returned - never flashes a door that is shut.
    @State private var smsAvailable = false

    var body: some View {
        // OperatorHomeScreen is pushed from operatorSection below, so whatever presents
        // this view needs a NavigationStack ancestor - Settings already has one; this is
        // the second, and now the ONLY one that does not require a worker session first.
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        // THE REAL COMPANY MARK, not a generic radio-waves glyph. It is
                        // achromatic by nature (docs/brand/DESIGN.md measured the source
                        // pixels) - there is no colour version to reach for, and none is
                        // invented here.
                        Image("BrandMark")
                            .resizable()
                            .scaledToFit()
                            .frame(height: 72)
                            .accessibilityHidden(true)
                        Text("NFC TimeSheets")
                            .font(.title.bold())
                            .accessibilityAddTraits(.isHeader)
                        Text("Sign in to log your hours.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let reason {
                            Text(reason)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 6)
                }
                .listRowBackground(Color.clear)

                // The phone field, the Request-SMS button, ONE code field and ONE submit
                // button - the same view the operator gate mounts (decision-54 §5). All
                // three calls stay Session's; this view kept no auth state of its own
                // when it consolidated.
                CodeSignInSection(role: .worker,
                                  smsAvailable: smsAvailable,
                                  busy: session.busy,
                                  requestSms: { try await session.requestSmsCode(phone: $0) },
                                  verifySms: { try await session.verifySmsCode(phone: $0, code: $1) },
                                  submitCode: { try await session.signInWithCode($0) })
                operatorSection
            }
            .scrollDismissesKeyboard(.interactively)
            // EVERY APPEARANCE AND EVERY RESUME, not once per process (decision-59 §2,
            // and the same reasoning TASK-276 applied to the operator gate). Android reads
            // this at launch because its sign-in screen IS the launch screen; on iOS this
            // view is pushed and popped, so a launch-only read would mean flipping the flag
            // server-side did nothing until the worker force-quit the app. No spinner and
            // nothing waits on it: the code field is already usable while it is in flight.
            .task { smsAvailable = await AuthAPI.smsDoorAvailable() }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { smsAvailable = await AuthAPI.smsDoorAvailable() }
            }
        }
    }

    // MARK: Operator door
    //
    // decision-45 makes an operator a genuinely separate identity from a worker - it must
    // not require signing in as a worker first. Before this, the ONLY route in was
    // Settings, which only exists inside .eligible(worker): a phone that is operator-only
    // had no way in at all (found 2026-08-24, TASK-252).
    //
    // ONE LINK INTO A GATE, not two direct links (decision-54 §4). This reverses what the
    // comment here used to say: the two-direct-link design let anyone with the app
    // installed SEE the operator interface, and gated only the action, inside each screen.
    // decision-54 gates reaching it at all, so OperatorHomeScreen.swift is the retired
    // OperatorSignInScreen back in substance, and WriteTagScreen/VerifyZoneScreen no
    // longer carry a code field of their own. Settings keeps its own identical link for a
    // phone that is already signed in as a worker and also mounts tags.
    private var operatorSection: some View {
        Section {
            NavigationLink("Write or test tags") { OperatorHomeScreen() }
        } footer: {
            Text("Operator? Write or test tags without signing in as a worker.")
                .font(.footnote)
        }
    }

    // The SMS door, the enrolment-code door and every per-outcome error sentence they
    // showed all moved, verbatim, into CodeSignInSection.swift - nothing was dropped in
    // the move, only the LAYOUT consolidated (decision-54 §5).
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
    @Environment(ShiftSignalCenter.self) private var signals
    @Environment(\.scenePhase) private var scenePhase
    /// "Your open shift at A was finished and one at B was started." A CARD, not an
    /// alert: SwiftUI silently drops one of an alert and a sheet presented together, so
    /// the old alert could eat the decision-10 resolver on exactly the tap that created
    /// an auto-closed shift. Android has always shown this as a card; this is iOS
    /// catching up (parity row 9).
    @State private var switchNotice: String?
    @State private var unresolved: [WireShift] = []
    @State private var showResolver = false
    /// decision-56: the building picked in the "start without a tag" sheet, and whether the
    /// confirmation for it is up. Two pieces of state, not one, because the pick is not the
    /// decision - nothing is posted until the dialog is confirmed.
    @State private var showManualStart = false
    @State private var manualPick: String?
    @State private var confirmingManualStart = false
    /// The foreground scan (TapScanner.swift). One instance for the life of the view, and
    /// `scanError` is the calm sentence for a card that could not be read or is not ours -
    /// never a crash, never a silent no-op.
    @State private var scanner = TapScanner()
    @State private var scanError: String?
    @State private var scanning = false

    private var open: [Shift] { shifts.filter(\.isOpen) }
    private var recent: [Shift] { Array(shifts.filter { !$0.isOpen }.prefix(5)) }

    /// The ONE value the shift screen and every out-of-app signal are derived from
    /// (ShiftSignal.swift). Built from the LOCAL row, because a tap in a basement has one
    /// and a server response may never arrive.
    private var running: RunningShift? {
        open.first.map(asRunning)
    }

    /// The same value, read straight out of the context instead of out of `@Query`.
    ///
    /// This is what the SIGNAL is armed from, and the distinction matters: `@Query`
    /// republishes on SwiftData's own schedule, so reading it in the same turn as the
    /// `context.save()` that just wrote a row can hand back the state from BEFORE the tap.
    /// A fetch cannot. Rendering may lag a frame; a badge that says "clocked in" after a
    /// clock-out may not.
    private func currentRunning() -> RunningShift? {
        let all = (try? context.fetch(FetchDescriptor<Shift>(sortBy: [SortDescriptor(\Shift.startTime, order: .reverse)]))) ?? []
        return all.first(where: \.isOpen).map(asRunning)
    }

    private func asRunning(_ shift: Shift) -> RunningShift {
        RunningShift(locationId: shift.locationId,
                     locationName: siteName(shift.locationId),
                     startTime: shift.startTime,
                     // decision-10: the server flagged it and no human has fixed it. The
                     // screen must then stop showing a running clock.
                     serverAutoClosed: shift.autoClosed && shift.correctedAt == nil)
    }
    /// "Unknown location" until the roster arrives, and that is fine: a missing name is
    /// cosmetic, a missing shift is unpaid work. Nothing branches on this string.
    private func siteName(_ id: String) -> String {
        sites.first { $0.locationId == id }?.name ?? String(localized: "Unknown location")
    }

    var body: some View {
        NavigationStack {
            // TWO SHAPES, and which one is on screen is the entire point of this work.
            // Idle: a list of recent shifts with a hint at the bottom. Running: a
            // full-bleed screen with a ticking clock, which is unmistakable from across
            // a room. The old build's whole in-shift signal was an orange pill on a row.
            Group {
                if let running {
                    ShiftScreen(running: running,
                                unresolvedCount: unresolved.count,
                                onResolve: { showResolver = true },
                                notice: switchNotice,
                                onDismissNotice: { switchNotice = nil },
                                onManualStop: manualStop,
                                onScan: scan)
                } else {
                    idleList
                }
            }
            .navigationTitle(running == nil ? "TimeSheet" : "Shift running")
            .refreshable { await refresh() }
            // THE IN-APP SCAN IS BACK, and on NFCTagReaderSession, not the retired
            // NFCNDEFReaderSession: `NDEF` in com.apple.developer.nfc.readersession.formats
            // is App Store error 90778, `TAG` is what this app already has, and that is what
            // TapScanner uses. It exists because the background tap opens a universal link
            // and iOS shows a system transition for it even when the app is already open in
            // the worker's hand - confusing exactly where it should be calmest.
            //
            // It adds NO clock-in logic: a resolved tag goes to `inbox.accept`, the same
            // mailbox onOpenURL/onContinueUserActivity post into, and comes back out through
            // the onChange below into the one handleTap.
            .alert("Couldn't read that tag",
                   isPresented: Binding(get: { scanError != nil }, set: { if !$0 { scanError = nil } })) {
                Button("OK") { scanError = nil }
            } message: {
                Text(scanError ?? "")
            }
            .onChange(of: inbox.pendingLocationId) { _, id in
                guard id != nil, let tapped = inbox.take() else { return }
                handleTap(tapped)
            }
            .task {
                if let pending = inbox.take() { handleTap(pending) }  // tap that launched the app
                await signals.refreshAuthorization()
                await refresh()
            }
            // onDismiss, not just on present: confirming an auto-closed shift is the one
            // path that can end a shift WITHOUT a tag tap, and a lock screen or a badge
            // left standing after it would be exactly the "stuck lock / orphaned
            // notification" this work exists to prevent.
            .sheet(isPresented: $showResolver, onDismiss: { signals.arm(for: currentRunning()) }) {
                ResolveSheet(shifts: $unresolved, siteName: siteName)
            }
            .sheet(isPresented: $showManualStart) { manualStartSheet }
            // Coming back from the background is the only chance to re-arm a Live Activity
            // the worker dismissed by hand, or to notice that notifications were switched
            // on (or off) in Settings while the app was not running.
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                signals.arm(for: currentRunning())
                Task { await signals.refreshAuthorization() }
            }
        }
    }

    /// The app with no shift running: unchanged from before this screen split.
    private var idleList: some View {
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
            Section("Recent") {
                if recent.isEmpty { Text("No completed shifts yet.").foregroundStyle(.secondary) }
                ForEach(recent) { ShiftRow(shift: $0, name: siteName($0.locationId)) }
            }
            Section {
                VStack(spacing: 12) {
                    Image(systemName: "wave.3.right")
                        .font(.title2)
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                    Text("Hold your phone to the tag by the entrance to start.")
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .accessibilityElement(children: .combine)
                    // THE ONE FILLED BUTTON on this screen: the primary action. Everything
                    // else in this list is secondary or corrective and is plain/bordered.
                    Button(action: scan) {
                        Label("Scan a tag", systemImage: "wave.3.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            // decision-56 §4. CLEARLY SECONDARY: a plain row under the tap instruction, not
            // a prominent button beside it - the tag stays the normal way in, and this is the
            // answer to a broken card, an unreachable one, or a phone whose NFC is dead.
            // Flagged, never silent; the footer says so before it is pressed, not after.
            Section {
                // Corrective, so BORDERED and never filled (2026-08-29 UX audit).
                Button("Start without a tag") {
                    manualPick = nil
                    showManualStart = true
                }
                .buttonStyle(.bordered)
            } footer: {
                Text("Tag missing or unreachable? Pick the building instead. The office sees this as a manual entry.")
                    .font(.footnote)
            }
            #if DEBUG
            manualMockSection
            #endif
            Section {
                // Android has said this out loud since day one and iOS only had it as a
                // code comment (parity row 20). Promising a notification to somebody who
                // then does not get one is the difference between a late delivery and a
                // broken product.
                Text("This app has no push. Everything you see here updates when you open it.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    /// decision-56 §4: the picker, built from the roster this app ALREADY caches (`sites`,
    /// filled by refreshRoster) - no new endpoint and no new cache. An empty list is a real
    /// state on a fresh install with no signal, so it says so instead of showing an empty
    /// wheel above a live Start button.
    private var manualStartSheet: some View {
        NavigationStack {
            Form {
                if pickableSites.isEmpty {
                    Text("No buildings on this phone yet. Connect to the internet and pull down to refresh.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Picker("Building", selection: $manualPick) {
                        // Always present, always first, for the same reason BuildingPicker
                        // has one: a nil selection with no matching tag renders BLANK, which
                        // reads as a broken control rather than an unanswered question.
                        Text("Choose a building").tag(String?.none)
                        ForEach(pickableSites, id: \.self) { id in
                            Text(siteName(id)).tag(String?.some(id))
                        }
                    }
                    Text("Your admin will see that this shift was started without a tag.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Start without a tag")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showManualStart = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { confirmingManualStart = true }
                        .disabled(manualPick == nil)
                }
            }
            .confirmationDialog(Text("Start a shift at \(siteName(manualPick ?? ""))?"),
                                isPresented: $confirmingManualStart,
                                titleVisibility: .visible) {
                Button("Start shift") { startManual() }
            } message: {
                Text("The clock starts now and this is marked for the office to review. Use the tag when you can.")
            }
        }
    }

    /// Cached buildings, plus - only while a debug mock is armed - the canned one, so the
    /// picker is walkable on a simulator that can reach no server. Never written to the
    /// SwiftData cache; see ShiftMockFlows.swift.
    private var pickableSites: [String] {
        var ids = sites.map(\.locationId)
        #if DEBUG
        if ShiftMocks.active != nil {
            ids += ShiftMocks.locations.map(\.id).filter { !ids.contains($0) }
        }
        #endif
        return ids
    }

    /// decision-56 §4, and note what it does NOT do: it calls the SAME handleTap the tag
    /// path calls, with one flag flipped. Every rejection the server can answer with - 409
    /// shift_already_open, 422 zone_unverified, 422 unknown_location - therefore lands in
    /// APIFailure.workerMessage and on the row exactly as a tap's would, in the same words.
    /// A separate post here would have been a second place for that copy to drift.
    private func startManual() {
        guard let id = manualPick else { return }
        showManualStart = false
        handleTap(id, manual: true)
    }

    /// decision-56 §4/§3. Closes the LOCAL row first, exactly as a tap-out does, so a Stop
    /// pressed in a basement still counts; `manualClose` rides up with the queued close.
    /// `autoClosed` is deliberately left alone: this is a worker confirming their own finish
    /// time in the moment, not the 8h timer guessing, so it must not enter the decision-10
    /// resolver - the server stamps corrected_at instead.
    private func manualStop() {
        guard let running = shifts.first(where: \.isOpen) else { return }
        running.endTime = .now
        running.manualClose = true
        running.closeSyncedAt = nil
        try? context.save()
        // AFTER the save, never before it - same ordering rule as handleTap.
        signals.arm(for: currentRunning())
        Telemetry.log("manual clock-out", .info, [
            "ts.location.id": running.locationId,
            "ts.shift.client_uuid": running.clientUuidString,
        ])
        Task { await syncPending(context: context, workerId: worker.id) }
    }

    #if DEBUG
    /// Absent from a Release build, byte for byte - see ShiftMockFlows.swift. It ARMS the
    /// canned responses and nothing else: the worker then presses the shipping "Start without
    /// a tag" and the shipping Stop, so what is walked is this file's real code.
    @ViewBuilder
    private var manualMockSection: some View {
        Section {
            ForEach(ShiftMockFlow.allCases) { flow in
                Button(flow.label) { ShiftMocks.arm(flow) }
            }
            Button("Mock: off") { ShiftMocks.arm(nil) }
        } header: {
            Text("Simulate (debug builds only)")
        } footer: {
            Text("No network. Arms canned /shifts responses; the buttons above stay the real ones.")
        }
    }
    #endif

    /// The foreground scan. Resolves a card in-app and posts it to the SAME TapInbox the
    /// background universal link posts into - so every open/close decision still happens in
    /// exactly one place, `handleTap`, reached through the `.onChange` above.
    ///
    /// Every non-resolving outcome ends in a sentence or in silence, never in a no-op the
    /// worker cannot explain: a cancelled sheet says nothing (they cancelled it), anything
    /// else says why.
    private func scan() {
        guard !scanning else { return }
        scanning = true
        Task {
            defer { scanning = false }
            switch await scanner.scan() {
            case .resolved(let locationId):
                inbox.accept(locationId)
            case .unrecognised:
                scanError = String(localized: "This card isn't one of ours. Ask your admin to check it.")
            case .failed(let message):
                scanError = message
            }
        }
    }

    private func refresh() async {
        await refreshRoster(context: context)
        await refreshFlags()     // decision-57: same pass as the roster, never blocking
        await adoptServerOpenShift(context: context)
        await syncPending(context: context, workerId: worker.id)
        unresolved = await fetchUnresolved()
        // THE RECOVERY HALF OF THE ONE WIRE (audit §4). adoptServerOpenShift may have just
        // learned about a shift this phone had never heard of - reinstall, new device, or
        // a tap that opened the shift before the local row landed - and the badge, the
        // ladder and the Live Activity have to come back from exactly the same call the
        // tap path uses. `running` is recomputed from the store, so a shift the server
        // closed in the meantime arms nothing at all.
        signals.arm(for: currentRunning())
    }

    /// One tap = one toggle. The row is written locally first (so a tap in a basement
    /// still counts) and pushed straight after.
    ///
    /// A TAP ALWAYS PRODUCES A ROW. There is no longer any branch that returns without
    /// writing one, and there must never be one again.
    ///
    /// DELETED: `guard sites.contains(where: { $0.locationId == locationId })`, which
    /// refused the tap when the LOCAL roster cache did not know the location. That was
    /// the wrong invariant and it broke the product: `sites` is filled by refreshRoster(),
    /// which needs the network, and on a tag-tap cold launch onOpenURL delivers the id
    /// before any roster fetch has finished - so on a fresh install a perfectly valid tag
    /// was refused as unknown and the worker lost paid time standing at the door.
    /// The SERVER is authoritative for whether a location exists (decision-19): POST
    /// /shifts/open runs validate.js activeLocation and answers 422 unknown_location,
    /// which APIFailure classifies as terminal, which Sync.record turns into syncBlocked +
    /// "This location was removed. Ask your admin.", which ShiftRow.syncStatus already
    /// renders in red. That rejection path exists end to end; the guard only pre-empted it
    /// with a worse answer. A missing NAME is cosmetic (siteName falls back below); a
    /// missing SHIFT is unpaid work.
    ///
    /// `manual` (decision-56) changes exactly one thing: the flag stamped on a row this
    /// function was going to write anyway. It is NOT a second code path - see startManual().
    private func handleTap(_ locationId: String, manual: Bool = false) {
        let trace = Telemetry.beginTap(locationId: locationId, cachedLocations: sites.count)
        let write = trace.child("db", "shift.local_write")

        // decision-10 wants unresolved shifts resolved before the app is USED. Capturing a
        // timestamp is not use, it is capture: the old code refused the tap outright, so a
        // worker at the door at 06:02 got an alert, resolved an unrelated three-day-old
        // auto-closed shift, and tapped again at 06:05 - three minutes of paid time gone,
        // and only if they tapped again at all. The invariant decision-10 protects is that
        // no shift reaches payroll with an unconfirmed end time, and a NEW open shift does
        // not touch it. So: record first, then force the resolver sheet (not a dismissible
        // alert) so the pressure stays and the data loss goes.
        let mustResolve = !unresolved.isEmpty

        let action: String
        let touched: Shift
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
                switchNotice = String(localized: "Finished your open shift at \(siteName(running.locationId)) and started at \(siteName(locationId)). Confirm when you actually left \(siteName(running.locationId)) — it will not count until you do.")
                touched = startShift(at: locationId)
                action = "switch"
            } else {
                touched = running
                action = "close"
            }
        } else {
            touched = startShift(at: locationId)
            // decision-56, set ONLY on a row this call is creating. A manual clock-in is
            // unreachable while a shift is running (the button lives on the idle screen), so
            // the close and switch branches above can never be handed manual = true - and if
            // that ever changes, it must not silently re-flag somebody else's open row.
            touched.manualStart = manual
            action = manual ? "manual_open" : "open"
        }
        try? context.save()

        // AFTER the save and never before it. Everything below this line is a signal, and
        // a signal may never delay, throw into, or fail a clock-in (audit R2): arm(for:)
        // is synchronous, non-throwing, and hands every OS call to a detached Task. A
        // denied permission, Live Activities switched off and a dead network are all
        // "arm nothing" - never "reject the tap". checks/shift-signal-check.swift pins
        // this ordering by reading this function as text.
        signals.arm(for: currentRunning())

        write.data("ts.shift.action", action)
        write.data("ts.shift.client_uuid", touched.clientUuidString)
        write.finish()

        // `ts.roster.cached_locations` is the one field that would have diagnosed the
        // deleted guard above in five seconds instead of by reading source. That is why
        // it exists.
        Telemetry.log("nfc tap accepted", .info, [
            "ts.location.id": locationId,
            "ts.shift.action": action,
            "ts.shift.client_uuid": touched.clientUuidString,
            "ts.cold_launch": Telemetry.isColdLaunch(),
            "ts.roster.cached_locations": sites.count,
            "ts.tap.unresolved_pending": mustResolve,
        ])

        // The switch notice is a card now, not an alert, so it cannot collide with this
        // sheet and the old `alertMsg == nil` guard is gone with it: an unresolved shift
        // ALWAYS opens the resolver, including on the tap that just created one.
        if mustResolve { showResolver = true }

        Task {
            // Wraps the await rather than being started after it: a span that covers the
            // push is what shows whether the POST happened at all, and the auto-instrumented
            // http.client span lands inside this transaction because it is scope-bound.
            let push = trace.child("function", "shift.push")
            await syncPending(context: context, workerId: worker.id)
            if let serverId = touched.serverId { push.data("ts.shift.server_id", serverId) }
            push.data("ts.shift.outcome", outcome(of: touched))
            push.finish()
            trace.data("ts.shift.outcome", outcome(of: touched))
            trace.finish(ok: !touched.syncBlocked)
        }
    }

    private func outcome(of shift: Shift) -> String {
        if shift.syncBlocked { return "blocked" }
        return shift.isFullySynced ? "synced" : "queued"
    }

    @discardableResult
    private func startShift(at locationId: String) -> Shift {
        let shift = Shift(workerId: worker.id, workerName: worker.name, locationId: locationId)
        context.insert(shift)
        return shift
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
                // decision-56 §5: "every list that shows shifts must show this". A manual row
                // is never indistinguishable from a tap-confirmed one, on the worker's own
                // phone either - the admin should not be the only one who can tell.
                if shift.manualStart || shift.manualClose { pill("Manual", .blue) }
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

/// TASK-298: the parameter is a LocalizedStringKey, not a String, ON PURPOSE.
/// Text(_ content: S) where S: StringProtocol is the VERBATIM initializer - it looks
/// nothing up, so every pill shipped its English literal on a German device. Only
/// Text(_ key: LocalizedStringKey) consults the catalogue. All call sites pass literals,
/// so they compile unchanged; a future caller with a RUNTIME String will not compile,
/// which is the point - it would have to say what key it means.
private func pill(_ t: LocalizedStringKey, _ c: Color) -> some View {
    Text(t).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
        .background(c.opacity(0.2)).foregroundStyle(c).clipShape(Capsule())
}

/// Not private: LegacyClassifier's "worthless" ceiling is defined as "what this renders
/// as 0h 0m", and MigrationReceiptView shows archived rows with the same spelling.
func fmtDur(_ s: TimeInterval) -> String { "\(Int(s) / 3600)h \((Int(s) % 3600) / 60)m" }

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
    /// How many there were when this sheet opened, so the worker can watch the queue
    /// shrink. decision-10 point 3 asked for this and neither platform had it.
    @State private var total = 0

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if total > 1 {
                        Text("\(total - shifts.count + 1) of \(total) confirmed")
                            .font(.footnote.weight(.semibold))
                    }
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
            .task { if total == 0 { total = shifts.count } }
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
        sites.first { $0.locationId == id }?.name ?? String(localized: "Unknown location")
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

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }
    private var appBuild: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

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
                // decision-45: a SEPARATE identity for a SEPARATE credential. Reachable
                // from here because a worker's own phone may also be the one an operator
                // uses to mount or test a tag — it is additive, and touches nothing above.
                //
                // Through the SAME gate as the sign-in screen's link, never straight into
                // WriteTagScreen: those screens no longer carry a code field of their own
                // (decision-54 §4), so a direct link from here would be the one unguarded
                // way in left.
                Section {
                    NavigationLink("Write or test tags") { OperatorHomeScreen() }
                } footer: {
                    Text("For staff who mount and test NFC tags. This never opens a shift.")
                        .font(.footnote)
                }
                Section {
                    // Destructive, so BORDERED and never filled or borderless (2026-08-29
                    // UX audit): a plain text row reads like a label until it is pressed.
                    Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        .buttonStyle(.bordered)
                        .disabled(session.busy)
                } footer: {
                    Text("Shifts already sent stay on the server. Anything still waiting to send will be blocked until you sign back in.")
                        .font(.footnote)
                }
                // decision-52: same wording Android's Settings → UpdateSection already
                // renders. Reads the native fields Xcode already writes into the built
                // Info.plist from project.pbxproj's MARKETING_VERSION/
                // CURRENT_PROJECT_VERSION — no build-setting edit needed or made.
                Section {
                    Text("Installed: \(appVersion) (\(appBuild))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
