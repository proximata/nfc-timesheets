// The one place that decides whether a DATABASE_URL is a LOCAL DEMO database.
//
// Shared by demo/demo-server.mjs and demo/make-admin.mjs rather than copied into each,
// because the interesting part of this check is not the part anybody guesses. Both of
// those scripts previously did `new URL(DATABASE_URL).hostname` and compared it to a
// loopback allowlist, and BOTH could be pointed at the live database anyway:
//
//   DATABASE_URL='postgres:///nfc_demo?host=timesheets.exe.xyz'
//   PGHOST=timesheets.exe.xyz DATABASE_URL='postgres:///nfc_demo'
//
// MEASURED, not theorised — with node-postgres 8.21.0, both open a TCP connection to
// timesheets.exe.xyz:5432 while `new URL(...).hostname` reads "" or "127.0.0.1":
//
//   1. pg-connection-string honours a `host` QUERY PARAMETER and it BEATS the URL host
//      ("Only set the host if there is no equivalent query param", index.js:55) — so even
//      `postgres://127.0.0.1/nfc_demo?host=<live>` leaves the machine.
//   2. pg/lib/connection-parameters.js:15 falls back to `process.env['PG'+KEY]` for any
//      key the connection string does not set, so an empty URL host becomes $PGHOST.
//
// A guard that reads a different value than the driver does is not a guard. So this
// checks EVERY input that can become the connection target, not just the pretty one.
const LOOPBACK = ["127.0.0.1", "localhost", "::1", ""];

// A unix socket path is local by construction: it is a file on this machine, not a
// route off it. libpq spells one as a host that starts with "/" (or "@" for abstract).
const isSocketPath = (h) => h.startsWith("/") || h.startsWith("@");
const isLocal = (h) => LOOPBACK.includes(h) || isSocketPath(h);

/**
 * Returns the demo database name, or calls `refuse(reason)` and never returns.
 *
 * @param {string} databaseUrl  the raw DATABASE_URL
 * @param {(why: string) => never} refuse  how the caller reports and exits
 * @param {NodeJS.ProcessEnv} env
 */
export function assertDemoDatabase(databaseUrl, refuse, env = process.env) {
  if (databaseUrl === "") refuse("DATABASE_URL is not set — refusing to guess.");

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return refuse(`DATABASE_URL "${databaseUrl}" is not a URL — refusing.`);
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (name !== "nfc_demo") {
    refuse(`refusing database "${name}" — demo scripts touch nfc_demo only.`);
  }

  // 1. The query parameters that OUTRANK the URL host. Rejected rather than resolved:
  //    the demo has no use for them, and "reject what you do not understand" is the only
  //    version of this that stays correct when pg adds the next one.
  for (const key of ["host", "hostaddr"]) {
    const v = url.searchParams.get(key);
    if (v !== null && !isLocal(v)) {
      refuse(`refusing DATABASE_URL ?${key}=${v} — loopback only (it overrides the URL host).`);
    }
  }

  // 2. The URL host itself.
  if (!isLocal(url.hostname)) {
    refuse(`refusing a database on "${url.hostname}" — loopback only.`);
  }

  // 3. The environment the driver falls back to when the URL names no host. Only
  //    consulted when nothing above pinned the host, which is exactly when it applies.
  const pinned = url.searchParams.get("host") ?? (url.hostname === "" ? null : url.hostname);
  if (pinned === null) {
    for (const key of ["PGHOST", "PGHOSTADDR"]) {
      const v = env[key];
      if (v !== undefined && v !== "" && !isLocal(v)) {
        refuse(`refusing $${key}=${v} — loopback only (it becomes the database host).`);
      }
    }
  }

  return name;
}
