---
id: TASK-52
title: 'RESEARCH: store-independent app delivery on Android and iOS'
status: Wont Do
assignee: []
created_date: '2026-08-11 23:04'
updated_date: '2026-08-26 08:18'
labels:
  - research
  - android
  - ios
  - distribution
dependencies: []
priority: low
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
RESEARCH ONLY - produce a written verdict, change no shipping code.

WHY THE QUESTION IS REAL. Every fix so far has reached a worker either by a sideloaded APK sent over Telegram or by a TestFlight build the owner cuts by hand in Xcode. Both are slow, and the iOS half puts Apple review between a bug and the person hit by it. The in-shift clock-out bug is the case in point: fixed in minutes, and reaching an iPhone still needs a whole release. A white-label buyer makes it worse - their crew are not internal testers (decision-27 already names this ceiling).

ANDROID - deliver new APKs from the app itself. Believed workable and the cheaper half:
  - PackageInstaller plus REQUEST_INSTALL_PACKAGES. Establish what the user actually sees
    on modern Android, since a confirmation dialog per update changes whether cleaners
    would tolerate it.
  - the update MUST be signed with the same upload key (~/keys/nfc-upload.jks) or it will
    not install over the existing app, and a wrong key means uninstall-and-lose-the-session.
  - CHECK THE POLICY BOUNDARY FIRST: Play forbids apps distributed through Play from
    updating themselves. We currently sideload, so this may be free - but TASK-43 wants a
    Play listing, and the two may be mutually exclusive. Answer that before designing
    anything.
  - security is the whole problem, not an afterthought: an app that installs code is a
    distribution channel, so signature verification and a trusted update source are
    load-bearing. Getting this wrong is strictly worse than slow updates.

iOS - to what extent may an app modify itself. Start from the constraint, not the wish:
  - App Review guideline 2.5.2 bans downloading and executing arbitrary code. The known
    lawful gap is INTERPRETED code run by JavaScriptCore/WebKit that does not change the
    app's primary purpose - this is the ground CodePush and Expo OTA stand on. Establish
    exactly where the line sits today, with citations, not folklore.
  - therefore the real question is architectural: how much of this app would have to become
    interpreted (JS) for meaningful fixes to ship without review. The tap path, SwiftData
    and Sign in with Apple are all native, so the honest answer may be 'almost none of the
    parts that break'.
  - EU ANGLE, possibly the most valuable finding and easy to overlook: the business is in
    Vienna. Since iOS 17.4 the DMA permits alternative app marketplaces and Web
    Distribution in the EU. Determine the real cost - Apple's entitlement, the notarisation
    step, the developer terms, and whether a company this size qualifies at all.
  - also cover the boring-but-legitimate options and compare them honestly: TestFlight as
    the actual update channel, ad-hoc distribution and the 100-device limit, and the Apple
    Developer Enterprise Programme (which almost certainly does NOT permit distribution to
    a customer's cleaners - confirm and write down why).

DELIVERABLE: one document per platform stating what is permitted, what it costs, what it
risks, and a recommendation. Include the null result if that is the truth: 'iOS cannot do
this meaningfully and TestFlight is the answer' is a valuable finding and stops this being
re-litigated every few months.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed 2026-08-26: moot. Android and iOS both now ship through their real stores (Play Console internal testing via play-release.yml CI; Xcode Cloud -> TestFlight). The self-update mechanism this research was scoping around was itself deleted the same day. Re-file if store distribution ever becomes untenable again.
<!-- SECTION:NOTES:END -->
