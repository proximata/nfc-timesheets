// IS THE BUNDLE UNDER THE BROWSER THE CODE IN THE TREE?
//
//   import { assertFreshBuild } from './build-guard.mjs'
//   assertFreshBuild()      // throws if any source file is newer than web/out
//
// WHY. Every browser check here drives a STATIC EXPORT. Editing a .tsx changes nothing that
// Chrome can see until `pnpm build` runs, and `git status` is clean the moment the source is
// put back — so "the tree is clean" and "the screen is the tree" are two different claims
// and only the first one is easy.
//
// It cost real time three times in one session, twice in the direction that matters:
//
//   * a mutant was applied, built, and the source restored WITHOUT rebuilding. The next
//     forty minutes were spent investigating an apparent product defect on /pl/ — a null
//     revenue rendering as 0,00 € — that was the mutant, still being served.
//   * the same again with web/lib/area.ts: six FAILs that read exactly like a real
//     regression in the INCOMPLETE-area wording, from a bundle nobody had rebuilt.
//   * and the benign direction: a fix was written, and the check went on reporting the old
//     failure until somebody noticed the build step had not run.
//
// The benign direction wastes an hour. The other one puts a fabricated defect into a report,
// or hides a real one behind a stale pass. Neither is acceptable in a file whose whole job
// is to be believed.
//
// mtime, not a content hash: the question is "did anybody touch a source file after the last
// build", one stat per file, no dependency, and nothing to keep in step.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const SOURCE_DIRS = ['app', 'components', 'lib', 'messages']
/** Not source: build output, deps, and the editor/OS droppings that are never compiled. */
const IGNORE = /^(node_modules|\.next|out|\.DS_Store)$/

function newestUnder(dir, best = { mtimeMs: 0, path: null }) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return best // a directory this project does not have is not a failure
  }
  for (const e of entries) {
    if (IGNORE.test(e.name)) continue
    const path = `${dir}/${e.name}`
    if (e.isDirectory()) {
      best = newestUnder(path, best)
      continue
    }
    if (!/\.(tsx?|css|json)$/.test(e.name)) continue
    const { mtimeMs } = statSync(path)
    if (mtimeMs > best.mtimeMs) best = { mtimeMs, path }
  }
  return best
}

/**
 * Throw unless `web/out` is at least as new as every file it was built from.
 *
 * ONE SECOND of slack, and it is not a fudge: a build writes `out/` while the compiler is
 * still reading sources, so an untouched file can legitimately land a few hundred
 * milliseconds either side. A stale bundle is stale by minutes.
 */
export function assertFreshBuild(webDir = new URL('../web', import.meta.url).pathname) {
  let built
  try {
    built = statSync(`${webDir}/out/index.html`).mtimeMs
  } catch {
    throw new Error(
      `build-guard: ${webDir}/out has no index.html — build it first:\n` +
        '  cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build',
    )
  }
  const newest = SOURCE_DIRS.map((d) => newestUnder(`${webDir}/${d}`)).reduce(
    (a, b) => (b.mtimeMs > a.mtimeMs ? b : a),
    { mtimeMs: 0, path: null },
  )
  if (newest.mtimeMs > built + 1000) {
    const behind = Math.round((newest.mtimeMs - built) / 1000)
    throw new Error(
      `build-guard: web/out is ${behind}s OLDER than ${newest.path.replace(`${webDir}/`, '')}.\n` +
        '  The browser would be reading a bundle that is not this tree, and every result\n' +
        '  below — pass or fail — would be about code nobody is looking at.\n' +
        '  cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build',
    )
  }
}

/**
 * ...AND WAS THAT BUILD MADE WITH THE MAPS KEY IN IT?
 *
 * THE FRESHNESS GUARD ABOVE PASSES ON A KEYLESS BUILD, and a keyless build is not a broken
 * run — it is a QUIET one. Without `NEXT_PUBLIC_GOOGLE_MAPS_KEY` at build time the map never
 * loads, `.map-pin` never exists, and every pin assertion in demo/probe-zones-revenue.mjs
 * and demo/check-ia-greyscale.mjs SKIPS or reports zero pins. That is how RECON came to
 * record "the grey pin has NEVER been observed, the key rejects loopback" as a measured
 * fact. It is observable, it always was, and the missing ingredient was the key.
 *
 * IT IS ONE COMMAND AWAY AT ALL TIMES. `pnpm verify` runs `pnpm build` with no key — it is
 * the type/lint gate and has no business knowing about Google — so ANY run that verifies
 * after building overwrites `web/out` with a keyless bundle, and the next browser check goes
 * quietly blind. Measured this session: exactly that happened, mid-probe.
 *
 * So a check that depends on pins asks for this explicitly. It throws rather than warns: a
 * warning in a 600-line log is a skip with extra steps.
 */
