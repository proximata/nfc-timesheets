// The Android self-update surface: "is there a newer build" + "fetch the APK". Nothing
// else in this iteration is riskier to get wrong on the SERVER than the NFC write path
// (that risk lives in android/, not here), but this is the one thing that has to work
// FIRST: the phone in the field is running a build that cannot even clock in, and there is
// no way to fix that except getting a new build onto it.
//
// WHO MAY FETCH IT, AND WHY (the owner's own question, answered here, not deferred):
//   Gated by X-App-Key ONLY (`auth: "app"`), like /auth/apple and /auth/code \u2014 no worker
//   or operator SESSION required. Two readings were on the table:
//     unauthenticated (no key at all)  -> anyone on the internet can download our APK.
//       That is a real, if small, cost \u2014 decompilation reveals API shapes \u2014 but not
//       customer data (no route here touches the database at all).
//     a live SESSION required          -> a worker or operator whose session has EXPIRED,
//       which is EXACTLY the moment they most need an update (a fixed build is often the
//       actual fix for a broken session), could not fetch one. That is a lockout with no
//       recovery: the phone cannot get the file that would let it log back in.
//   The app key is the middle ground already established everywhere else sign-in-adjacent
//   happens in this codebase: it is baked into every build that could possibly be asking
//   (a phone with no build yet cannot call this route at all \u2014 the FIRST install is a
//   sideload or a share, never this endpoint), and it keeps the route off the open web for
//   a browser or a stray curl, without depending on a session that is precisely the thing
//   this route exists to help recover from.
//
// WHERE THE APK ACTUALLY LIVES ON THE BOX: server/releases/, a directory that sits beside
// server.js exactly the way `public/` (the admin export) and `ops/` already do \u2014 see
// ops/deploy.sh's own "Artifact layout on the VM" comment. On the deployed box that is
// /srv/nfc/releases/. Getting a real APK there is a DEPLOY change (one more rsync line in
// ops/deploy.sh) and is explicitly NOT done by this task: this task owns sql/ and server/
// only, and "deploying anything" is out of scope for this iteration. What IS built here
// works the moment that directory exists with two files in it \u2014 a manifest and the APK \u2014
// however they get there.
//
// THE MANIFEST IS A STATIC FILE, NOT A DATABASE ROW. "A static file plus a tiny JSON
// document is a legitimate answer" \u2014 and it is a STRICTLY SMALLER one: no migration, no
// admin screen to edit it, no route to leak the wrong environment's shape. Ship a new APK
// by rsyncing the .apk and rewriting releases/latest.json; that is the whole release
// process this iteration needs.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "../lib/http.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// One directory up from routes/, matching how server.js's PUBLIC_DIR sits beside server.js
// itself. Overridable with RELEASES_DIR \u2014 the SAME idiom PUBLIC_DIR already uses \u2014 so
// check-api.js can point it at a scratch directory with a fixture manifest and never touch
// a real APK, and so a future deploy can relocate it without a code change.
const RELEASES_DIR = path.resolve(process.env.RELEASES_DIR ?? path.join(HERE, "..", "releases"));
const MANIFEST_PATH = path.join(RELEASES_DIR, "latest.json");

/**
 * Read releases/latest.json. Returns `null` for "nothing published yet" AND for a
 * malformed manifest \u2014 both are read as the same state by the caller, because a broken
 * manifest must never 500 an update check any more than a missing one does. This route
 * has no database dependency at all: a directory read is the entire mechanism, so the
 * update check works even if Postgres is down, which is exactly when a worker most needs
 * to know whether a fix is already out.
 */
async function readManifest() {
  let raw;
  try {
    raw = await readFile(MANIFEST_PATH, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(parsed?.version_code) || parsed.version_code < 1) return null;
  if (typeof parsed.file !== "string" || parsed.file.trim() === "") return null;
  return parsed;
}

/**
 * GET /app/version -> the latest published build, or "nothing published yet".
 *
 *   { published: true,  version_code, version_name, sha256, notes, url: "/app/download" }
 *   { published: false }
 *
 * `version_code` is the ONLY field the app compares against its own \u2014 an integer that
 * only ever goes up, the same contract Android's own versionCode already is. `url` is a
 * PATH, not a full URL: the app already knows which host it is talking to (it just asked
 * this same host the question), and baking a host in here would be a second place a
 * rebrand (ops/branding.json, decision-24) could drift from.
 */
async function appVersion() {
  const manifest = await readManifest();
  if (!manifest) return { status: 200, body: { published: false } };
  return {
    status: 200,
    body: {
      published: true,
      version_code: manifest.version_code,
      version_name: typeof manifest.version_name === "string" ? manifest.version_name : null,
      sha256: typeof manifest.sha256 === "string" ? manifest.sha256 : null,
      notes: typeof manifest.notes === "string" ? manifest.notes : null,
      url: "/app/download",
    },
  };
}

/**
 * GET /app/download -> the APK bytes for the build GET /app/version just named.
 *
 * ALWAYS THE LATEST, never a specific version_code: this iteration's whole job is "get the
 * one phone in the field onto a build that can clock in", not a rollback shelf. `file` in
 * the manifest is trusted for its BASENAME only (`path.basename` strips any `/` or `..` a
 * hand-edited manifest might carry) \u2014 the manifest is not attacker input in the way a tag
 * is, but a served path is exactly the kind of thing this codebase never trusts twice.
 */
async function appDownload() {
  const manifest = await readManifest();
  if (!manifest) fail(404, "no_release_published");
  const filename = path.basename(manifest.file);
  const absPath = path.join(RELEASES_DIR, filename);
  try {
    await stat(absPath);
  } catch {
    // The manifest names a file that is not actually on disk — a bad rsync, a manifest
    // edited by hand ahead of the .apk it names. A clean 404 here, not the 500 that
    // `sendFile`'s own ENOENT would surface if this were skipped.
    fail(404, "release_file_missing");
  }
  return {
    status: 200,
    file: { path: absPath, contentType: "application/vnd.android.package-archive", filename },
  };
}

export const releaseRoutes = [
  { method: "GET", path: "/app/version", auth: "app", handler: appVersion },
  { method: "GET", path: "/app/download", auth: "app", handler: appDownload },
];
