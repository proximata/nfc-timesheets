// W4 — the activity feed, reading a tag's history, and letting a building owner in.
// RUN AFTER W3. Owns web/, server/, android/.
export const meta = {
  name: 'w4_feed_and_client_access',
  description: 'A collapsible tabbed activity feed, scan-a-tag-to-see-its-history, and QR/code access for a building owner who sees only his own building.',
  phases: [{ title: 'Feed' }, { title: 'Read' }, { title: 'Client' }, { title: 'Verify' }]
};

const PLANNER  = 'anthropic/claude-sonnet-5';   // plans, with ultrathink
const WORKER   = 'anthropic/claude-sonnet-5';   // writes the code
const VERIFIER = 'anthropic/claude-opus-5';     // tries to break it

// Every work item is planned before it is built. The plan is written by a model asked to
// think hard and touch nothing; the build is a separate agent that receives it. Splitting
// them is the point: a planner with no edit rights cannot quietly start implementing, and a
// builder handed a plan cannot quietly redesign. Both are Sonnet; verification is not.
async function planned(brief, opts) {
  const plan = await agent(
    brief +
    "\n\n--- THIS AGENT PLANS ONLY. IT WRITES NO CODE AND EDITS NO FILE. ---\n" +
    "ultrathink\n\n" +
    "Think it through before answering. Read the code the task touches, not just the brief.\n" +
    "Produce: the files you would change and why · the order · the decision records and\n" +
    "constraints above that BIND this work, quoted · what could go wrong at each step and\n" +
    "what would prove it did · the checks whose negative case must be shown RED first · what\n" +
    "is genuinely ambiguous in the brief, stated as a question rather than a guess.\n" +
    "Apply the lazy-senior-dev ladder in the plan itself: say what should NOT be built, and\n" +
    "where an already-installed dependency or one line beats new code. Name what you would\n" +
    "NOT do and why. A plan that only lists work is half a plan.",
    { ...opts, label: opts.label + '-plan', model: PLANNER }
  );
  return agent(
    brief +
    "\n\n--- PLAN FROM THE PLANNING AGENT ---\n" + plan +
    "\n\n--- BUILD IT ---\n" +
    "Follow the plan. Where it is wrong, say so explicitly and explain before diverging —\n" +
    "do not silently do something else. Where it asked a question the brief cannot answer,\n" +
    "record it for the owner rather than guessing. Commit as you go.",
    { ...opts, model: opts.model || WORKER }
  );
}
const REPO = '/Users/gerhardgustav/Desktop/ai-automations/hoiv/cleaning-timesheets';

const BASE = `
PROJECT: NFC TimeSheets, Vienna cleaning company. REPO: ${REPO}.
API + admin: https://schimmer-glanz.exe.xyz. Tag host: https://timesheets.exe.xyz.
W1 operators-by-phone · W2 in-app update + log upload · W3 tag onboarding and unbound tag cards.

READ FIRST: AGENTS.md · backlog/decisions/ · TAG-ONBOARDING.md · OPERATOR-MODEL.md ·
ZONES-MODEL.md · JOURNEYS.md · docs/brand/DESIGN.md + prototype.html.

STYLE: terse and technical. Lazy-senior-dev ladder. Mark shortcuts \`ponytail:\`. Never simplify
away validation at trust boundaries, error handling that prevents data loss, security, or
accessibility. No time estimates.

CONSTRAINTS: no new npm dependency · de/en parity, Austrian business German · 390px · colour is
always the SECOND signal · static export, client-side fetch only · COMMIT AS YOU GO · a check
whose negative case cannot fail is not a check · </dev/null on backlog commands · absolute
/usr/bin/grep, /bin/ls, /usr/bin/git · stage EXPLICIT paths, never git add -A.
`;

