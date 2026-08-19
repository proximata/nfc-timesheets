// W3 — write a tag on the phone; it lands in the panel as a card that must be resolved.
// RUN AFTER W2. Owns android/, server/, web/.
export const meta = {
  name: 'w3_tag_onboarding',
  description: 'Operator scans or writes a tag on the phone; every tag lands unbound in the admin as a card, resolved by attaching it to a zone.',
  phases: [{ title: 'Design' }, { title: 'Server' }, { title: 'App' }, { title: 'Panel' }, { title: 'Verify' }, { title: 'iOS' }]
};

const MODEL = 'anthropic/claude-opus-5';
const REPO = '/Users/gerhardgustav/Desktop/ai-automations/hoiv/cleaning-timesheets';

const BASE = `
PROJECT: NFC TimeSheets, Vienna cleaning company. REPO: ${REPO}.
API + admin: https://schimmer-glanz.exe.xyz. TAG HOST: https://timesheets.exe.xyz — tag URIs are
https://timesheets.exe.xyz/t?l=<uuid> and that host is written onto objects on walls, so it is
permanent. W1 shipped operators-by-phone; W2 shipped in-app update and operator-only log upload.
Zones exist (migration 006): a building contains zones, a zone carries a tag, an unzoned building
is grey but resolvable.

READ FIRST: AGENTS.md · backlog/decisions/ · ZONES-MODEL.md · OPERATOR-MODEL.md · JOURNEYS.md ·
docs/brand/DESIGN.md + prototype.html.

STYLE: terse and technical. Lazy-senior-dev ladder. Mark shortcuts \`ponytail:\`. Never simplify
away validation at trust boundaries, error handling that prevents data loss, security, or
accessibility. No time estimates.

TAG REALITY: tags are UNLOCKED and attacker-writable by decision-15; a serial is NOT a secret and
must never authenticate anything. The worker always comes from the session. Two tag kinds exist:
NTAG-class cards we write with a URL, and URL-less foreign tags identified by serial (46 bytes,
our URI does not fit). Both must work.

CONSTRAINTS: no new npm dependency · de/en parity, Austrian business German · 390px · colour is
always the SECOND signal · static export · COMMIT AS YOU GO · a check whose negative case cannot
fail is not a check · </dev/null on backlog commands · absolute /usr/bin/grep, /bin/ls,
/usr/bin/git · stage EXPLICIT paths.
`;

phase('Design');
const design = await agent(`${BASE}

Design tag onboarding end to end, from the owner's description:

  Operator opens the app -> sees locations / "add location" -> a popup says hold the tag to the
  reader -> the tag is READ FIRST -> the app says what it found: empty, one of ours, or someone
  else's (warn) -> offers REWRITE if possible -> writing carries a note or slug so the tag is
  identifiable later -> the tag LANDS IN THE SYSTEM UNBOUND and appears on the admin panel as a
  CARD THAT NEEDS RESOLVING, in a contrasting colour -> resolving it means attaching it to a
  zone: a new zone in a new building, or an existing zone. ALL DATA ENTRY IS ON THE WEB ADMIN.
  The app only scans and starts the flow. Creating another zone from the admin notifies the
  phone; tapping the notification opens the write flow; that tag lands on the same panel.

Decide and defend:
 - What is physically WRITTEN on the tag? A zone uuid is the obvious answer, but a tag is written
   BEFORE the zone exists in this flow. Either the app mints an id and the panel later binds it,
   or the tag is written twice. One of these means visiting the building again — say which you
   chose and what it costs.
 - What does the server know about a tag that is bound to nothing? Model it explicitly rather
   than as a zone with null fields.
 - What happens when the same tag is scanned twice, or written twice, or written by two operators
   at once? Idempotency here is the difference between one card and forty.
 - A tap on an UNBOUND tag by a cleaner: what happens? It must not open a shift against nothing,
   and it must not look like the app is broken. This will happen — tags get mounted before anyone
   resolves the card.
 - Rewriting someone else's tag is destructive and irreversible. What is shown before it happens?
 - What identifies a tag in the database: uuid, hardware serial, or both? Foreign tags have no
   URL, so the serial is the only handle for them.

DELIVER: backlog/docs/TAG-ONBOARDING.md, decision records (PROPOSED), backlog tasks (</dev/null).
Name what the owner must decide before build. COMMIT.`,
  { label: 'w3-design', phase: 'Design', model: MODEL });

