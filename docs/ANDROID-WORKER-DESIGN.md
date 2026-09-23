# Android worker design: Blue Hour

TASK-363, 23 September 2026. Replaces TASK-360's rejected Calm Route presentation.
Scope: the worker shift flow, delivery status, receipt and shared Android presentation.

## Design brief

Design for a cleaner checking a phone for two seconds at a building entrance. Answer in
order: is my shift running, how much time has elapsed, has the office received it, what
can I do next? Start with a new composition rather than restyling the old timer card.
Use proportional Android sans typography, clear actions, restrained vector illustration
and one finite payment-like confirmation. Never let animation imply server acceptance
of a locally queued event. Keep pending hours visible without exposing retry mechanics
on the main screen. Support German, English, large text, dark mode and reduced motion.

An independent Sol designer compared three directions:

| Direction | Strength | Trade-off | Choice |
| --- | --- | --- | --- |
| Blue Hour | Time directly on a quiet fixed-blue field; clear hierarchy | Needs strong contrast and compact secondary information | Selected |
| Paper Route | Neutral editorial timeline, useful for multi-site planning | A timeline competes with the one current action | Not selected |
| Dial | Circular timer naturally suggests contactless interaction | A persistent ring implies a target/countdown that does not exist | Borrow only the brief confirmation ring |

## Final composition

- Running uses decision-60's fixed blue field, with a small state heading, subordinate
  24sp site, start time and large proportional hour/minute numerals. Seconds are smaller.
  There is no white timer card. An explicit state word remains below time (decision-60).
- Timer figures use the font's tabular-number feature, not a monospace font. Actual
  Compose text measurements fit the width under Android's nonlinear font scaling.
- Tap scanning is the primary action on NFC-capable phones. Manual stop stays reachable
  and still opens the existing confirmation. Unsupported phones use a clock glyph and
  a clear manual action rather than suggesting a tag read they cannot perform.
- Running schedules are a short planned-assignment row. Full details expand deliberately.
  Help opens a dialog. Neither occupies a large white block on the default running view.
- Idle has a date/page heading, one focused glyph and action, then pending status,
  upcoming work and recent receipts. Neutral shared surfaces have 18dp corners.
- Recent finishes have a receipt: site, start/end, duration, correction state and delivery
  state. A receipt entered within two minutes stays until Continue; it does not disappear
  during reading. Passive tag handling and bottom navigation remain available.
- Idle reuses the compact planned-assignment summary. Materials has a flat composer with
  a small vector header, concise visible no-push note and detailed explanation on demand.
  Account retains its functions and shares the typography, surfaces and navigation.
  No new backend or persistence architecture is introduced.

## Confirmation motion

Motion begins only after a clean server ACK. The local write, timer semantics and controls
already exist; no animation callback writes a shift or changes accounting/navigation.

| Stage | Visual |
| --- | --- |
| 0–430ms | Fine ring draws in one turn, with a restrained scale change |
| 390–570ms | A check stroke draws inside the ring |
| 600–720ms | Check and ring fade upward |
| 720–900ms | Time or completed receipt fades upward into its stable position |

Check and digits do not overlap. Android's animator duration scale applies, including zero.
A presentation-only preference consumes each receipt identity before motion; recreation,
tab return and ordinary resume show the stable state. Clock-in and clock-out consumption
are separate. Restored old shifts update without an entrance animation. The eligibility
window is 45 seconds from the event; late delivery is still confirmed in text but does not
celebrate an old event. Pending or failed states never show the confirmation check.

## Delivery status

Waiting and rejected counts have separate persistent, tappable rows. Details open a sheet
with the counts, oldest start and last attempt. Rejected records explicitly require the
office and do not promise automatic retry. Waiting records distinguish an armed scheduler,
an unarmed scheduler and signed-out state. The Android force-stop limitation belongs in
these details. Dismissing details does not dismiss or delete queued records.

## Preserved invariants and verification

Manual start/stop confirmations, correction markers, eight-hour resolution, operator
version-tap entry, authenticated identity and NFC/zone verification remain intact. No new
library, networking path, endpoint, database migration or release-only behavior is added.
All new worker-facing copy ships in German default and English together.

Build and runtime evidence lives under `captures/company-workspaces/android-reset/`:
selected brief, independent review, emulator screenshots, videos, runtime matrix and check
logs. The emulator can exercise injected tag intents and a real local API/Postgres fixture;
it cannot prove physical NFC reading. Production and Google Play were not updated.
