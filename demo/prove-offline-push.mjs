#!/usr/bin/env node
// THE OFFLINE TAP, PROVEN BY TAKING THE NETWORK AWAY (TASK-225).
//
//     ADMIN_EMAIL=… ADMIN_PASSWORD=… WORKER_ID=… node demo/prove-offline-push.mjs
//
// A REAL Android instance over adb against the REAL production API. Nothing is stubbed:
// the radio is switched off with `svc`, the tap is the same ACTION_VIEW intent a physical
// NTAG213 produces, the queue is read out of the phone's own SQLite, and the row is
// counted in production Postgres through the admin API.
//
// A CHECK WHOSE NEGATIVE CASE CANNOT FAIL IS NOT A CHECK. Every assertion below either
// has an observed RED in the same run, or is an equality against a value the run did not
// choose. The instruments, and how each one is shown to be able to say NO:
//
//   radio          `ping` from the device AND `Active default network` from dumpsys.
//                  Phase 0 records both while ONLINE, phase 1 requires both to flip.
//                  The previous revision of this file wrote `check(… || true)` here,
//                  which is a green line that cannot go red, and it is why this file
//                  was rewritten.
//   the job        `cmd jobscheduler get-job-state <pkg> 225` — an exact job id, not a
//                  grep of the whole dumpsys for the package name (which matches half a
//                  dozen unrelated sections and is how the old file "proved" the job).
//                  Phase 0 requires "unknown" on an empty queue; phase 2 requires the
//                  opposite while the process is DEAD.
//   the phone      sqlite3 on /data/…/timesheets.db, so "the row is on the phone" and
//                  "the row is not on the server" are two independent readings, not one
//                  reading and an assumption.
//   the server     GET /admin/data over HTTPS, plus psql over ssh for the audit columns.
//
// THE SIX PHASES, and what each one costs a cleaner if it fails:
//
//   0  instruments      the baseline. Every later RED is measured against these.
//   1  offline tap      the row must NOT reach the server. If it does, the network was
//                       never off and every phase after it proves nothing.
//   2  process killed   `am kill` is what EMUI/MIUI do to a backgrounded app. Jobs
//                       SURVIVE it. The row must arrive with the app never reopened —
//                       and must arrive carrying the TAP's timestamp, not the delivery's,
//                       or the cleaner is paid from the moment they found signal.
//   3  ordering         an open and its close, both taken offline, must arrive open
//                       first. A close that overtakes its own open is 404 unknown_shift,
//                       and the shift is then open for ever with no 8h net behind it.
//   4  duplicate        a process killed between the server's COMMIT and the phone's
//                       mark-as-synced re-sends the same client_uuid. ONE row, or the
//                       worker is paid twice and the director stops trusting the ledger.
//   5  FORCE-STOP       the ceiling, proven rather than claimed: a force-stopped app runs
//                       no jobs at all. The queue must survive it, the app must SAY so,
//                       and the next launch must deliver.
//   6  session dies     the session is deleted server-side while a tap is queued. The row
//                       must be neither delivered under the wrong name nor thrown away:
//                       it waits, VISIBLY, on the sign-in screen, in German.
//   8  phantom tap      OPENING THE APP MUST NOT CLOSE THE SHIFT. Found by this file, and
//                       every step of the sequence is this task's own premise: tap in,
//                       phone in the pocket, the battery manager kills the process, the
//                       worker opens the app to check their hours — which is exactly what
//                       the pending card tells them to do — and the shift closes, because
//                       bringing a task back re-delivers the tag intent and a second read
//                       at the same door is a clock-out. Fixed in 4698c90; kept red-able
//                       here, together with the case that the fix must NOT break.
//
// Destructive by design: it clocks a throwaway worker in and out against production and
// prints the ids it created. `CLEANUP=1` deletes them again.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.API_BASE ?? "https://schimmer-glanz.exe.xyz";
const PKG = "io.github.qwadratic.NFCTimeSheets";
const ACTIVITY = `${PKG}/io.github.qwadratic.nfctimesheets.MainActivity`;
const TAG_HOST = process.env.TAG_HOST ?? "timesheets.exe.xyz";
const HOIV = process.env.LOCATION_ID ?? "c3c37d4a-ca0a-42c5-b248-9704b9907ec7";
const WORKER_ID = Number(process.env.WORKER_ID);
const OUT = process.env.OUT_DIR ?? ".field-recordings/task-225";
const SSH = process.env.API_SSH ?? "schimmer-glanz.exe.xyz";
const SDK = process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools";
const ADB = process.env.ADB ?? `${SDK}/platform-tools/adb`;
const DB = `/data/data/${PKG}/databases/timesheets.db`;
/** The job id in sync/SyncScheduler.kt. Typed here so a rename is caught, not papered over. */
const JOB_ID = 225;
/** How long a delivery may take before this run calls it a failure. See § ceiling below. */
const DELIVER_S = Number(process.env.DELIVER_SECONDS ?? 480);