phase('Feed');
const feed = await planned(`${BASE}

Build the activity feed the owner described: on the RIGHT, COLLAPSIBLE, COLOUR-CODED, with TABS
separating operator actions from worker actions. Shift start and end appear in it, as do tag
writes and card resolutions.

 - A feed is the first thing that becomes noise. Decide what does NOT go in it, and say why.
 - Colour-coded means colour is the SECOND signal: it must read correctly in greyscale and to a
   colour-blind director. Prove it with the project's greyscale probe.
 - Collapsed is a state that must survive a reload, and it must not steal width from the data at
   1280px or make anything unreachable at 390px.
 - Tabs must not hide the thing that needs attention. If an unresolved tag card is sitting in the
   operator tab while the director is on the worker tab, the panel is lying by omission.
 - Live-ish or on refresh? Polling has a cost on a box that also runs Postgres. Choose and name
   the ceiling.

Prove at 1680, 1280 and 390, dark and light, collapsed and expanded; paste geometry.
Commit as you go.`, { label: 'w4-feed', phase: 'Feed' });

phase('Read');
const read = await planned(`${BASE}

FEED: ${feed}

Add scan-to-read in the Android app: hold a tag, see WHICH ZONE it is and that zone's recent work
history. No writing, no shift.

 - This is the diagnostic an operator uses in a stairwell when someone says "the tag does not
   work". Make it answer that question: is this tag known, which zone, when was it last cleaned,
   by whom.
 - Worker names: the client portal deliberately shows FIRST NAME ONLY on GDPR grounds. An
   operator is staff, so full names are defensible — but say why, rather than inheriting it by
   accident.
 - Unknown tag, foreign tag, unbound tag, network down: each gets a specific German answer.
 - It must never open or close a shift, and must be operator-only.
Build a signed release APK; run android/checks/; state versionCode/versionName and path.`,
  { label: 'w4-read', phase: 'Read' });

phase('Client');
const client = await planned(`${BASE}

READ: ${read}

Let a building owner in, from the shareable link that already exists at /reinigung/?token=...

The owner's description: on that page he can optionally leave his phone number, and there is a
QR code (or a short code) he can use to open the APP and see ONLY his own building — a third
role, read-only, nothing else visible.

 - THE CODE IS A CREDENTIAL. The owner said "four letters"; four letters is guessable and these
   links get forwarded by email. Size it with real arithmetic (keyspace vs guess rate vs how many
   live codes exist), hash it at rest as every other token here is, expire it, make it revocable
   in one click, rate-limit it, and never log it. Show the arithmetic.
 - Unknown and revoked codes must answer IDENTICALLY, as the portal's 404s already do.
 - What this role may see is a GDPR decision, not a UI one: the portal payload today is
   deliberately minimal — building name, date, worker FIRST NAME, duration. The app must not
   quietly show more than the web portal does. State the payload explicitly and justify every
   field beyond the existing four.
 - The phone number is optional and belongs to a client, not a worker: say where it lives, who
   can see it, and confirm it does not collide with the operator/worker phone namespace from W1.
 - This role has no clock-in, no clock-out, no tag writing, no other building. Prove each.
Commit as you go.`, { label: 'w4-client', phase: 'Client' });

phase('Verify');
const verify = await agent(`${BASE}

FEED: ${feed}
READ: ${read}
CLIENT: ${client}

Verify. Assume every claim is optimistic.
 - Prove the client role cannot see another building, cannot clock in, cannot write a tag, and
   cannot enumerate anything by guessing codes. Try 20 mangles.
 - Prove revoked and unknown codes are byte-identical.
 - Prove the feed reads correctly in greyscale and that collapsed state survives reload.
 - Prove scan-to-read never opens a shift, including with a running shift.
 - Prove no new PII leaves the API: the app's client view must not carry surnames, emails, rates
   or other buildings. Grep the actual bytes.
 - Standing battery: pnpm verify · check-api · check-close-flag · check-branding · check-guards ·
   every demo/ probe · widths 767..1680 · greyscale · ICU parity · android/checks/.
 - Mutation-test every NEW assertion: RED, restore, GREEN.
Write backlog/docs/W4-VERIFY.md, update the backlog (</dev/null), COMMIT, end with ONE LINE:
SAFE TO DEPLOY or NOT.`, { label: 'w4-verify', phase: 'Verify', model: VERIFIER });

return { feed, read, client, verify };
