// Association files (d4) + the /t landing page (d5, d15).
//
// Mount FIRST in the main request handler, BEFORE any auth check:
//
//   import { wellknown } from "./routes/wellknown.js";
//   ...
//   if (wellknown(req, res)) return;   // handled
//
// Hard rules, because these responses gate physical NFC tags:
//   - /.well-known/apple-app-site-association is served with NO .json extension,
//     on the filename or the URL, Content-Type: application/json, HTTP 200,
//     ZERO redirect hops. iOS refuses anything else and every tag in every
//     building would have to be physically rewritten.
//   - never redirect (no trailing-slash normalisation, no http->https bounce here;
//     the exe.dev proxy terminates TLS in front of us).
//   - short cache only, so a fixed file goes live within minutes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "wellknown");

// ponytail: files are read once at process start. Ceiling: an rsync that replaces a
// file without restarting the unit keeps serving the old bytes. Deploy restarts the
// systemd unit, so that cannot happen. Upgrade path: stat-based revalidation.
const AASA = readFileSync(join(DIR, "apple-app-site-association"));
const ASSETLINKS = readFileSync(join(DIR, "assetlinks.json"));
const LANDING = readFileSync(join(DIR, "t.html"));

const MAX_AGE = 300; // 5 min. Cheap enough, short enough to unbreak fast.

function serve(res, body, type) {
  res.writeHead(200, {
    "content-type": type,
    "content-length": body.length,
    "cache-control": `public, max-age=${MAX_AGE}`,
  });
  res.end(body);
}

/**
 * @returns {boolean} true when the request was handled and the caller must stop.
 */
export function wellknown(req, res) {
  // This runs before anything else, so a URL it cannot parse (e.g. `//`, which is a
  // protocol-relative URL with an empty host) threw straight past the dispatcher and
  // surfaced as a 500. Hand malformed input back to the caller, which answers 400.
  let pathname;
  try {
    pathname = new URL(req.url, "http://x").pathname;
  } catch {
    return false;
  }

  const isAASA = pathname === "/.well-known/apple-app-site-association";
  const isAssetlinks = pathname === "/.well-known/assetlinks.json";
  // /t?l=<location uuid> is what the tags carry (decision-21 - never the slug; the query
  // string is ignored here, the app parses it). /t/ is accepted too - serving it beats a
  // redirect, which would break the universal-link handoff.
  const isLanding = pathname === "/t" || pathname === "/t/";

  if (!isAASA && !isAssetlinks && !isLanding) return false;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return true;
  }

  if (isAASA) serve(res, AASA, "application/json");
  else if (isAssetlinks) serve(res, ASSETLINKS, "application/json");
  else serve(res, LANDING, "text/html; charset=utf-8");

  return true;
}

export const wellknownPaths = [
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
  "/t",
];

export default wellknown;
