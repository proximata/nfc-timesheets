// IS THE MAPS BROWSER KEY AUTHORISED FOR THE HOST THAT ACTUALLY SERVES THE ADMIN?
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node server/server.js &
//   node demo/check-map-key.mjs
//
// WHY THIS FILE EXISTS. The map is the landing surface (decision-39). The director has
// never seen a pin. The reason has now been misdiagnosed twice in writing:
//
//   "TASK-16, ops/deploy.sh never sets NEXT_PUBLIC_GOOGLE_MAPS_KEY — one line"
//   "the key is referrer-restricted and rejects 127.0.0.1"
//
// Both were recorded as measured facts. The first is half of it. The second is false — the
// key loads on `http://127.0.0.1:8080/`, which is the fixture demo/check-map-home.mjs has
// documented all along; the runs that "measured" it were on a different port.
//
// The actual live defect is neither: the key's HTTP-referrer allowlist names
// `timesheets.exe.xyz`, which was the API box's name BEFORE the rename that decision-40 was
// written about. That host is now the tag box — nginx, three static files, no admin panel.
// The admin panel is on `apiHost`, and the key refuses it. So adding the key to
// `ops/deploy.sh` ships a build that still draws no pin, with the reason only visible in a
// browser console nobody opens.
//
// A key restriction is not in this repository and cannot be grepped. It CAN be asked, and
// the answer is a yes/no per origin, so that is what this does: it fronts the local build
// under a real hostname over TLS, points Chrome's resolver at loopback, and reads whether
// Google drew a map. Nothing leaves this machine except the key check itself, which is the
// request the browser would make anyway.
//
// NOT A DUPLICATE of check-map-home.mjs. That file proves the map SURFACE against the one
// origin the key already allows. This file proves the key allows the origin PRODUCTION USES,
// which is the half no amount of local green can see.
//
// It SKIPS, like every other check here, when it cannot run: no key, no openssl, no Chrome,
// no server. "I cannot check this here" is not "broken".
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { attach, sleep } from './cdp.mjs'

