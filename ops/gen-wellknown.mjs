#!/usr/bin/env node
/**
 * Generates the two association files from ops/branding.json:
 *
 *   server/wellknown/apple-app-site-association
 *   server/wellknown/assetlinks.json
 *
 *   node ops/gen-wellknown.mjs             # --check: regenerate in memory, diff vs disk
 *   node ops/gen-wellknown.mjs --write     # write the files
 *   node ops/gen-wellknown.mjs --write --allow-removal    # permit dropping an appID
 *
 * WHY THE OUTPUT IS COMMITTED, not generated at deploy time:
 * AASA is the most dangerous file in this product. A human has to be able to read the exact
 * bytes in a `git diff` BEFORE they reach a wall. Deploy-time-only generation hides the bytes
 * behind a script and moves the review to a moment when nobody is looking. So the generator
 * writes files that are reviewed and committed, deploy.sh only ASSERTS they are in sync, and
 * the artifact that ships is the one that was read by a person.
 *
 * ponytail: node stdlib, no template engine, no JSON pretty-printer. assetlinks.json is
 *   emitted from a string template rather than JSON.stringify(x, null, 2) because the live
 *   file keeps `"relation": [...]` on one line and stringify would reflow it - and reflowing
 *   the bytes of a file that gates physical tags to satisfy a formatter is a bad trade.
 *   Ceiling: two files, one shape each. If a third association file ever appears, this wants
 *   a real emitter. Upgrade path: keep the byte-diff acceptance, swap the renderer.
 *
 * This file runs on a DEVELOPER MACHINE. It is not imported by the server and adds no server
 * dependency (decision-16 as amended by decision-23: pg + @sentry/node, nothing else).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BRANDING_PATH = join(ROOT, "ops", "branding.json");

const AASA_PATH = join(ROOT, "server", "wellknown", "apple-app-site-association");
const ASSETLINKS_PATH = join(ROOT, "server", "wellknown", "assetlinks.json");

// Apple team ids are 10 uppercase alphanumerics. Bundle ids are reverse-DNS, letters/digits/
// hyphens per segment. Android package segments are stricter than Apple's: no hyphens, must
// start with a letter - a hyphen here is a Gradle error, not a warning.
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const TEAM_RE = /^[A-Z0-9]{10}$/;
const BUNDLE_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
// Uppercase, colon-separated, 32 bytes. Lowercase parses as JSON and is then ignored by
// Android's verifier, which is a silent dead tag - so it is rejected here, loudly.
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const EMPTY_FINGERPRINT_COMMENT =
  "sha256_cert_fingerprints stays EMPTY until an Android signing key exists. Fill it with the SHA-256 of the upload/release certificate (keytool -list -v -keystore <ks> | grep SHA256) and redeploy. Android App Links stay unverified while the array is empty; the file itself is already at the right URL so no retrofit is needed.";

/** Reads and validates ops/branding.json. Throws with EVERY problem, not just the first. */
export function readBranding(path = BRANDING_PATH) {
  const b = JSON.parse(readFileSync(path, "utf8"));
  const bad = [];

  const str = (value, name, re) => {
    if (typeof value !== "string" || !re.test(value)) {
      bad.push(`${name}: ${JSON.stringify(value)} does not match ${re}`);
    }
  };

  str(b.host, "host", HOST_RE);
  if (typeof b.appName !== "string" || b.appName.trim() === "") bad.push("appName: must be a non-empty string");

  str(b.apple?.teamId, "apple.teamId", TEAM_RE);
  if (!Array.isArray(b.apple?.bundleIds) || b.apple.bundleIds.length === 0) {
    bad.push("apple.bundleIds: must be a non-empty array (it is an array so a handover can APPEND)");
  } else {
    b.apple.bundleIds.forEach((id, i) => str(id, `apple.bundleIds[${i}]`, BUNDLE_RE));
  }
  if (!Array.isArray(b.apple?.paths) || b.apple.paths.length === 0) {
    bad.push("apple.paths: must be a non-empty array");
  }

  str(b.android?.packageName, "android.packageName", PACKAGE_RE);
  if (!Array.isArray(b.android?.sha256CertFingerprints)) {
    bad.push("android.sha256CertFingerprints: must be an array (Play upload key AND Play signing key)");
  } else {
    b.android.sha256CertFingerprints.forEach((f, i) => {
      str(f, `android.sha256CertFingerprints[${i}]`, FINGERPRINT_RE);
    });
  }

  if (bad.length > 0) throw new Error(`${path} is invalid:\n  - ${bad.join("\n  - ")}`);
  return b;
}

export function renderAASA(b) {
  const details = b.apple.bundleIds.map((id) => ({
    appID: `${b.apple.teamId}.${id}`,
    paths: b.apple.paths,
  }));
  return `${JSON.stringify({ applinks: { details } })}\n`;
}