phase('Server');
const server = await agent(`${BASE}

DESIGN: ${design}

Server. You own sql/ and server/.
 - Unbound tags as first-class rows; binding a tag to a zone; creating a zone and a building from
   a card. Every write idempotent on a client-supplied key, as POST /shifts already is.
 - A tap on an unbound or unresolved tag answers something the app can explain, never a 500 and
   never a shift against nothing.
 - The notify-the-phone path for "create a zone from the admin". Decide the mechanism honestly:
   push needs infrastructure that does not exist, so a polled queue may be the lazy correct
   answer. Say which and name the ceiling.
 - Serial lookup stays rate-limited, never logged, and unknown/inactive answer identically so it
   cannot enumerate zones.
Extend server/check-api.js for every route and refusal, including the double-write and
two-operators-at-once races. Commit as you go.`,
  { label: 'w3-server', phase: 'Server', model: MODEL });

phase('App');
const app = await agent(`${BASE}

DESIGN: ${design}
SERVER: ${server}

Android. Operator-only tag flow; the app never enters business data.
 - Read first, always: report empty / ours / foreign before offering to write, in German.
 - Rewrite is destructive: confirm with what will be lost, and refuse silently-failing writes
   (tag too small for our URI is the known case — 46-byte foreign tags cannot hold it).
 - Handle the stairwell: tag moved away mid-write, tag read-only, tag locked, NFC off, phone is
   not the operator's, network down. A half-written tag must be detectable and recoverable.
 - A cleaner must never see any of this, and clock-in must never be blocked by it.
 - Still NO in-app button that closes a shift.
Build a signed release APK; run android/checks/; state versionCode/versionName and path.
Commit as you go.`, { label: 'w3-app', phase: 'App', model: MODEL });

phase('Panel');
const panel = await agent(`${BASE}

DESIGN: ${design}
SERVER: ${server}

Web admin. You own web/ including both message files.
 - Unresolved tag cards, in a colour that says "this needs you", with colour never the only signal.
 - Resolving a card: attach to a new zone in a new building, or to an existing zone. This is the
   only place business data is entered.
 - A card must be resolvable days later by someone who was not in the stairwell: show the note or
   slug, when it was written, by which operator, and the tag's own identity.
 - Empty state is not an error: no unresolved cards is good news and should read as such.
 - 390px, keyboard reachable, focus trapped and restored, Escape, de/en parity with real plurals.
Prove in the browser at 1680 and 390, dark and light; paste geometry. Commit as you go.`,
  { label: 'w3-panel', phase: 'Panel', model: MODEL });

phase('Verify');
const verify = await agent(`${BASE}

DESIGN: ${design}
SERVER: ${server}
APP: ${app}
PANEL: ${panel}

Verify. Assume every claim is optimistic.
 - Prove a tag written twice produces ONE card. Prove two operators writing at once produce one.
 - Prove a cleaner tapping an unbound tag opens no shift and sees an explanation.
 - Prove an existing bound tag still clocks in — the wall tag and the field APK must not regress.
 - Prove rewriting warns before destroying, and that a too-small tag fails loudly.
 - Prove the app cannot enter business data, and that a non-operator cannot reach the flow.
 - Standing battery: pnpm verify · check-api · check-close-flag · check-branding · check-guards ·
   every demo/ probe · widths 767..1680 · greyscale · ICU parity · android/checks/.
 - Mutation-test every NEW assertion: RED, restore, GREEN.
Write backlog/docs/W3-VERIFY.md, update the backlog (</dev/null), COMMIT, end with ONE LINE:
SAFE TO DEPLOY or NOT.`, { label: 'w3-verify', phase: 'Verify', model: MODEL });

phase('iOS');
const ios = await agent(`${BASE}

VERIFY: ${verify}

OPTIONAL AND LAST. The owner wants a minimal iOS build so the onboarding DRAFT can be walked
through on an iPhone; after this iteration iOS is not required.

FIRST, ARGUE AGAINST DOING IT. iOS was deliberately dropped until a first iOS user appears; the
owner hand-edits project.pbxproj so no agent may touch it; a Widget Extension and capabilities
need Xcode clicks only the owner can make; and the entire flow is already walkable on the Android
phone he has. If the honest answer is "do not build this", say so in one paragraph and STOP.

If it is worth doing, ship the SMALLEST thing that lets the draft be walked: reading a tag and
showing what it is. Do NOT touch project.pbxproj or the entitlements. State every Xcode click the
owner must perform, in order, and what each failure looks like. Anything requiring a capability
change is the owner's, not yours.`, { label: 'w3-ios', phase: 'iOS', model: MODEL });

return { design, server, app, panel, verify, ios };