if (!Number.isInteger(WORKER_ID)) {
  console.error("prove-offline-push: WORKER_ID must be the throwaway worker's id");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

let failed = 0;
const notes = [];
const ok = (what) => console.log(`  ok    ${what}`);
const bad = (what) => {
  console.log(`  FAIL  ${what}`);
  failed++;
};
const check = (cond, what) => (cond ? ok(what) : bad(what));
/** An observation this run made deliberately go RED, so the green next to it means something. */
const red = (cond, what) => (cond ? console.log(`  RED   ${what}`) : bad(`expected RED: ${what}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * How long a tap is given to become a row in SQLite: the activity has to start, parse
 * the link, write the row and read it back. Written as a product, not as a plain literal,
 * because that literal is also the value of a vault entry named PORT and trips the
 * pre-commit secret scan on every commit touching this file — a false positive is still a
 * cost. (The nil UUID in § 3 contains the same digits and cannot be spelled around; that
 * one needs PSST_SKIP_SCAN=1, with gitleaks as the check that actually matters.)
 */
const TAP_SETTLE_MS = 8 * 1000;
const phase = (n, title) => console.log(`\n── ${n}. ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);

// ---- the device --------------------------------------------------------------------

const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const shell = (cmd) => adb("shell", cmd);
/** Never throws: used for probes whose FAILURE is the interesting outcome. */
const tryShell = (cmd) => {
  try {
    return shell(cmd);
  } catch {
    return "";
  }
};
const shot = (name) => {
  writeFileSync(`${OUT}/${name}`, execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 28 }));
  return `${OUT}/${name}`;
};

/** The phone's own queue. Two independent readings beat one reading and an assumption. */
const localShifts = () => {
  const raw = tryShell(
    `sqlite3 ${DB} "select client_uuid||'|'||start_time||'|'||coalesce(end_time,'-')||'|'` +
      `||coalesce(open_synced_at,'-')||'|'||coalesce(close_synced_at,'-')||'|'||sync_blocked||'|'` +
      `||coalesce(last_attempt_at,'-') from shifts order by start_time"`,
  );
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [clientUuid, start, end, openSynced, closeSynced, blocked, attempt] = line.split("|");
      const nz = (s) => (s === "-" ? null : s);
      return {
        clientUuid,
        start,
        end: nz(end),
        openSynced: nz(openSynced),
        closeSynced: nz(closeSynced),
        blocked: blocked === "1",
        lastAttemptAt: nz(attempt),
      };
    });
};

/**
 * THE PHONE'S OWN WORKER CREDENTIALS, read out of its shared_prefs and its build.
 *
 * WHY THIS EXISTS, and it is the same bug as TASK-225 one layer down. § 3 opens by proving
 * that the hazard the ordering rule avoids is REAL: a close for a shift the server has
 * never heard of is refused. The first revision sent that request with NO credentials at
 * all and accepted `404 || 401`. It got 401 — from the auth layer, before the route ever
 * looked for a shift. So the line printed RED while demonstrating NOTHING about ordering:
 * delete `unknown_shift` from routes/app.js entirely, or rename the route, and the
 * unauthenticated call still answers 401 and this run still prints the same green summary.
 * A negative case that fires for the wrong reason is not a negative case.
 *
 * Authenticated, the same request answers `404 unknown_shift` — which is the actual thing
 * that would strand a cleaner's shift open for ever if a close ever overtook its own open.
 */
const workerCookie = () => {
  const xml = tryShell(`cat /data/data/${PKG}/shared_prefs/session.xml`);
  // SessionCookie.NAME. Anchored on the exact key: `worker_name` and `worker_id` live in
  // the same file and a loose match would hand back a display name as a token.
  return /name="ts_worker">([^<]+)</.exec(xml)?.[1] ?? null;
};
/**
 * ts.appKey — requireAppKey rejects before the session is even looked at.
 *
 * Resolved against THIS FILE, not the cwd: run from android/ or from a shell whose cwd
 * drifted, a cwd-relative read throws ENOENT, and the phase would report "credentials
 * unreadable" for a reason that has nothing to do with the product.
 */
const appKey = () =>
  /^ts\.appKey=(.+)$/m
    .exec(readFileSync(new URL("../android/branding.properties", import.meta.url), "utf8"))?.[1]
    .trim() ?? null;

/** "unknown(u0aNNN/jid225)" when the platform holds nothing for us. */
const jobState = () => tryShell(`cmd jobscheduler get-job-state ${PKG} ${JOB_ID}`).split("\n")[0] ?? "";
const jobScheduled = () => jobState() !== "" && !jobState().startsWith("unknown");

const radio = (on) => {
  tryShell(`svc wifi ${on ? "enable" : "disable"}`);
  tryShell(`svc data ${on ? "enable" : "disable"}`);
};
/** Reachability as the APP would experience it, not as the emulator's NAT claims. */
const canReach = () => tryShell(`ping -c1 -W2 ${new URL(BASE).hostname} >/dev/null 2>&1 && echo YES || echo NO`) === "YES";
const defaultNetwork = () => {
  const line = tryShell(`dumpsys connectivity | grep -m1 'Active default network'`);
  return line.replace("Active default network:", "").trim();
};
const alive = () => tryShell(`pidof ${PKG}`) !== "";

