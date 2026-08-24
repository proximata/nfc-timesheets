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

/// Two doors, both always visible, neither gated (decision-50): an SMS one-time code, and
/// the admin-issued enrolment code, normalised by EnrolmentCode.swift the same way
/// WriteTagScreen/VerifyZoneScreen's own operator-code fields do. No `GET
/// /auth/capabilities` check here, unlike Android - with
/// Apple gone, hiding SMS behind a flag could leave a phone with exactly one door, and a
/// control that answers 503 the moment it is pressed says so in the copy right where the
/// tap happened (decision-50 §1).
struct SignInView: View {
    @Environment(Session.self) private var session
    /// Why the last attempt failed, if it did. Screen-level only (e.g. a dropped
    /// session) - the field-level SMS/code errors below are local @State.
    let reason: String?

    // SMS door. `sentTo` mirrors Android's rememberSaveable shape: non-nil only once a
    // request has been ACCEPTED for this exact string, and the ONLY way back to phone
    // entry is the "Use a different number" button - so the code field can never sit next
    // to a number nothing was sent to.
    @State private var phone = ""
    @State private var sentTo: String?
    @State private var otp = ""
    @State private var phoneErrorMessage: String?
    @State private var otpErrorMessage: String?

    // Enrolment-code door.
    @State private var enrolmentInput = ""
    @State private var enrolmentErrorMessage: String?

    var body: some View {
        // WriteTagScreen and VerifyZoneScreen are both pushed from operatorSection below,
        // so whatever presents this view needs a NavigationStack ancestor - Settings
        // already has one; this is the second, and now the ONLY one that does not
        // require a worker session first.
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "wave.3.right")
                            .font(.system(size: 44))
                            .foregroundStyle(.tint)
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

                smsSection
                enrolmentSection
                operatorSection
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    // MARK: Operator door
    //
    // decision-45 makes an operator a genuinely separate identity from a worker - it must
    // not require signing in as a worker first. Before this, the ONLY route in was
    // Settings, which only exists inside .eligible(worker): a phone that is operator-only
    // had no way in at all (found 2026-08-24, TASK-252).
    //
    // TWO DIRECT LINKS, not a link to a sign-in screen that then reveals two more links -
    // full parity with android/.../ui/TimeSheetApp.kt's SignInScreen, which puts "Tag
    // schreiben" and "Tag pruefen" directly on the welcome screen. WriteTagScreen and
    // VerifyZoneScreen each carry their OWN operator-code gate now (mirrors
    // WriteTagActivity.kt/VerifyZoneActivity.kt refusing to start a reader session while
    // `!operatorReady`), so there is nothing left for an intermediate sign-in screen to
    // do - OperatorSignInScreen.swift is retired, not left as a second, now-redundant door.
    // Settings keeps its own identical section for a phone that is already signed in as a
    // worker and also mounts tags.
    private var operatorSection: some View {
        Section {
            NavigationLink("Write a tag") { WriteTagScreen() }
            NavigationLink("Test a tag") { VerifyZoneScreen() }
        } footer: {
            Text("Operator? Write or test tags without signing in as a worker.")
                .font(.footnote)
        }
    }

    // MARK: SMS door

