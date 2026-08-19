// W2 — the app can update itself, and an operator can send logs from a phone you cannot plug in.
// RUN AFTER W1. Owns android/ plus two server routes.
export const meta = {
  name: 'w2_android_update_and_logs',
  description: 'In-app update for a sideloaded Android app, and an operator-only send-logs button.',
  phases: [{ title: 'Update' }, { title: 'Logs' }, { title: 'Verify' }]
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
W1 has shipped: operators are identified by phone and are distinct from workers.

READ FIRST: AGENTS.md · backlog/decisions/ · backlog/docs/OPERATOR-MODEL.md · ops/REBRAND.md.

STYLE: terse and technical. Lazy-senior-dev ladder before code. Mark shortcuts \`ponytail:\` with
their ceiling. Never simplify away validation at trust boundaries, error handling that prevents
data loss, security, or accessibility. No time estimates.

DISTRIBUTION REALITY: the app is SIDELOADED, signed with the upload key at ~/keys/nfc-upload.jks
(password in psst tag android). It is NOT on Play. Google forbids self-updating for
Play-distributed apps, so this feature and a Play listing are mutually exclusive — say so in the
decision record. One phone is in the field with a live worker session in SharedPreferences,
allowBackup="false": installing OVER keeps the session, uninstalling first wipes it.

CONSTRAINTS: no new npm dependency server-side · Android: JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home,
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools · iOS OUT OF SCOPE · COMMIT AS YOU GO ·
a check whose negative case cannot fail is not a check · \`backlog task create\` needs </dev/null ·
absolute /usr/bin/grep, /bin/ls, /usr/bin/git · stage EXPLICIT paths, never git add -A.
`;

phase('Update');
const update = await planned(`${BASE}

Give the Android app an in-app update path, because every fix currently requires the owner to
hand someone a file over Telegram.

 - The app asks the server for the current version; if newer, it offers to update, downloads the
   APK and installs it via PackageInstaller + REQUEST_INSTALL_PACKAGES.
 - The server serves the APK and a small version document. Decide where the APK lives and who may
   fetch it, and justify it: an unauthenticated APK download is a stranger installing your app,
   while an authenticated one cannot be fetched by a worker whose session has expired — which is
   exactly when they need the update.
 - SIGNATURE IS THE TRUST BOUNDARY. Android will refuse an update signed with a different key,
   which is the behaviour you want; make the failure LEGIBLE instead of a silent "app not
   installed". State what happens if the owner ever loses ~/keys/nfc-upload.jks: the answer is
   that this package can never be updated again, and that belongs in the decision record.
 - Never interrupt a running shift to update. A cleaner mid-shift must be able to say no, and an
   update must never be the reason a clock-out fails.
 - Handle: no network, partial download, install refused by the user, storage full, and a server
   older than the app.

Write a decision record (PROPOSED) covering the Play mutual-exclusivity and the key-loss ceiling.
Build a signed release APK; state versionCode/versionName and path. Commit as you go.`,
  { label: 'w2-update', phase: 'Update' });

phase('Logs');
const logs = await planned(`${BASE}

UPDATE PHASE: ${update}

Add a send-logs button, visible ONLY to an operator (W1's role, recognised by phone).

 - What gets sent must be decided before anything is sent. Logs from a cleaner's phone can carry
   a session token, a worker email, a phone number, a tag serial and location history. Define the
   payload as an ALLOWLIST, not a denylist, and scrub at the boundary. This is a GDPR surface:
   the project already scrubs identity tokens, session cookies, the app key, worker emails and
   hourly rates at the Sentry boundary — reuse that vocabulary, do not invent a second one.
 - The worker must be able to see WHAT is being sent before it goes, in German, in plain words.
 - Where do logs land, who can read them, and how long do they live? An unbounded log sink on the
   API box is a disk-full outage that takes payroll down with it.
 - Rate-limit it. A stuck button must not post fifty megabytes.
 - It must work when the thing being debugged is the network: queue and retry, and say so.

Build a signed release APK. Run every check in android/checks/ (each needs its documented
dependency set concatenated; there is no runner). Commit as you go.`,
  { label: 'w2-logs', phase: 'Logs' });

phase('Verify');
const verify = await agent(`${BASE}

UPDATE: ${update}
LOGS: ${logs}

Verify. Assume every claim is optimistic.
 - Prove a non-operator cannot see or call send-logs, by UI and by forged request.
 - Prove the log payload contains no session token, no email, no phone, no app key, no hourly
   rate. Seed a session and grep the actual bytes, not the code.
 - Prove an update signed with a DIFFERENT key is refused and that the refusal is legible.
 - Prove an update cannot be triggered during a running shift, and that clock-out still works
   with an update pending.
 - Prove the APK installs OVER the field build keeping the session (reason it explicitly from
   allowBackup and the signature, and state what you could not test without a device).
 - Standing battery: android/checks/ · the cross-platform TagLink corpus · pnpm verify ·
   check-api · check-guards.
 - Mutation-test every NEW assertion: RED, restore, GREEN.
State exactly what the owner must verify ON THE PHONE, in order, and what each failure looks like.
Write backlog/docs/W2-VERIFY.md, update the backlog (</dev/null), COMMIT, and end with ONE LINE:
SAFE TO SHIP or NOT.`, { label: 'w2-verify', phase: 'Verify', model: VERIFIER });

return { update, logs, verify };
