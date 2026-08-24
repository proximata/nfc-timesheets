export const meta = {
  name: 'uat_walkthrough_and_suggestions',
  description: 'Virtually walk the real UAT journeys (worker, operator, admin) on mocks/emulators, no production writes, then file UX-ordered backlog task suggestions.',
  phases: [{ title: 'Explore' }, { title: 'Synthesize' }],
};

const SAFETY = 'SAFETY, NON-NEGOTIABLE: never touch production (schimmer-glanz.exe.xyz or timesheets.exe.xyz). Use ONLY a local target: demo/demo-server.mjs (it refuses to boot against any database not literally named nfc_demo), demo/seed.sql or demo/seed-scale.mjs for data, and a local Postgres scratch database you create yourself. If a safe local target genuinely cannot be stood up in the time available, say so plainly in coverageGaps instead of quietly pointing anything at production. Never create, modify or delete anything on schimmer-glanz.exe.xyz or timesheets.exe.xyz for this task, not even a throwaway row.';

const LOCAL_HAZARDS = 'LOCAL MACHINE NOTES: the rtk wrapper mangles grep and ls output (line numbers get injected, sizes print as 0KB) — for THIS task use plain /usr/bin/grep, /bin/ls, /usr/bin/awk, /usr/bin/git directly, do not route them through rtk (this overrides the general rtk-prefix style default for this one task only, because it silently corrupts output you will be reasoning over). Android tooling: ANDROID_HOME=/opt/homebrew/share/android-commandlinetools, and JAVA_HOME must point at "/Applications/Android Studio.app/Contents/jbr/Contents/Home" for gradlew/adb/apkanalyzer to work at all. An existing AVD named ts-demo (API 36, arm64-v8a, google_apis) is already configured and is the fastest path to a booted emulator; boot it headless with -no-window if a display is not needed. iOS: CoreNFC never runs in the Simulator — any screen that starts a real NFCTagReaderSession (WriteTagScreen.swift, VerifyZoneScreen.swift, and the tap arrival path for a passive NFC read) cannot be driven in the simulator at all; DemoHooks.swift (search for it under NFCTimeSheets/NFCTimeSheets/, guarded #if DEBUG) is the existing mechanism for feeding a tap into TapInbox without real hardware — read its own header comment for exactly what it does and does not cover before assuming it reaches something it does not.';