    @ViewBuilder
    private var smsSection: some View {
        if let target = sentTo {
            Section {
                Text("A 6-digit code was sent to \(target).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextField("SMS code", text: $otp)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .onChange(of: otp) { _, new in
                        // Digits only, capped at 6 - an OTP has no alphabet to alias, so
                        // there is nothing here for an EnrolmentCode-style normaliser to do.
                        otp = String(new.filter(\.isNumber).prefix(6))
                        otpErrorMessage = nil
                    }
                    .accessibilityLabel("SMS code")
                if let otpErrorMessage {
                    Text(otpErrorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                Button("Confirm") { verifyOtp() }
                    .disabled(session.busy || otp.count != 6)
                Button("Use a different number") {
                    sentTo = nil
                    otp = ""
                    otpErrorMessage = nil
                }
                .disabled(session.busy)
            } header: {
                Text("Sign in by SMS")
            }
        } else {
            Section {
                TextField("Phone number", text: $phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .onChange(of: phone) { _, _ in phoneErrorMessage = nil }
                    .accessibilityLabel("Phone number")
                if let phoneErrorMessage {
                    Text(phoneErrorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                } else {
                    Text("Start with 0 or +43, for example 0664 1234567.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("Send code") { requestCode() }
                    .disabled(session.busy || phone.isEmpty)
            } header: {
                Text("Sign in by SMS")
            }
        }
    }

    // MARK: Enrolment-code door

    private var enrolmentSection: some View {
        Section {
            TextField("Access code", text: $enrolmentInput)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .onChange(of: enrolmentInput) { _, _ in enrolmentErrorMessage = nil }
                .accessibilityLabel("Access code")
            if let enrolmentErrorMessage {
                Text(enrolmentErrorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            } else {
                Text("The one-time code your administration gave you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Button("Sign in with code") { submitEnrolmentCode() }
                .disabled(session.busy || EnrolmentCode.normalise(enrolmentInput) == nil)
        } header: {
            Text("Sign in with an access code")
        }
    }

    // MARK: Actions

    private func requestCode() {
        guard !session.busy, !phone.isEmpty else { return }
        let requested = phone
        Task {
            do {
                try await session.requestSmsCode(phone: requested)
                sentTo = requested
                phoneErrorMessage = nil
                otp = ""
                otpErrorMessage = nil
            } catch let failure as APIFailure {
                phoneErrorMessage = Self.phoneRequestMessage(for: failure)
            } catch {
                phoneErrorMessage = APIFailure(status: 0, code: "network").workerMessage
            }
        }
    }

    private func verifyOtp() {
        guard !session.busy, let target = sentTo, otp.count == 6 else { return }
        Task {
            do {
                try await session.verifySmsCode(phone: target, code: otp)
                // Success moves the whole screen to .eligible; nothing left to reset here.
            } catch let failure as APIFailure {
                otpErrorMessage = Self.otpVerifyMessage(for: failure)
            } catch {
                otpErrorMessage = APIFailure(status: 0, code: "network").workerMessage
            }
        }
    }

    private func submitEnrolmentCode() {
        guard !session.busy, let code = EnrolmentCode.normalise(enrolmentInput) else { return }
        Task {
            do {
                try await session.signInWithCode(code)
            } catch let failure as APIFailure {
                enrolmentErrorMessage = Self.enrolmentCodeMessage(for: failure)
            } catch {
                enrolmentErrorMessage = APIFailure(status: 0, code: "network").workerMessage
            }
        }
    }

    // MARK: Error copy
    //
    // Distinct per outcome and per field (decision-50 §1): the SAME server code means a
    // different next action depending on which field is on screen, so none of these go
    // through APIFailure.workerMessage's generic switch - that one is shift-sync copy.

    private static func phoneRequestMessage(for failure: APIFailure) -> String {
        switch failure.code {
        case "unknown_phone":
            // decision-51: the number is well-formed but not on file. Never the same
            // sentence as an invalid code - nobody re-issues this, the admin adds the number.
            return String(localized: "This number isn't on file. Please contact your administration so it can be added.")
        case "invalid_phone":
            return String(localized: "That phone number doesn't look right.")
        case "too_many_attempts":
            return String(localized: "Too many attempts - try again in a few minutes.")
        case "sms_not_configured":
            return String(localized: "SMS sign-in isn't set up on this server. Please use the access code below.")
        default:
            return failure.workerMessage
        }
    }

    private static func otpVerifyMessage(for failure: APIFailure) -> String {
        switch failure.code {
        case "invalid_code":
            // NEVER the enrolment field's "ask your admin for a new one" - an OTP is
            // re-requested by the WORKER, not reissued by an admin.
            return String(localized: "That code is wrong or has expired.")
        case "too_many_attempts":
            return String(localized: "Too many attempts - try again in a few minutes.")
        case "sms_not_configured":
            return String(localized: "SMS sign-in isn't set up on this server. Please use the access code below.")
        default:
            return failure.workerMessage
        }
    }

    private static func enrolmentCodeMessage(for failure: APIFailure) -> String {
        switch failure.code {
        case "invalid_code":
            return String(localized: "Code not accepted. Ask your admin for a new one.")
        case "too_many_attempts":
            return String(localized: "Too many attempts - try again in a few minutes.")
        default:
            return failure.workerMessage
        }
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
                                onDismissNotice: { switchNotice = nil })
                } else {
                    idleList
                }
            }
            .navigationTitle(running == nil ? "TimeSheet" : "Shift running")
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
                VStack(spacing: 6) {
                    Image(systemName: "wave.3.right")
                        .font(.title2)
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                    Text("Hold your phone to the tag by the entrance to start.")
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
            }
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

    private func refresh() async {
        await refreshRoster(context: context)
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
    private func handleTap(_ locationId: String) {
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
            action = "open"
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
                Section {
                    NavigationLink("Write a tag") { WriteTagScreen() }
                    NavigationLink("Test a tag") { VerifyZoneScreen() }
                } footer: {
                    Text("For staff who mount and test NFC tags. This never opens a shift.")
                        .font(.footnote)
                }
                Section {
                    Button("Sign out", role: .destructive) { Task { await session.signOut() } }
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