export function renderAssetlinks(b) {
  const fps = b.android.sha256CertFingerprints;
  const lines = ["[", "  {"];
  // The comment only tells the truth while the array is empty, so it is only emitted then.
  if (fps.length === 0) lines.push(`    "_comment": ${JSON.stringify(EMPTY_FINGERPRINT_COMMENT)},`);
  lines.push('    "relation": ["delegate_permission/common.handle_all_urls"],');
  lines.push('    "target": {');
  lines.push('      "namespace": "android_app",');
  lines.push(`      "package_name": ${JSON.stringify(b.android.packageName)},`);
  if (fps.length === 0) {
    lines.push('      "sha256_cert_fingerprints": []');
  } else {
    lines.push('      "sha256_cert_fingerprints": [');
    fps.forEach((f, i) => lines.push(`        ${JSON.stringify(f)}${i === fps.length - 1 ? "" : ","}`));
    lines.push("      ]");
  }
  lines.push("    }", "  }", "]");
  return `${lines.join("\n")}\n`;
}

export function targets(b) {
  return [
    { path: AASA_PATH, body: renderAASA(b) },
    { path: ASSETLINKS_PATH, body: renderAssetlinks(b) },
  ];
}

/** appIDs currently on disk. `[]` when the file is missing or unparseable. */
function committedAppIDs() {
  try {
    const aasa = JSON.parse(readFileSync(AASA_PATH, "utf8"));
    return (aasa.applinks?.details ?? []).map((d) => d.appID);
  } catch {
    return [];
  }
}

/**
 * Removing an appID from AASA bricks every INSTALLED copy of that app the moment its cached
 * association refreshes - and the owner cannot un-install it from a worker's phone. A handover
 * therefore APPENDS the new operator's appID and keeps the old one until the old app is dead.
 */
export function removalGuard(b) {
  const generated = new Set(JSON.parse(renderAASA(b)).applinks.details.map((d) => d.appID));
  return committedAppIDs().filter((id) => !generated.has(id));
}

function firstDiffLine(a, c) {
  const al = a.split("\n");
  const cl = c.split("\n");
  for (let i = 0; i < Math.max(al.length, cl.length); i++) {
    if (al[i] !== cl[i]) return `    line ${i + 1}\n      on disk:   ${al[i] ?? "<eof>"}\n      generated: ${cl[i] ?? "<eof>"}`;
  }
  return "    (files differ only in trailing bytes)";
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const allowRemoval = args.includes("--allow-removal");

  let b;
  try {
    b = readBranding();
  } catch (error) {
    process.stderr.write(`FATAL: ${error.message}\n`);
    process.exit(1);
  }

  const dropped = removalGuard(b);
  if (dropped.length > 0 && !allowRemoval) {
    process.stderr.write(
      "FATAL: ops/branding.json would REMOVE appIDs already published in the committed AASA:\n" +
        dropped.map((id) => `  - ${id}\n`).join("") +
        "Every installed copy of that app stops opening tags when its AASA cache refreshes.\n" +
        "A handover APPENDS to apple.bundleIds. If you really mean to drop it, re-run with --allow-removal.\n",
    );
    process.exit(1);
  }
  if (dropped.length > 0) {
    process.stdout.write(`  WARN removing published appID(s): ${dropped.join(", ")} (--allow-removal given)\n`);
  }
  if (b.android.sha256CertFingerprints.length === 0) {
    process.stdout.write(
      "  WARN android.sha256CertFingerprints is empty: Android App Links stay UNVERIFIED and every tap opens the browser.\n",
    );
  }

  let drift = 0;
  for (const { path, body } of targets(b)) {
    const rel = path.slice(ROOT.length + 1);
    let onDisk = null;
    try {
      onDisk = readFileSync(path, "utf8");
    } catch {
      /* missing counts as drift */
    }

    if (onDisk === body) {
      process.stdout.write(`  ok   ${rel}\n`);
      continue;
    }
    if (write) {
      writeFileSync(path, body);
      process.stdout.write(`  WROTE ${rel}\n`);
      continue;
    }
    drift++;
    process.stdout.write(`  DRIFT ${rel}\n${onDisk === null ? "    (missing)" : firstDiffLine(onDisk, body)}\n`);
  }

  if (drift > 0) {
    process.stderr.write(
      "\nFATAL: committed association files do not match ops/branding.json.\n" +
        "Run `node ops/gen-wellknown.mjs --write`, READ THE DIFF, then commit.\n",
    );
    process.exit(1);
  }
  process.stdout.write(write ? "gen-wellknown: written\n" : "gen-wellknown: in sync\n");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