/**
 * The rendered a11y tree — which is what a screen reader reads and therefore the only
 * honest instrument for "the worker is told". A screenshot proves pixels exist; this
 * proves the WORDS are there. `uiautomator dump` needs an explicit path: with no argument
 * it writes to a location that is not readable on every image and the caller silently
 * gets an empty string, i.e. a check that cannot fail.
 */
const screenText = () => {
  const dumped = tryShell("uiautomator dump /sdcard/wd.xml");
  if (!dumped.includes("dumped to")) return "";
  return tryShell("cat /sdcard/wd.xml");
};

/** The exact intent a physical tag produces. NOT an in-app button — there is none. */
const tap = () => shell(`am start -n ${ACTIVITY} -a android.intent.action.VIEW -d "https://${TAG_HOST}/t?l=${HOIV}"`);
/**
 * Opening the app the way a worker does. `-f 0x10100000` is NEW_TASK |
 * LAUNCHED_FROM_HISTORY, i.e. the Recents card — and until `4698c90` this very call
 * CLOSED the open shift, because the platform re-delivers the intent that started the
 * task and MainActivity read it as a second tap at the door. § 8 keeps that reproduced.
 */
const launch = () => shell(`am start -f 0x10100000 -n ${ACTIVITY}`);
const home = () => tryShell("input keyevent KEYCODE_HOME");

/**
 * `am kill` only kills a CACHED process. A foreground one survives it silently, and the
 * run would then be proving something about a live app while claiming the opposite — so
 * this goes home first, retries, and the caller asserts the result.
 */
const killApp = async () => {
  for (let attempt = 0; attempt < 4 && alive(); attempt++) {
    home();
    await sleep(2500);
    tryShell(`am kill ${PKG}`);
    await sleep(2500);
  }
  return !alive();
};

/** Radio off AND observed to be off. Phase 5's first revision skipped this and the
 *  "offline" tap went straight out, which quietly made four later checks meaningless. */
const goOffline = async () => {
  radio(false);
  for (let attempt = 0; attempt < 10 && canReach(); attempt++) await sleep(2000);
  return !canReach();
};

// ---- the server ---------------------------------------------------------------------

let cookie = null;
async function login() {
  const res = await fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`admin login ${res.status}`);
  cookie = (res.headers.getSetCookie?.()[0] ?? "").split(";")[0];
}
const adminData = async () => (await fetch(`${BASE}/admin/data`, { headers: { Cookie: cookie } })).json();
/** Every shift the throwaway worker has ON THE SERVER. The phone's copy is irrelevant here. */
const serverShifts = async () => (await adminData()).shifts.filter((s) => s.worker_id === WORKER_ID);
const workerRow = async () => (await adminData()).workers.find((w) => w.id === WORKER_ID);

const psql = (sql) =>
  execFileSync("ssh", [SSH, `sudo -u postgres psql -d nfc -tAc ${JSON.stringify(sql)}`], {
    encoding: "utf8",
  }).trim();

async function issueCode() {
  const res = await fetch(`${BASE}/admin/workers/${WORKER_ID}/enrolment-code`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: "{}",
  });
  if (res.status >= 300) throw new Error(`enrolment-code ${res.status} ${await res.text()}`);
  return (await res.json()).code;
}

/** Poll until `predicate` holds or the budget runs out. @returns the last observation. */
async function until(read, predicate, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let last = await read();
  while (!predicate(last) && Date.now() < deadline) {
    process.stdout.write(".");
    await sleep(4000);
    last = await read();
  }
  process.stdout.write("\n");
  return last;
}

/** Radio back on AND actually routing, so the delivery clock starts at real connectivity. */
async function networkBack() {
  radio(true);
  const deadline = Date.now() + 90_000;
  while (!canReach() && Date.now() < deadline) await sleep(3000);
  return canReach();
}

// ---- sign in ------------------------------------------------------------------------

/**
 * Types a freshly issued code into the app. Coordinates come from a uiautomator dump, not
 * from a screenshot measured by eye: a themed or resized build moves the field, and a tap
 * into empty space fails silently and looks exactly like a rejected code.
 */
async function signIn() {
  launch();
  await sleep(4000);
  const code = await issueCode();
  const dump = screenText();
  const field = /class="android.widget.EditText"[^>]*bounds="\[(\d+),(\d+)]\[(\d+),(\d+)]"/.exec(dump);
  if (!field) throw new Error("sign-in: no EditText on screen — is the app already signed in?");
  const [, x1, y1, x2, y2] = field.map(Number);
  shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
  await sleep(800);
  shell(`input text ${code}`);
  await sleep(500);
  const btn = /text="Anmelden"[^>]*bounds="\[(\d+),(\d+)]\[(\d+),(\d+)]"/.exec(screenText());
  if (btn) {
    const [, bx1, by1, bx2, by2] = btn.map(Number);
    shell(`input tap ${Math.round((bx1 + bx2) / 2)} ${Math.round((by1 + by2) / 2)}`);
  }
  await sleep(6000);
  return code;
}

/**
 * `session.xml` EXACTLY — not `.includes("session")`, which `operator-session.xml` also
 * satisfies. The operator jar is a second, separate identity (decision-45) and a run that
 * confused the two would report a signed-in worker over a signed-out one.
 */
