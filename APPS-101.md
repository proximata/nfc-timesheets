**HelloNFC — full plan, stub → TestFlight → production NFC launch**

**0. Blocker / first action**

Enroll Apple Developer Program, developer.apple.com/programs, $99/year. Required for uploading builds and inviting testers through App Store Connect; NFC entitlement + Associated Domains also unavailable on free Personal Team. Free account only = run on own iPhone via cable, 7-day signing. Approval hours–2 days. Enroll first, build while waiting.

**1. Prereqs**

1. Mac, macOS Tahoe 26.2 or later, Xcode 26.6 — latest stable, released June 25, 2026. Ignore Xcode 27 beta. Since April 28, 2026 App Store Connect uploads require Xcode 26+ and iOS 26 SDK.
2. Physical iPhone — NFC dead in simulator. In-app read: iPhone 7+. Background tag reading: iPhone XS and newer only.
3. NTAG213/215 sticker tags (~$10/10-pack) + "NFC Tools" app for writing.

**2. Project**

Xcode → New → iOS App → SwiftUI/Swift. Bundle ID `com.yourname.hellonfc` — unique, permanent. Signing & Capabilities → your paid team, auto-signing on.

**3. Launch paths — verdict**

- Path A, Shortcuts automation: Shortcuts → Automation → + → NFC → scan blank tag → action "Open App" → disable "Ask Before Running". Zero code, works today. Manual per-phone setup → dev/stub only. **Dies after stub.**
- Path B, in-app Core NFC scan: capability "Near Field Communication Tag Reading" + Info.plist `NFCReaderUsageDescription`. Button-triggered read while app open. **Keep as manual re-scan fallback.**
- Path C, background tag reading: **production way.** System scans NDEF tags without any app, shows notification, tap delivers tag data to the app; URI record must contain universal link — system launches associated app, no app installed → Safari opens the URL → point at landing page with App Store link, free onboarding fallback.

Production stack = C + B.

**4. Auto-read semantics (your question)**

Path C: iOS reads tag **before** launch. Payload arrives with launch as NSUserActivity — no session, no button, no second read. Not zero-touch though: user must tap the notification banner — deliberate opt-in privacy design, iOS never silently launches app from tag. Detector for "opened via NFC": first NDEF record `typeNameFormat != .empty`; non-NFC activities return single record with typeNameFormat .empty.

Shortcuts variant with auto-read: shortcut action "Open URLs" → `hellonfc://scan` (register URL Type) → `.onOpenURL` starts scan programmatically. Works but double-tap UX — Shortcuts consumed first tap, Core NFC sheet demands tag again. Dev-only. Programmatic `beginScanning()` fine when user intent exists (tag tap); don't auto-scan on plain direct launches — review risk.

**5. Code**

```swift
// ContentView.swift
import SwiftUI
import CoreNFC

struct ContentView: View {
    @StateObject private var nfc = NFCReader()

    var body: some View {
        VStack(spacing: 20) {
            Text("Hello, World!").font(.largeTitle)
            Text(nfc.message).foregroundStyle(.secondary)
            Button("Scan NFC Tag") { nfc.beginScanning() }   // Path B fallback
                .buttonStyle(.borderedProminent)
        }
        .padding()
        // Path C: launched via universal link from background tag read
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            let ndef = activity.ndefMessagePayload
            guard let rec = ndef.records.first, rec.typeNameFormat != .empty else {
                return   // plain link launch, not NFC
            }
            nfc.message = "NFC launch: " +
                (rec.wellKnownTypeURIPayload()?.absoluteString ?? "non-URI payload")
        }
        // Dev-only Shortcuts trick: hellonfc://scan → auto-start session
        .onOpenURL { url in
            if url.scheme == "hellonfc" { nfc.beginScanning() }
        }
    }
}
```

```swift
// NFCReader.swift
import Foundation
import CoreNFC

final class NFCReader: NSObject, ObservableObject, NFCNDEFReaderSessionDelegate {
    @Published var message = "No tag scanned yet"
    private var session: NFCNDEFReaderSession?

    func beginScanning() {
        guard NFCNDEFReaderSession.readingAvailable else {
            message = "NFC not available"; return
        }
        session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
        session?.alertMessage = "Hold iPhone near tag."
        session?.begin()
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        let text = messages.flatMap(\.records)
            .compactMap { String(data: $0.payload, encoding: .utf8) }
            .first ?? "Tag read, empty payload"
        DispatchQueue.main.async { self.message = text }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {}
}
```

Info.plist: `NFCReaderUsageDescription` = "Reads NFC tags to say hello."; `ITSAppUsesNonExemptEncryption` = `NO` (skips export-compliance question per upload).

**6. Path C infrastructure**

1. Host AASA at `https://yourdomain/.well-known/apple-app-site-association` — raw JSON, no redirect, no `.json` extension, valid TLS, `application/json`. Content: `applinks` → `"appIDs": ["TEAMID.com.yourname.hellonfc"]`. No domain → `username.github.io` via GitHub Pages, $0.
2. Capability Associated Domains → `applinks:yourdomain`.
3. Write tag NDEF URI = `https://yourdomain/hello` via NFC Tools.
4. Gotchas: device fetches AASA through Apple CDN at app install — AASA changed after install → delete + reinstall; CDN cache propagation hours–day. Finalize AASA **before** archiving.
5. Fast dev loop: entitlement `applinks:yourdomain?mode=developer` + iPhone Settings → Developer → Associated Domains Development on → AASA fetched direct from server, iterate in minutes. Drop `?mode=developer` before archive.
6. Sanity check without tag: paste link in Notes, long-press → "Open in HelloNFC" appears = association live.
7. Background read disabled when: never unlocked since boot, Core NFC session active, Wallet in use, camera in use, airplane mode.

**7. Run on device**

Cable, trust Mac, Cmd+R. Phone: Settings → General → VPN & Device Management → trust cert. Verify button scan + Shortcuts automation.

**8. TestFlight SDLC**

TestFlight = valid Path C test: distribution-signed build fetches AASA via Apple CDN, same route as App Store. NFC entitlement + associated domains survive intact.

1. appstoreconnect.apple.com → Apps → + → New App: iOS, name, bundle ID, SKU.
2. Xcode: Version 1.0, Build 1 → destination "Any iOS Device (arm64)" → Product → Archive → Distribute App → App Store Connect → Upload.
3. Processing 5–30 min, build appears in TestFlight tab.
4. Internal track: up to 100 testers, must be App Store Connect users with Account Holder/Admin/App Manager/Developer/Marketing role, install immediately after processing, no Beta App Review. Add yourself, install TestFlight app, accept invite. Fastest loop: archive → upload → minutes → phone.
5. External track: up to 10,000 testers; first build of a version must clear Beta App Review, typically 24–48h; needs beta description + feedback email; invite by email or public link — anyone with URL joins. Max 6 builds per 24h to Beta App Review; later builds of same version reach testers in minutes.
6. Iterate: code change → bump Build only → Archive → Upload → auto-distribute to groups.
7. Limits: build unavailable after 90 days; tester installs on up to 30 devices. Feedback + crashes: App Store Connect → TestFlight → Feedback.

**9. Test order / done**

1. Stub done = tag tap opens app (A), button reads payload (B), build 1.0(1) on phone via internal TestFlight.
2. Path C: dev-mode loop until Notes long-press works → tag notification launches app with payload → TestFlight internal build, repeat both checks. That validates production end-to-end.
3. A deleted, ship C + B.

