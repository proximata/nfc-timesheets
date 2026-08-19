// W1 — empty the database, and make an operator a person identified by a phone number.
// RUN FIRST. Owns sql/, server/, web/. Do not run while any other workflow is live.
export const meta = {
  name: 'w1_reset_and_operator',
  description: 'Clear all production data, then introduce operators identified by phone number in one namespace with workers, with no clock-in of their own.',
  phases: [{ title: 'Design' }, { title: 'Data' }, { title: 'Admin' }, { title: 'Verify' }]
};

const MODEL = 'anthropic/claude-opus-5';
const REPO = '/Users/gerhardgustav/Desktop/ai-automations/hoiv/cleaning-timesheets';

const BASE = `
PROJECT: NFC TimeSheets, Vienna cleaning company. Android app for cleaners, web admin for the
director, public client portal. REPO: ${REPO}. Live: https://schimmer-glanz.exe.xyz (API + admin).
Tag host: https://timesheets.exe.xyz (association files + /t only, NEVER renamed).

READ FIRST: AGENTS.md · backlog/decisions/ (44 records, they BIND) · backlog/docs/ZONES-MODEL.md ·
IA-PLAN.md §9 · JOURNEYS.md · REDESIGN-INVENTORY.md · docs/brand/DESIGN.md + prototype.html.

STYLE: terse and technical. Lazy-senior-dev ladder before writing code: needed at all? stdlib?
native platform? already-installed dependency? one line? Mark deliberate shortcuts \`ponytail:\`
with their ceiling. Never simplify away input validation at trust boundaries, error handling that
prevents data loss, security, or accessibility. No time estimates.

CONSTRAINTS: no new npm dependency (server: pg + @sentry/node only) · money integer cents ·
Vienna timezone at boundaries incl. DST · de/en EXACT key parity, Austrian business German ·
390px must work · colour is always the SECOND signal · static export, client-side fetch only ·
login keeps type="text" autoComplete="username" · iOS OUT OF SCOPE, never touch
NFCTimeSheets/ or project.pbxproj · COMMIT AS YOU GO · a check whose negative case cannot fail
is not a check: seed the condition and show it RED first.

TRAPS: absolute /usr/bin/grep, /bin/ls, /usr/bin/awk, /usr/bin/git · no /usr/bin/timeout, no
setsid, no /usr/bin/cat · \`backlog task create\` HANGS without </dev/null · use demo/cdp.mjs, no
Playwright · same-origin to log in: cd web && pnpm build, run the API with PUBLIC_DIR=../web/out,
DB nfc_demo, \`sh demo/check-guards.sh\` first · stage EXPLICIT paths, never git add -A ·
PSST_SKIP_SCAN=1 accepted, gitleaks must pass.
`;

phase('Design');
const design = await agent(`${BASE}

Design the operator identity model. NO code, NO migration applied.

The owner's words: an operator is recognised BY PHONE NUMBER; there may be several operator
phones; operator phones must NEVER intersect worker phones; an operator does NOT clock in or out
because he reads and writes tags rather than cleaning; a worker can be created from the phone by
typing just a name and a phone.

Today: admins are a separate table with username+password (one row, 'schimmer'). Workers are a
separate table with an optional phone and an email used for Sign in with Apple. Nothing links them
and nothing enforces phone uniqueness across the two.

Answer, and justify each against what actually breaks if you choose wrong:
 - One table with a role, or two tables plus a shared phone registry? "Phones must not intersect"
   is a uniqueness constraint, and a constraint that spans two tables cannot be expressed in one
   index. Whatever you choose must make the collision IMPOSSIBLE, not merely unlikely.
 - Is an operator also allowed to be a worker (the owner cleans a building himself)? The owner
   said an operator has no clock-in. Say what happens when that person must clean.
 - What normalises a phone number? Austrian numbers get typed as 0664..., +43 664..., with spaces
   and slashes. Two spellings of one phone are the collision the constraint is supposed to stop.
   Store E.164 and say what is rejected at the boundary.
 - The admin logs in with a username and password today. Does phone identity REPLACE that or sit
   beside it? Replacing it in W1 would mean the owner's password stops working the moment this
   deploys, and SMS is not built until W5.

Also design the DATA RESET the owner asked for: clear all workers, locations, buildings, shifts,
tags, portal links. State the exact FK order, take a backup first, and make sure the operator can
still log in afterwards. Deleting the last admin locks the owner out of his own panel.

DELIVER: backlog/docs/OPERATOR-MODEL.md, decision records status PROPOSED, backlog tasks
(</dev/null). Name what the owner must decide before build. COMMIT.`,
  { label: 'w1-design', phase: 'Design', model: MODEL });

phase('Data');
const data = await agent(`${BASE}

DESIGN: ${design}

Build schema + server. You own sql/ and server/. Do not touch web/ or android/.
 - The migration for operator identity and the cross-table phone uniqueness.
 - Phone normalisation to E.164 at the trust boundary, with an explicit reject rather than a
   silent reformat. A worker created by phone from the app must land identically to one created
   in the panel.
 - An operator must have no clock-in path at all: prove POST /shifts/open refuses an operator
   session, and that this cannot be bypassed by sending a worker id.
 - The reset: a script, not hand-typed SQL, that takes a backup, deletes in FK order inside ONE
   transaction, recreates the operator, and REFUSES to run against any database it was not told
   to target. Show it refusing.
Extend server/check-api.js for every new route and refusal. Commit as you go.`,
  { label: 'w1-data', phase: 'Data', model: MODEL });

phase('Admin');
const admin = await agent(`${BASE}

DESIGN: ${design}
SERVER: ${data}

Admin UI. You own web/ including both message files.
 - Operator list: add, deactivate, several phones. The screen must state plainly that these
   phones cannot be worker phones, and show the collision as a real error, not a silent failure.
 - Worker creation gains phone as a first-class field with the same normalisation.
 - Everything at 390px, keyboard reachable, focus trapped and restored, Escape working, de/en
   parity with real Austrian German plurals.
Prove in the browser at 1680 and 390, dark and light; paste geometry. Commit as you go.`,
  { label: 'w1-admin', phase: 'Admin', model: MODEL });

phase('Verify');
const verify = await agent(`${BASE}

DESIGN: ${design}
DATA: ${data}
ADMIN: ${admin}

Verify. Assume every claim is optimistic.
 - Prove the phone collision is IMPOSSIBLE: try to create a worker with an operator's phone and
   an operator with a worker's phone, through the API, through the app's create path, and through
   direct SQL. All three must fail. Try both spellings of the same number.
 - Prove an operator cannot open a shift, by session and by forged body.
 - Run the reset against a RESTORED PRODUCTION DUMP in a scratch database, then prove the owner
   can still log in and that no orphan rows remain.
 - Standing battery: pnpm verify · check-api · check-close-flag · check-branding · check-guards ·
   every demo/ probe · widths 767..1680 · greyscale · ICU parity.
 - Mutation-test every NEW assertion: RED, restore, GREEN.
Update the backlog (</dev/null) with evidence. Write backlog/docs/W1-VERIFY.md, COMMIT, and end
with ONE LINE: SAFE TO DEPLOY or NOT, naming what blocks it. Do NOT deploy, do NOT touch
production data.`, { label: 'w1-verify', phase: 'Verify', model: MODEL });

return { design, data, admin, verify };
