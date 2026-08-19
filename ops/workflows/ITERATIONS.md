# What you said, split into iterations

## Iteration 1 — an operator can log in and exists as a person (W1)

- Wipe everything: workers, locations, buildings, shifts, tags, portal links. Keep one
  admin so you are not locked out of your own panel while doing it.
- An OPERATOR is identified by PHONE NUMBER. Multiple operator phones allowed.
- Operator phones and worker phones live in ONE namespace and may never collide, so the
  uniqueness has to be enforced by the database, not by a screen.
- An operator is NOT a cleaner: no clock-in, no clock-out. He reads and writes tags.
- Create a worker from the phone by typing name + phone.

## Iteration 2 — the app you can actually field (W2, W3)

- In-app update: the app asks the server for the current version, downloads, prompts.
- Send-logs button, visible only to an operator.
- Tag onboarding on the phone: hold tag to reader -> read it -> say what it is
  (empty / ours / someone else's) -> offer rewrite -> rewrite carries a note or slug so
  the tag is identifiable later.
- Every tag written LANDS IN THE SYSTEM UNBOUND and appears on the admin panel as a card
  that needs resolving, in a colour that says so.
- Resolving a card = attaching it to a zone: a new zone in a new building, or an existing
  one. All data entry is on the WEB ADMIN. The app only scans and starts the flow.
- Creating another zone from the admin sends a notification to the phone; tapping it opens
  the write flow; the written tag lands on the same panel.

## Iteration 3 — the surfaces around it (W4), then SMS (W5)

- Right-side collapsible activity feed, colour-coded, tabbed: operator actions vs worker
  actions. Shift start and end appear there too.
- Scan-and-read: read a card and see which zone it is and that zone's work history.
- The property owner's shareable link gains an optional phone number and a QR code / short
  code, so the owner can open the app and see ONLY his own location. Third role.
- Twilio SMS login LAST, replacing enrolment codes.

## What I would change, and why

**iOS "quick and minimal" is the one item I would drop.** You already decided iOS waits
until a first iOS user appears, and you hand-edit `project.pbxproj` so agents may not
touch it. A minimal iOS build of this flow is not small: it needs the tag write path,
the operator role, the update check and the log upload, on a platform where we cannot
even build without you. Meanwhile the whole flow is testable on the Android phone you
already have. If you want iOS for the draft anyway, it is W3's last phase and it will
cost more than the Android half.

**Three enrolment mechanisms will exist at once** after W4: Sign in with Apple (iOS),
enrolment codes (Android), and the owner's QR/short code. Each is a way into a session.
W5 then adds a fourth and removes one. That is the part of this plan most likely to
produce a lockout, which is why it is last and alone.

**"Clear all data" is irreversible and includes your own admin.** W1 takes a backup first
and recreates one operator before it finishes, or you cannot get back in.

**A short code the owner types is a credential.** Four letters is roughly a million
guesses at best and these codes sit in a URL a client forwards by email. W4 sizes it
properly and rate-limits it; it will not be four letters.