export function assertMapKeyInBuild(webDir = new URL('../web', import.meta.url).pathname) {
  const chunks = `${webDir}/out/_next/static/chunks`
  let names
  try {
    names = readdirSync(chunks).filter((n) => n.endsWith('.js'))
  } catch {
    throw new Error(`build-guard: ${chunks} does not exist — build web/out first.`)
  }
  // The literal Google browser-key prefix. Looking for the ENV VAR NAME would not work:
  // Next inlines the value and the name is gone from the output.
  const found = names.some((n) => readFileSync(`${chunks}/${n}`, 'utf8').includes('AIzaSy'))
  if (!found) {
    throw new Error(
      'build-guard: web/out was built WITHOUT NEXT_PUBLIC_GOOGLE_MAPS_KEY.\n' +
        `  ${names.length} chunk(s) scanned, no AIzaSy… in any of them. The map will not load,\n` +
        '  no .map-pin will exist, and every pin assertion below would SKIP or read zero pins\n' +
        '  — which is not a pass. `pnpm verify` rebuilds without the key; rebuild with it:\n' +
        '  cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build\n' +
        '  and run the API on :8080 — the ONLY loopback origin the key’s referrer allowlist has.',
    )
  }
}

/**
 * ...AND IS THE SERVER ON THIS PORT RUNNING THIS TREE'S SERVER CODE?
 *
 * THE OTHER HALF, and it is the half that nearly put a false GREEN in a report. `assertFreshBuild`
 * only covers the STATIC EXPORT. `server/lib/reporting.js` is loaded ONCE at boot, so a probe
 * that mutates it, restarts "the" server and re-runs is measuring the mutant only if the restart
 * actually took the port.
 *
 * WHAT HAPPENED. Two agents died mid-run and left `node server/server.js` orphaned on :8080,
 * :4319 and :3000. Every later `node server/server.js &` hit EADDRINUSE and exited; the orphan
 * kept answering. `/health` returned 200, the static files came off disk so every REBUILD was
 * picked up correctly — and server-side mutations silently were not. A mutation test of the
 * area-derivation drift therefore reported the mutant as GREEN. It is red, and it took a
 * `lsof` to find out why.
 *
 * SO THE QUESTION IS ASKED OF THE PROCESS, NOT OF THE PROTOCOL. `/health` cannot answer it —
 * a five-day-old build says `{"ok":true}` just as cheerfully. Two facts about the LISTENER:
 *
 *   1. it is running out of THIS working tree (argv/cwd), not some other checkout
 *   2. it started AFTER the newest file under server/, so its module graph is this code
 *
 * Both come from `lsof` + `ps`, which demo/ already shells out to elsewhere. No dependency,
 * no server change, and nothing to keep in step.
 *
 * IT WARNS RATHER THAN THROWS when it cannot tell (no lsof, a container, an unusual ps): a
 * guard that cannot run must not become a reason not to run the check. It throws only when it
 * has POSITIVELY established that the listener is stale.
 */
export function assertFreshServer(base, serverDir = new URL('../server', import.meta.url).pathname) {
  const port = Number(new URL(base).port || 80)
  let pids
  try {
    pids = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    console.warn(`  note  build-guard: cannot ask who holds :${port} (no lsof) — not checked`)
    return
  }
  if (pids.length === 0) throw new Error(`build-guard: nothing is listening on ${base}`)

  const newest = newestUnderAny(serverDir)
  for (const pid of pids) {
    let started
    let command
    try {
      const out = execFileSync('ps', ['-o', 'lstart=,command=', '-p', pid], { encoding: 'utf8' })
      // `lstart` is a fixed 24-char ctime string; the command is whatever follows it.
      started = Date.parse(out.slice(0, 24))
      command = out.slice(24).trim()
    } catch {
      continue // the process went away between lsof and ps; not our business
    }
    if (Number.isNaN(started)) continue
    if (newest.mtimeMs > started) {
      throw new Error(
        `build-guard: the server on :${port} (pid ${pid}) booted BEFORE ` +
          `${newest.path.replace(`${serverDir}/`, 'server/')} was last written.\n` +
          `  It is serving a module graph that is not this tree. Server-side edits — including\n` +
          '  a mutant you are about to call GREEN — are NOT in it. This is usually an orphan\n' +
          '  left by an earlier run: a second `node server/server.js` hits EADDRINUSE, exits,\n' +
          '  and the orphan goes on answering /health with 200.\n' +
          `  pkill -f 'node server/server.js'   then start it again.\n` +
          `  holder: ${command}`,
      )
    }
  }
}

/** Newest .js/.mjs/.sql under a directory, ignoring deps and build output. */
function newestUnderAny(dir, best = { mtimeMs: 0, path: null }) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return best
  }
  for (const e of entries) {
    if (IGNORE.test(e.name)) continue
    const path = `${dir}/${e.name}`
    if (e.isDirectory()) {
      best = newestUnderAny(path, best)
      continue
    }
    if (!/\.(m?js|sql)$/.test(e.name)) continue
    const { mtimeMs } = statSync(path)
    if (mtimeMs > best.mtimeMs) best = { mtimeMs, path }
  }
  return best
}