const UPSTREAM = process.env.MAP_KEY_UPSTREAM ?? '127.0.0.1:8080'
const CERT_DIR = '/tmp/ts-demo/map-key-tls'
const TLS_PORT = 8446
const CDP_PORT = 9421
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Loopback only. The same guard every other demo/*.mjs carries, and it matters more here:
// this file logs in, and it teaches a browser to resolve a REAL production hostname
// somewhere else. Both halves must stay pinned to this machine.
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(UPSTREAM)) {
  console.error(`check-map-key: refusing a non-loopback upstream: ${UPSTREAM}`)
  process.exit(1)
}

const skip = (why) => {
  console.log(`SKIP check-map-key: ${why}`)
  process.exit(0)
}

const branding = JSON.parse(readFileSync(new URL('../ops/branding.json', import.meta.url), 'utf8'))
const API_HOST = branding.apiHost
const TAG_HOST = branding.tagHost

if (!existsSync(CHROME)) skip('Google Chrome is not installed at the expected path')
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' })
} catch {
  skip('openssl is not on PATH — it generates the throwaway certificate')
}
try {
  const res = await fetch(`http://${UPSTREAM}/login/`)
  if (!res.ok) skip(`no build being served on ${UPSTREAM} (got ${res.status})`)
} catch {
  skip(`nothing listening on ${UPSTREAM} — start the server with PUBLIC_DIR=web/out`)
}
// The build must CARRY a key, or every origin below answers "no map" for the wrong reason.
// BOTH documents, and `/` is the one that matters: the map lives on the dashboard, so the
// chunk holding the key is referenced from there and not from `/login/`. Reading only the
// login page made this skip on a build that had the key sitting in it.
const chunks = new Set()
for (const doc of ['/login/', '/']) {
  const html = await (await fetch(`http://${UPSTREAM}${doc}`)).text()
  for (const c of html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9._-]+\.js/g) ?? []) chunks.add(c)
}
let hasKey = false
for (const c of chunks) {
  if (/AIza[A-Za-z0-9_-]{20,}/.test(await (await fetch(`http://${UPSTREAM}${c}`)).text())) {
    hasKey = true
    break
  }
}
if (!hasKey) {
  skip(
    'this build carries no Maps key, so every origin would answer "no map" for the wrong\n' +
      '     reason. Rebuild: cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build',
  )
}

// ---- a throwaway certificate for the hostnames under test --------------------------------
// 7 days, /tmp only, and Chrome is told to ignore certificate errors anyway — it exists so
// the page ORIGIN is `https://<host>/`, which is the only thing Google is being asked about.
mkdirSync(CERT_DIR, { recursive: true })
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: CERT_DIR, stdio: 'ignore' })
sh('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-sha256',
  '-days',
  '7',
  '-nodes',
  '-keyout',
  'ca.key',
  '-out',
  'ca.pem',
  '-subj',
  '/CN=map-key check CA/O=local only',
])
sh('openssl', [
  'req',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-keyout',
  'server.key',
  '-out',
  'server.csr',
  '-subj',
  `/CN=${API_HOST}`,
])
execFileSync(
  'sh',
  [
    '-c',
    `printf 'subjectAltName=DNS:${API_HOST},DNS:${TAG_HOST},IP:127.0.0.1\\nextendedKeyUsage=serverAuth\\nbasicConstraints=CA:FALSE\\n' > ext.cnf`,
  ],
  { cwd: CERT_DIR },
)
sh('openssl', [
  'x509',
  '-req',
  '-in',
  'server.csr',
  '-CA',
  'ca.pem',
  '-CAkey',
  'ca.key',
  '-CAcreateserial',
  '-out',
  'server.pem',
  '-days',
  '7',
  '-sha256',
  '-extfile',
  'ext.cnf',
])

const front = spawn(
  'node',
  [
    new URL('./tls-front.mjs', import.meta.url).pathname,
    '--cert',
    CERT_DIR,
    '--port',
    String(TLS_PORT),
    '--upstream',
    UPSTREAM,
  ],
  { stdio: 'ignore' },
)

/** Does Google draw a map when the page's origin is `https://<host>/`? */
async function mapLoadsAt(host) {
  // A FRESH PROFILE PER HOST, wiped first — the same thing cdp.mjs's launchChrome does, and
  // for a sharper reason here: a reused profile carries the previous host's session cookie
  // and, worse, Chrome sometimes re-attaches to the old profile's window instead of opening
  // one, which surfaces as "no page target" rather than as a wrong answer.
  const profile = `/tmp/ts-demo/chrome-profile-mapkey-${host}`
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      // The whole trick, and it is one flag: the real hostname, resolved to the local front.
      `--host-resolver-rules=MAP ${host}:443 127.0.0.1:${TLS_PORT}`,
      '--ignore-certificate-errors',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  try {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break
      } catch {
        /* not up yet */
      }
      await sleep(100)
    }
    // ATTACH IS RETRIED, and that is not flake-papering. On a profile that was just wiped,
    // Chrome's debugging port answers /json/version while /json/list still holds only
    // `browser_ui` targets (the omnibox popup) — attach picks `type === 'page'` and throws
    // "no page target". Observed every run here and never in the other demo scripts, which
    // reuse a warm profile.
    let page = null
    for (let i = 0; i < 40 && page === null; i++) {
      page = await attach(CDP_PORT).catch(() => null)
      if (page === null) await sleep(150)
    }
    if (page === null) skip(`Chrome opened no page target for ${host}`)
    let refused = false
    page.on('Runtime.consoleAPICalled', (p) => {
      if (/RefererNotAllowed/.test((p.args ?? []).map((a) => a.value ?? '').join(' ')))
        refused = true
    })
    const base = `https://${host}`
    await page.goto(`${base}/login/`)
    await page.type('input[name="email"]', process.env.DEMO_EMAIL ?? 'demo@example.test', {
      perChar: 3,
    })
    await page.type('input[name="password"]', process.env.DEMO_PASSWORD ?? 'demo-nur-lokal-2026', {
      perChar: 3,
    })
    await page.eval(`document.querySelector('form button[type="submit"]').click()`)
    await sleep(2500)
    await page.goto(base + '/')
    await sleep(6000)
    const canvas = await page.eval(`document.querySelectorAll('.gm-style').length`)
    const pins = await page.eval(`document.querySelectorAll('.map-pin').length`)
    await page.close()
    return { ok: canvas > 0 && !refused, canvas, pins, refused }
  } finally {
    child.kill()
  }
}

const lines = []
let failed = false
try {
  await sleep(1200)
  for (const [host, role] of [
    [API_HOST, 'apiHost — serves the admin panel'],
    [TAG_HOST, 'tagHost — three static files'],
  ]) {
    const r = await mapLoadsAt(host)
    lines.push(
      `  ${r.ok ? 'ok  ' : 'FAIL'} https://${host}/  ${role}\n` +
        `         canvas=${r.canvas} pins=${r.pins} ${r.refused ? 'RefererNotAllowedMapError' : ''}`,
    )
    // ONLY apiHost is required. tagHost is reported because knowing WHICH host the
    // allowlist still names is the difference between "add the key" and "the allowlist is
    // one rename behind", and those are different jobs for different people.
    if (host === API_HOST && !r.ok) failed = true
  }
} finally {
  front.kill()
}

console.log(lines.join('\n'))
if (failed) {
  console.error(
    `\nFAIL check-map-key: the Maps browser key is NOT authorised for https://${API_HOST}/,\n` +
      'which is the host that serves the admin panel. Every pin, the grey unzoned state and\n' +
      'the info box are therefore absent in production, and adding the key to ops/deploy.sh\n' +
      'does NOT fix it on its own.\n' +
      'FIX (Google Cloud console > APIs & Services > Credentials > the browser key >\n' +
      `Application restrictions > Websites): add https://${API_HOST}/*  — and keep\n` +
      `http://127.0.0.1:8080/* , which is what demo/check-map-home.mjs runs against.`,
  )
  process.exit(1)
}
console.log('\ncheck-map-key: OK')