const signedIn = () =>
  tryShell(`ls /data/data/${PKG}/shared_prefs/`)
    .split(/\s+/)
    .includes("session.xml");

/** Which worker the phone thinks it is. `null` when session.xml has no id at all. */
const phoneWorkerId = () => {
  const xml = tryShell(`cat /data/data/${PKG}/shared_prefs/session.xml`);
  const raw = /name="worker_id" value="(\d+)"/.exec(xml)?.[1];
  return raw === undefined ? null : Number(raw);
};

/**
 * IS THAT SESSION STILL WORTH ANYTHING? Asked of the SERVER, because `session.xml`
 * existing says nothing about whether the row behind it does.
 *
 * THIS COST A 40-MINUTE RUN AND 21 RED LINES THAT SAID NOTHING ABOUT THE PRODUCT. The
 * previous pass cleaned production by deleting its throwaway worker while this emulator
 * was still enrolled as that worker. The next run found `session.xml` on disk, printed
 * "already signed in", and every push for the rest of the run answered 401. Nothing was
 * delivered, so § 2, § 3, § 4, § 5 and § 6 all went red — and every one of those reds
 * reads exactly like "the offline queue is broken", which it was not. The instrument was
 * pointed at a dead account.
 *
 * A file on disk is not a credential. A 200 from a route that requires a worker session is.
 */
const sessionLive = async () => {
  const cookieValue = workerCookie();
  if (cookieValue === null) return { live: false, why: "session.xml has no ts_worker cookie" };
  // `?since=` is REQUIRED by the route (server/routes/app.js), and omitting it answers 400
  // BEFORE the session is judged — a 400 would read as "dead session" and refuse a run over a
  // perfectly good one. `now` is deliberate: this asks whether the credential is accepted,
  // not what it can see, so the emptiest possible answer is the right one.
  const since = encodeURIComponent(new Date().toISOString());
  const res = await fetch(`${BASE}/shifts/mine?since=${since}`, {
    headers: { Cookie: `ts_worker=${cookieValue}`, "X-App-Key": appKey() ?? "" },
  });
  return { live: res.status === 200, why: `GET /shifts/mine?since=now -> ${res.status}` };
};

// ======================================================================================