async function main() {
  phase('Explore');

  const results = await parallel([
    () => agent(
      'STYLE (defaults; task instructions below win on explicit conflict):\n' +
      '- CAVEMAN: terse, technical exact. Drop articles/filler/hedging. Fragments OK. Pattern: [thing] [action] [reason]. [next step]. Code blocks + exact quotes unchanged.\n' +
      '- PONYTAIL: lazy senior dev. Before code, climb ladder: (1) needed at all? (2) stdlib? (3) native platform? (4) already-installed dep? (5) one line? (6) minimum code. No unrequested abstractions. Mark deliberate shortcuts ponytail: naming ceiling + upgrade path.\n' +
      '- NO TIME ESTIMATES. Relative effort only.\n' +
      '- This is a READ/OBSERVE/PROPOSE task, not a build task: make NO source-code edits anywhere in this repo. The only files you may create are screenshots and your own scratch notes.\n\n' +
      SAFETY + '\n\n' + LOCAL_HAZARDS + '\n\n' +
      'TASK: play the ANDROID WORKER exactly as a real, non-technical cleaner would experience it on a UAT phone, and report friction honestly — this is a UX walkthrough, not a bug hunt for data-loss/security issues (those are explicitly out of scope this round; the product owner has said data loss does not matter yet, still piloting). Boot the ts-demo emulator (or build+install a debug APK pointed at your local demo server target — read android/branding.properties and android/dist tooling, or demo/record-android.mjs and demo/android-setup.sh, for the existing override mechanism before inventing one).\n\n' +
      'Walk, in order, taking a screenshot at every screen (adb exec-out screencap -p > file, save under a scratch dir, note the path in your steps):\n' +
      '1. Fresh install / first launch, no prior sign-in. What does the sign-in screen actually communicate to someone who has never seen it — is it obvious which field is for them?\n' +
      '2. Sign in as a worker using an enrolment code (mint one against your local demo server, not production).\n' +
      '3. Land on the shift/log screen signed out of any shift. What does it say, what can be tapped?\n' +
      '4. Simulate an NFC tap by firing the same ACTION_VIEW intent a real tag read produces (adb shell am start -a android.intent.action.VIEW -d "https://<your-demo-tag-host-or-whatever-TagLink-accepts>/t?l=<a-real-demo-location-or-zone-id>" <package> — read core/TagLink.kt first for the exact accepted host set and URL shape). Observe the in-shift lock screen: does a first-time user understand a shift is running and how to end it?\n' +
      '5. Tap out the same way (or via the manual-scan surface) and land back on log/history. Is completed work visible and reassuring?\n' +
      '6. Open Settings: language switch, self-update section, anything else — does it behave sensibly with no update available and (if you can arrange it) with one available?\n' +
      '7. Sign out. Sign back in with the SAME worker via a fresh SMS request if your local target has Twilio-shaped mocking available, otherwise note that OTP could not be exercised locally and say what would be needed.\n\n' +
      'For every step: what you did, what you expected, what you actually observed, and a friction rating (none/minor/major/blocker) with a one-line reason a real UAT tester would give. Do not soften genuine confusion into "minor" to be polite. Then propose concrete backlog task titles for anything you would want fixed before a second building/client, each with a uxImportance rating and a one-line rationale a non-technical business owner would understand — ordered by how much a real user would be bothered, not by technical severity. List any journey step you could not actually exercise (and why) under coverageGaps rather than guessing what would have happened.',
      { label: 'android-worker-journey', model: 'anthropic/claude-sonnet-5', schema: {
        type: 'object',
        properties: {
          journey: { type: 'string' },
          platform: { type: 'string' },
          method: { type: 'string' },
          steps: { type: 'array', items: { type: 'object', properties: {
            action: { type: 'string' }, observed: { type: 'string' },
            friction: { type: 'string', enum: ['none', 'minor', 'major', 'blocker'] },
            note: { type: 'string' },
          }, required: ['action', 'observed', 'friction'] } },
          suggestedTasks: { type: 'array', items: { type: 'object', properties: {
            title: { type: 'string' }, uxImportance: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            rationale: { type: 'string' },
          }, required: ['title', 'uxImportance', 'rationale'] } },
          coverageGaps: { type: 'array', items: { type: 'string' } },
        },
        required: ['journey', 'platform', 'method', 'steps', 'suggestedTasks', 'coverageGaps'],
      } },
    ),
    () => agent(
      'STYLE (defaults; task instructions below win on explicit conflict):\n' +
      '- CAVEMAN: terse, technical exact. Drop articles/filler/hedging. Fragments OK.\n' +
      '- PONYTAIL: lazy senior dev, no unrequested abstractions.\n' +
      '- NO TIME ESTIMATES.\n' +
      '- READ/OBSERVE/PROPOSE only: make NO source-code edits anywhere in this repo.\n\n' +
      SAFETY + '\n\n' + LOCAL_HAZARDS + '\n\n' +
      'TASK: play the OPERATOR journey on BOTH platforms, as a UAT walkthrough, not a bug hunt. Data loss / security is explicitly out of scope this round.\n\n' +
      'ANDROID (drive it for real, screenshot every screen — adb exec-out screencap -p): from a signed-out state, find the operator entry point on the sign-in screen (the "Betreiber?" section added today), sign in with an enrolment code minted against your LOCAL demo server, reach "Tag beschreiben" (write) and "Tag pruefen" (test scan). You cannot physically write an NFC tag on an emulator (no NFC radio) — instead read android/checks/ for the existing tag-writer-check simulation and describe what the UI shows a real operator at each step (capacity check, refuse-if-occupied, confirmation, error copy) as if you were reading it over their shoulder. Also check: is the self-update section reachable from here today, or only from a worker session (this is a KNOWN gap already filed as TASK-254 — confirm it is still true right now rather than assuming, and say so either way).\n\n' +
      'IOS: CoreNFC cannot run in the Simulator, so WriteTagScreen.swift and VerifyZoneScreen.swift cannot be driven at all here. Do a careful UX-focused READ of NFCTimeSheets/NFCTimeSheets/WriteTagScreen.swift, VerifyZoneScreen.swift, and the operator entry point on ContentView.swift/SignInView (added today) as if narrating what a first-time operator would see and tap, sentence by sentence of visible copy — flag anything unclear, any dead end, any missing confirmation. Mark every one of these as method "code-read-only, CoreNFC hardware-only" in your steps, never claim you ran something you only read.\n\n' +
      'Cross-platform: are the TWO platforms actually offering the same thing in the same place, in words a non-technical operator (a cleaner who also mounts tags, not an engineer) would find equally clear on either phone? Note any asymmetry.\n\n' +
      'Propose concrete backlog task titles for anything worth fixing, each with uxImportance and a one-line rationale, ordered by how much a real operator would be bothered — not by technical severity. List anything you could not exercise under coverageGaps.',
      { label: 'operator-journey-both-platforms', model: 'anthropic/claude-sonnet-5', schema: {
        type: 'object',
        properties: {
          journey: { type: 'string' },
          platform: { type: 'string' },
          method: { type: 'string' },
          steps: { type: 'array', items: { type: 'object', properties: {
            action: { type: 'string' }, observed: { type: 'string' },
            friction: { type: 'string', enum: ['none', 'minor', 'major', 'blocker'] },
            note: { type: 'string' },
          }, required: ['action', 'observed', 'friction'] } },
          suggestedTasks: { type: 'array', items: { type: 'object', properties: {
            title: { type: 'string' }, uxImportance: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            rationale: { type: 'string' },
          }, required: ['title', 'uxImportance', 'rationale'] } },
          coverageGaps: { type: 'array', items: { type: 'string' } },
        },
        required: ['journey', 'platform', 'method', 'steps', 'suggestedTasks', 'coverageGaps'],
      } },
    ),
    () => agent(
      'STYLE (defaults; task instructions below win on explicit conflict):\n' +
      '- CAVEMAN: terse, technical exact. Drop articles/filler/hedging. Fragments OK.\n' +
      '- PONYTAIL: lazy senior dev, no unrequested abstractions.\n' +
      '- NO TIME ESTIMATES.\n' +
      '- READ/OBSERVE/PROPOSE only: make NO source-code edits anywhere in this repo.\n\n' +
      SAFETY + '\n\n' + LOCAL_HAZARDS + '\n\n' +
      'TASK: play the ADMIN journey as the actual pilot client would — someone non-technical, at a desk or on a phone, onboarding their SECOND building after the first went fine. Data loss / security is explicitly out of scope this round; this is about whether the day-to-day flow makes sense.\n\n' +
      'Stand up web/out served locally against your LOCAL demo server (never production — read demo/demo-server.mjs and demo/seed.sql for the existing pattern), and drive it for real screenshots (demo/cdp.mjs is the existing CDP driver already used elsewhere in this repo for exactly this — read it before writing a new one). Walk:\n' +
      '1. Log in.\n' +
      '2. Create a new building (with client/contact if the flow offers it inline) end to end through to having a zone that can actually receive a written tag — read backlog/docs/ZONES-MODEL.md and backlog/docs/OPERATOR-MODEL.md first so you know the intended shape (report a building where a tag shows unbound in /tags/, has an operator claim it, resolve it into that zone).\n' +
      '3. Create a worker: name, phone, rate, issue an enrolment code (and SMS code if your local target supports it).\n' +
      '4. Create an operator the same way (this exists live in production today — operator id 71, "Mister Clarity" — you do not need to recreate that story, just exercise the equivalent screen locally).\n' +
      '5. Look at /shifts/, /payroll/ with whatever demo data exists.\n\n' +
      'At each screen: does the ADMIN understand what just happened without asking anyone? Any step that silently succeeds/fails, any copy that a non-technical person would misread, any place they would need to phone for help. Rate friction none/minor/major/blocker honestly.\n\n' +
      'Propose concrete backlog task titles ordered by how much a real, patient-but-busy business owner would be bothered — not by technical severity — each with uxImportance and a one-line rationale. List anything you could not exercise under coverageGaps.',
      { label: 'admin-web-journey', model: 'anthropic/claude-sonnet-5', schema: {
        type: 'object',
        properties: {
          journey: { type: 'string' },
          platform: { type: 'string' },
          method: { type: 'string' },
          steps: { type: 'array', items: { type: 'object', properties: {
            action: { type: 'string' }, observed: { type: 'string' },
            friction: { type: 'string', enum: ['none', 'minor', 'major', 'blocker'] },
            note: { type: 'string' },
          }, required: ['action', 'observed', 'friction'] } },
          suggestedTasks: { type: 'array', items: { type: 'object', properties: {
            title: { type: 'string' }, uxImportance: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            rationale: { type: 'string' },
          }, required: ['title', 'uxImportance', 'rationale'] } },
          coverageGaps: { type: 'array', items: { type: 'string' } },
        },
        required: ['journey', 'platform', 'method', 'steps', 'suggestedTasks', 'coverageGaps'],
      } },
    ),
  ]);

  phase('Synthesize');

  const bundle = JSON.stringify({
    androidWorker: results[0],
    operatorBoth: results[1],
    adminWeb: results[2],
  });

  const synthesis = await agent(
    'You are the final judge of this UAT-prep pass, not a builder. Make NO source-code edits anywhere in this repo.\n\n' +
    'CONTEXT the product owner gave directly, verbatim: "no need to care about loss of data at this stage - still piloting the UAT... i want the ordering by UX importance... we are not on live stage yet, and client is highly loyal." So: order everything by how much a real UAT user would be bothered, not by technical/security severity. TASK-240 and TASK-247 (a data-loss retry fix) were explicitly marked Wont Do this same session for exactly this reason — do not resurrect them or anything shaped like them (an unresolved tag correctly refusing to open a shift is WANTED behaviour, not a bug, per the owner).\n\n' +
    'Three journey reports (JSON) from parallel explorers follow: ' + bundle + '\n\n' +
    'Do this, in order:\n' +
    '1. Read backlog/tasks/*.md (grep "^status:" for To Do / In Progress) so you know what is already filed — do not file a duplicate of an existing open task; if a suggestion clearly matches one, reference its existing TASK-N id instead of refiling it.\n' +
    '2. TASK-219, TASK-251, TASK-253 and TASK-254 already exist and are already agreed in scope for this session (do not refile these either) — read their bodies (backlog/tasks/task-219*, task-251*, task-253*, task-254*) and slot them into your ordering by the SAME UX-importance lens as everything else, next to the new suggestions, not as a separate list bolted on afterward.\n' +
    '3. For every genuinely new suggestion from the three reports that is not a duplicate, file it with backlog task create (append </dev/null to every backlog task create invocation, it hangs on stdin otherwise), title, --priority mapped from uxImportance (critical/high -> high, medium -> medium, low -> low), a --desc citing which journey and step found it, and one --ac per acceptance-shaped claim you can extract from the rationale. Use plain /usr/bin/grep and /bin/ls if you need them, not rtk, for the same reason the explorers were told to avoid it.\n' +
    '4. Write backlog/docs/UAT-WALKTHROUGH.md: the merged, UX-importance-ordered list (existing + newly filed, one flat ranked list, not grouped by journey), each line with its TASK-N id, a one-sentence plain-English reason a non-technical owner would recognise, and which journey/step it came from. Include a short section on coverageGaps merged from all three reports (what genuinely could not be exercised locally, e.g. iOS CoreNFC, and why).\n' +
    '5. Stage and commit ONLY backlog/tasks/*.md (the new/edited task files) and backlog/docs/UAT-WALKTHROUGH.md — explicit paths, never git add -A, this repo has been burned by that before. Do not commit screenshots or anything under a scratch/demo directory. If the psst pre-commit hook false-flags on an unrelated line, PSST_SKIP_SCAN=1 is the documented workaround, but gitleaks must still run clean.\n\n' +
    'Return the ranked list, what you skipped as a duplicate and why, and the report path.',
    { label: 'synthesize-and-file', model: 'anthropic/claude-opus-5', schema: {
      type: 'object',
      properties: {
        orderedTasks: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' }, uxImportance: { type: 'string' },
          rationale: { type: 'string' }, filed: { type: 'boolean' },
          taskId: { type: ['string', 'null'] },
        }, required: ['title', 'uxImportance', 'rationale', 'filed', 'taskId'] } },
        duplicatesSkipped: { type: 'array', items: { type: 'string' } },
        reportPath: { type: 'string' },
      },
      required: ['orderedTasks', 'duplicatesSkipped', 'reportPath'],
    } },
  );

  return { explore: results, synthesis };
}

return await main();