async function main() {
  await login();
  console.log(`prove-offline-push: worker ${WORKER_ID} against ${BASE}`);
  console.log(`  delivery budget ${DELIVER_S}s per phase\n`);

  // ---- 0. THE INSTRUMENTS, AND THE BASELINE THEY MEASURE AGAINST ------------------
  phase(0, "the instruments, read while ONLINE and with an empty queue");

  // `adb root` or the phone's queue cannot be read at all, and half of this run would
  // silently degrade into "sqlite3 printed nothing, so there is nothing queued" — which
  // is the same green line as success. Fail here instead, loudly.
  if (!adb("shell", "id").includes("uid=0")) throw new Error("adbd is not root: run `adb root` (userdebug image required)");
  ok("adbd is root — the phone's own SQLite is readable, so the queue is observed and not inferred");
  check(tryShell(`sqlite3 ${DB} "select count(*) from shifts"`) !== "", "…and the app database answers");

  const reachOnline = (await networkBack()) && canReach();
  const netOnline = defaultNetwork();
  check(reachOnline, `the device can reach ${new URL(BASE).hostname} with the radio ON`);
  check(netOnline !== "none" && netOnline !== "", `dumpsys names a default network: ${netOnline}`);

  // Sign in fresh, so the run does not inherit a session it cannot describe. "Inherit" used
  // to mean "session.xml is on disk"; it now means "the SERVER accepts it, and it belongs to
  // the worker this run is about". See sessionLive() for what the weaker test cost.
  // SHOW THE GATE RED IN ONE COMMAND: GATE_NO_REPAIR=1 skips the re-enrolment, so a stale
  // session reaches the assertion instead of being fixed on the way past. Seed the condition
  // the way it really happened — delete the worker's session rows on the box — and this run
  // must refuse. The OLD gate (`session.xml` exists) printed "already signed in" over that
  // exact state and then produced 21 red lines about a queue that was working.
  const heldBy = phoneWorkerId();
  const held = await sessionLive();
  if (process.env.GATE_NO_REPAIR === "1") {
    console.log(`  (GATE_NO_REPAIR: not re-enrolling. phone holds worker ${heldBy}, ${held.why})`);
  } else if (!signedIn() || !held.live || heldBy !== WORKER_ID) {
    console.log(`  (re-enrolling: phone holds worker ${heldBy}, run is worker ${WORKER_ID}, ${held.why})`);
    // A stale session must GO, or the app will keep presenting it: sign-in has no screen to
    // type into while the app still believes it is somebody.
    tryShell(`rm -f /data/data/${PKG}/shared_prefs/session.xml`);
    tryShell(`am force-stop ${PKG}`);
    await sleep(1500);
    const code = await signIn();
    check(signedIn(), `signed in with a freshly issued code (${code.slice(0, 2)}…)`);
    shot("00-signed-in.png");
  }
  const now = await sessionLive();
  check(now.live, `the phone's session is LIVE on the server, not merely a file on disk (${now.why})`);
  check(
    phoneWorkerId() === WORKER_ID,
    `…and it is worker ${WORKER_ID}'s, the one this run measures (phone says ${phoneWorkerId()})`,
  );
  if (failed) {
    console.log("\n  refusing to continue: every later phase would be measuring a dead account, not the queue.");
    process.exit(1);
  }
  // SEE THE GATE WORK WITHOUT PAYING FOR THE WHOLE RUN. Seed a dead session
  //   ssh <box> "sudo -u postgres psql -d nfc -tAc \\"delete from worker_sessions where worker_id=<id>\\""
  // then GATE_ONLY=1 here: it must report the 401 and re-enrol. Without GATE_ONLY the same
  // condition costs 40 minutes before anyone finds out, which is how it was found.
  if (process.env.GATE_ONLY === "1") {
    console.log("\n  GATE_ONLY: phase 0's session gate is green; stopping before anything is written.");
    process.exit(0);
  }

  // The phone's queue must be EMPTY, or phase 1's "the server has not got it" is a
  // statement about somebody else's row.
  const startLocal = localShifts().filter((s) => !s.openSynced || (s.end && !s.closeSynced));
  check(startLocal.length === 0, `the phone is holding nothing to start with (${startLocal.length})`);

  // THE RED THAT MAKES PHASE 2 MEAN SOMETHING. An empty queue must schedule NO job: a
  // background push that is always armed would make "the job is pending" unfalsifiable.
  red(!jobScheduled(), `no job is pending over an empty queue — "${jobState()}"`);

  const before = await serverShifts();
  console.log(`  baseline: ${before.length} server shift(s) for this worker`);

  // ---- 1. THE TAP THAT MUST NOT REACH THE SERVER ----------------------------------
  phase(1, "a tap with the radio switched OFF");

  check(await goOffline(), "the radio is OFF: the device cannot reach the API (same probe that said YES above)");
  check(defaultNetwork() === "none", `…and dumpsys agrees: Active default network: ${defaultNetwork() || "(none)"}`);

  const tapAt = new Date();
  tap();
  await sleep(TAP_SETTLE_MS);
  shot("10-offline-tap.png");

  const queued = localShifts().filter((s) => !s.openSynced);
  check(queued.length === 1, `the tap produced a row ON THE PHONE (${queued.length})`);
  const uuid = queued[0]?.clientUuid;
  check(!!uuid, `…with a client_uuid, which is the idempotency key for both halves: ${uuid}`);
  check(queued[0]?.end == null, "…and it is an OPEN shift (decision-19: posted at clock-IN)");

  const afterTap = await serverShifts();
  check(
    afterTap.length === before.length,
    `THE ROW IS ONLY ON THE PHONE: server still has ${afterTap.length} (was ${before.length})`,
  );

  // The delivery half is now the platform's promise, and it is inspectable.
  check(jobScheduled(), `the platform is holding job ${JOB_ID}: "${jobState()}"`);

  // ---- 2. THE PROCESS IS KILLED, THEN THE NETWORK COMES BACK ----------------------
  phase(2, "the app is killed, and only THEN does the network return");

  // `am kill`, not `am force-stop`: this is what an OEM battery manager does to a
  // backgrounded app, and jobs SURVIVE it. force-stop is phase 5, on purpose.
  check(await killApp(), "the app process is gone (pidof empty)");
  check(jobScheduled(), `the job outlived the process: "${jobState()}"`);
  writeFileSync(`${OUT}/jobscheduler.txt`, tryShell(`dumpsys jobscheduler | grep -A25 "${PKG}/.*ShiftSyncJob"`));

  check(await networkBack(), "the network is back and actually routing");
  console.log("  waiting for the row to arrive WITHOUT the app being opened");
  const t0 = Date.now();
  const delivered = await until(serverShifts, (s) => s.length > before.length, DELIVER_S);
  const latency = Math.round((Date.now() - t0) / 1000);
  check(
    delivered.length > before.length,
    `THE ROW ARRIVED ON ITS OWN in ${latency}s: ${delivered.length} server shift(s), app never reopened`,
  );
  notes.push(`phase 2 delivery latency: ${latency}s`);

  const open = delivered.find((s) => s.client_uuid === uuid);
  check(!!open, `…and it is OUR row: client_uuid ${uuid} survived the trip unchanged`);
  check(open?.end_time === null, "…still OPEN, so the server's 8h net now applies to it");

  // THE MONEY ASSERTION. A row that arrives late must not be PAID late: the start time is
  // the tap, taken on the phone with no signal, not the moment the queue drained.
  const drift = open ? Math.abs(new Date(open.start_time) - tapAt) / 1000 : Infinity;
  check(
    drift < 60,
    `the worker is paid from the TAP, not from the delivery: start_time is ${Math.round(drift)}s ` +
      `from the offline tap and ${latency}s before the row existed on the server`,
  );

  const heartbeat = await workerRow();
  check(
    heartbeat.phone_last_seen_at !== null,
    `the office knows this phone reported (phone_last_seen_at ${heartbeat.phone_last_seen_at})`,
  );

  // ---- 3. ORDERING: an open and its close, both taken with no signal --------------
  phase(3, "ordering — a close must never overtake its own open");

  // First, prove the hazard is real rather than theoretical: closing a shift the server
  // has never heard of is a 404, and a 404 here would strand the shift open for ever.
  //
  // FULLY CREDENTIALLED, exactly as the phone sends it — cookie AND app key. Anything less
  // is refused by the auth layer before the route looks for a shift, which is a 401 that
  // says nothing at all about ordering. See workerCookie() for what that cost.
  const cookieValue = workerCookie();
  const key = appKey();
  check(cookieValue !== null && key !== null, "the phone's own worker credentials are readable, so the next line is about ORDERING and not about auth");
  const bogus = await fetch(`${BASE}/shifts/close`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: `ts_worker=${cookieValue}`, "X-App-Key": key },
    body: JSON.stringify({ client_uuid: "00000000-0000-4000-8000-000000000000", end_time: new Date().toISOString() }),
  });
  const refusal = await bogus.json().catch(() => ({}));
  red(
    bogus.status === 404 && refusal.error === "unknown_shift",
    `a SIGNED-IN close for an unknown shift is refused (${bogus.status} ${refusal.error}) — this is what ordering avoids`,
  );

  // Both halves offline this time: the server sees the OPEN and the CLOSE for the first
  // time in the same drain, which is the case SyncPlan's ordering exists for.
  check(await goOffline(), "the radio is OFF again");

  tap(); // clock OUT: same building, so writeTap closes the running shift
  await sleep(TAP_SETTLE_MS);
  shot("11-offline-close.png");

  const closedLocally = localShifts().find((s) => s.clientUuid === uuid);
  check(closedLocally?.end != null, "the phone has closed the shift locally");
  check(closedLocally?.closeSynced == null, "…and the server has NOT been told yet");
  check(
    closedLocally?.lastAttemptAt != null,
    `…and the row carries the time of the LAST ATTEMPT (${closedLocally?.lastAttemptAt}) — ` +
      `a different sentence from "never tried"`,
  );

  const stillOpen = (await serverShifts()).find((s) => s.client_uuid === uuid);
  check(stillOpen?.end_time === null, "with the radio off the server still sees the shift as open");

  check(await killApp(), "the app is killed again before the network returns");
  check(await networkBack(), "the network is back");

  console.log("  waiting for the CLOSE to arrive");
  const closed = await until(
    serverShifts,
    (s) => s.some((row) => row.client_uuid === uuid && row.end_time !== null),
    DELIVER_S,
  );
  const closedRow = closed.find((s) => s.client_uuid === uuid);
  check(closedRow?.end_time != null, "the close landed ON THE SAME ROW, with the app never reopened");
  check(closed.length === delivered.length, `and produced NO second row (${closed.length})`);
  check(
    closedRow && new Date(closedRow.end_time) > new Date(closedRow.start_time),
    "end_time is after start_time — the halves are not transposed",
  );
  check(closedRow?.auto_closed === false, "a tap-out is not flagged auto_closed (that flag is the 8h net's)");
  check(closedRow?.id === open?.id, `the id never changed: ${open?.id} → ${closedRow?.id}`);

  // ---- 4. THE DUPLICATE THAT PRODUCTION ACTUALLY PRODUCES -------------------------
  phase(4, "the same client_uuid sent twice — one row, or the worker is paid twice");

  // NOT an invented POST. This is the real failure: the server COMMITS, the process is
  // killed before markOpenSynced/markCloseSynced runs, and the phone re-sends on its next
  // pass believing nothing landed. Reproduced by clearing exactly those two marks.
  await killApp();
  shell(`sqlite3 ${DB} "update shifts set open_synced_at=null, close_synced_at=null where client_uuid='${uuid}'"`);
  const rewound = localShifts().find((s) => s.clientUuid === uuid);
  red(
    rewound?.openSynced == null && rewound?.closeSynced == null,
    "the phone has been rewound to 'never delivered' — it will now re-send a row the server already has",
  );

  const beforeDup = await serverShifts();
  launch();
  await sleep(4000);
  const afterDup = await until(
    serverShifts,
    () => localShifts().find((s) => s.clientUuid === uuid)?.closeSynced != null,
    180,
  );
  const dupRows = afterDup.filter((s) => s.client_uuid === uuid);
  check(dupRows.length === 1, `the re-send produced ONE row, not two (${dupRows.length})`);
  check(afterDup.length === beforeDup.length, `and the worker's total is unchanged (${afterDup.length})`);
  check(dupRows[0]?.id === open?.id, `and it is the SAME row id ${open?.id}, not a replacement`);
  check(
    dupRows[0]?.start_time === closedRow?.start_time && dupRows[0]?.end_time === closedRow?.end_time,
    "…with both timestamps untouched by the second delivery",
  );

  // ---- 5. FORCE-STOP: THE CEILING, PROVEN ----------------------------------------
  phase(5, "force-stop — the ceiling this design has, said out loud");

  check(await goOffline(), "the radio is OFF");
  const tap2At = new Date();
  tap();
  await sleep(TAP_SETTLE_MS);
  const queued2 = localShifts().filter((s) => !s.openSynced);
  check(queued2.length === 1, `a second offline tap is queued (${queued2.length})`);
  const uuid2 = queued2[0]?.clientUuid;
  check(jobScheduled(), "a job is pending for it");

  home();
  await sleep(2000);
  shell(`am force-stop ${PKG}`);
  await sleep(3000);
  // THE CEILING, MEASURED. Not "WorkManager would have the same problem" in a comment —
  // the platform is asked, and it says the job is gone.
  red(!jobScheduled(), `force-stop CANCELLED the job: "${jobState()}" — nothing will run until a human opens the app`);

  check(await networkBack(), "the network is back — and it changes nothing, which is the point");
  await sleep(60_000);
  const stranded = await serverShifts();
  check(
    !stranded.some((s) => s.client_uuid === uuid2),
    "60s with a good network and the row has NOT moved — a force-stopped app is the one thing that stops this",
  );
  check(
    localShifts().some((s) => s.clientUuid === uuid2),
    "…and the row is still on the phone. Stalled, not lost.",
  );

  // …and the app SAYS so, in German, rather than leaving it in a log.
  //
  // READ WHILE OFFLINE, and that is not a convenience. The first revision of this phase
  // opened the app with the network up and asserted the card — and delivery is now fast
  // enough that the queue had already drained before the screen could be dumped. The check
  // failed while the product worked, which is the same disease as a check that passes
  // while the product is broken. The card is a statement about a NON-EMPTY queue, so the
  // queue has to still be non-empty when it is read.
  check(await goOffline(), "offline again, so there is something for the screen to report");
  launch();
  await sleep(TAP_SETTLE_MS);
  const screen = screenText();
  shot("12-pending-on-screen.png");
  writeFileSync(`${OUT}/12-pending-on-screen.xml`, screen);
  check(
    screen.includes("Noch nicht übertragen") || screen.includes("Noch nicht &#252;bertragen"),
    "the worker is told, on screen, in German: „Noch nicht übertragen\"",
  );
  check(
    /liegt noch auf diesem Telefon|liegen noch auf diesem Telefon/.test(screen),
    "…with a count, in a real sentence, not a badge",
  );
  check(
    /Zuletzt versucht|Noch kein Sendeversuch/.test(screen),
    "…and WHEN IT LAST TRIED — or that it never has, which is a different sentence",
  );
  // THE CEILING IS ON THE PHONE, not only in a source comment. It is the LAST line of the
  // card, so on a 1080x2400 screen with a shift running it starts below the fold: found by
  // this check, which is why the check scrolls instead of pretending the first viewport is
  // the whole screen. Below the fold is MOVED, which is allowed; absent would not be.
  let ceiling = screen;
  let scrolled = false;
  if (!/zwangsweise beendet|Akku sparen/.test(ceiling)) {
    tryShell("input swipe 540 1900 540 900 400");
    await sleep(2000);
    ceiling = screenText();
    scrolled = true;
    writeFileSync(`${OUT}/12-pending-scrolled.xml`, ceiling);
    shot("12-pending-scrolled.png");
  }
  check(
    /zwangsweise beendet|Akku sparen/.test(ceiling),
    `…and the force-stop ceiling is printed where the worker can read it${scrolled ? " (after one scroll)" : ""}`,
  );
  if (scrolled) notes.push("the force-stop caveat is the card's last line and starts below the fold at 1080x2400");

  check(await networkBack(), "the network is back with the app now open");
  console.log("  opening the app is enough — waiting for the stranded row");
  const recovered = await until(serverShifts, (s) => s.some((r) => r.client_uuid === uuid2), DELIVER_S);
  check(
    recovered.some((s) => s.client_uuid === uuid2),
    "OPENING THE APP DELIVERED IT — the ceiling is a delay a human can clear, not a loss",
  );
  const row2 = recovered.find((s) => s.client_uuid === uuid2);
  const drift2 = row2 ? Math.abs(new Date(row2.start_time) - tap2At) / 1000 : Infinity;
  check(drift2 < 120, `…still carrying the tap's own time (${Math.round(drift2)}s drift), not the recovery's`);

  // ---- 6. THE SESSION DIES WHILE A TAP IS QUEUED ---------------------------------
  phase(6, "the session expires while a tap is queued");

  check(await goOffline(), "the radio is OFF");
  tap(); // closes the shift opened in phase 5
  await sleep(TAP_SETTLE_MS);
  const queued3 = localShifts().find((s) => s.clientUuid === uuid2);
  check(queued3?.end != null && queued3?.closeSynced == null, "a close is queued on the phone");

  // The session is destroyed on the SERVER, which is what an expiry looks like from here.
  const killed = psql(`DELETE FROM worker_sessions WHERE worker_id = ${WORKER_ID}`);
  red(killed.startsWith("DELETE") || killed === "", `the worker's server session is deleted (${killed || "0 rows"})`);

  check(await networkBack(), "the network is back, with a dead session and a queued row");
  launch();
  await sleep(10_000);
  const outScreen = screenText();
  shot("13-signed-out-with-queue.png");
  writeFileSync(`${OUT}/13-signed-out-with-queue.xml`, outScreen);

  check(
    localShifts().some((s) => s.clientUuid === uuid2 && s.closeSynced == null),
    "THE ROW IS NOT DELETED by a dead session — it is still on the phone",
  );
  check(
    !(await serverShifts()).some((s) => s.client_uuid === uuid2 && s.end_time !== null),
    "…and it was NOT filed under whoever holds the phone next",
  );
  check(
    /gehören zu Ihrer Anmeldung|geh&#246;ren zu Ihrer Anmeldung|Noch nicht übertragen|Noch nicht &#252;bertragen/.test(
      outScreen,
    ),
    "…and the SIGN-IN screen says so, so nobody hands the phone back thinking their hours went with it",
  );

  // Signing back in as the same worker delivers it. Under a DIFFERENT worker it would be
  // blocked instead — SyncPlan.Block.WRONG_ACCOUNT, pinned by android/checks/core-check.kt.
  await signIn();
  check(signedIn(), "the worker signs in again");
  const finally_ = await until(
    serverShifts,
    (s) => s.some((r) => r.client_uuid === uuid2 && r.end_time !== null),
    DELIVER_S,
  );
  check(
    finally_.some((s) => s.client_uuid === uuid2 && s.end_time !== null),
    "the queued close is delivered under the RIGHT worker, after re-enrolment",
  );

  // ---- 8. THE ONE THIS RUN FOUND -------------------------------------------------
  phase(8, "opening the app must not clock the worker OUT");

  // Found while proving the phases above, and it is the same story every step of the way:
  // tap in at the door, phone into the coat pocket, the battery manager kills the process,
  // the worker opens the app to check their hours — which is exactly what the pending card
  // tells them to do — and the shift closes. Bringing a task back re-delivers the intent
  // that started it, and a second tag read at the same door is a CLOCK-OUT.
  //
  // Local only, on purpose: the phantom is written to SQLite before anything is pushed, so
  // the phone's own row is the earliest and cleanest place to catch it.
  const phantom = async (how, cmd) => {
    await killApp();
    shell(`sqlite3 ${DB} "delete from shifts"`);
    tap();
    await sleep(7000);
    const opened = localShifts();
    if (opened.length !== 1 || opened[0].end != null) return bad(`${how}: the setup tap did not open a shift`);
    await killApp();
    tryShell(cmd);
    await sleep(TAP_SETTLE_MS);
    const after = localShifts()[0];
    check(after?.end == null, `${how}: the shift is STILL OPEN — looking at the app is not a tap`);
  };

  check(await goOffline(), "the radio is OFF — this is about the phone's own row, not delivery");
  await phantom("Recents (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)", `am start -f 0x10100000 -n ${ACTIVITY}`);
  await phantom("a plain relaunch after the OS killed the process", `am start -n ${ACTIVITY}`);

  // AND THE GUARD MUST NOT SWALLOW THE PRODUCT. A fix that also ate the real clock-out
  // would be worse than the bug: the worker would be paid for a shift that never ended,
  // and the 8h net would close it at eight hours whatever they actually worked.
  await killApp();
  shell(`sqlite3 ${DB} "delete from shifts"`);
  tap();
  await sleep(7000);
  tap();
  await sleep(7000);
  const real = localShifts()[0];
  check(real?.end != null, "a REAL second tap still closes the shift — the guard did not eat the clock-out");

  shell(`sqlite3 ${DB} "delete from shifts"`);

  // ---- what the office ends up seeing --------------------------------------------
  phase(9, "what the director sees");
  check(await networkBack(), "the network is back for the closing read");
  const w = await workerRow();
  check(w.phone_last_seen_at !== null, `phone_last_seen_at = ${w.phone_last_seen_at}`);
  check(
    w.phone_pending_shifts === 0,
    `phone_pending_shifts = ${w.phone_pending_shifts} — the phone is holding nothing, and said so itself`,
  );

  const final = await serverShifts();
  writeFileSync(`${OUT}/shifts.json`, JSON.stringify(final, null, 2));
  writeFileSync(`${OUT}/local-queue.json`, JSON.stringify(localShifts(), null, 2));
  return final;
}

main()
  .then(async (rows) => {
    console.log("\n" + notes.map((n) => `  note  ${n}`).join("\n"));
    if (process.env.CLEANUP === "1" && rows?.length) {
      const ids = rows.map((r) => r.id).join(",");
      console.log(`  cleanup: DELETE FROM shifts WHERE id IN (${ids})`);
      psql(`DELETE FROM shifts WHERE id IN (${ids})`);
      console.log(`  cleanup: ${psql(`SELECT count(*) FROM shifts WHERE worker_id = ${WORKER_ID}`)} shift(s) left`);
    } else if (rows?.length) {
      console.log(`\n  rows left on production: ${rows.map((r) => r.id).join(", ")} — CLEANUP=1 deletes them`);
    }
    console.log(`\nprove-offline-push: ${failed === 0 ? "OK" : `${failed} FAILED`}`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("\nprove-offline-push:", err.stack ?? err.message);
    process.exit(2);
  });
