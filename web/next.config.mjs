import { execFileSync } from 'node:child_process'

/**
 * THE BUILD ID IS DERIVED, NOT RANDOM.
 *
 * Next's default build id is a random string embedded in every emitted .html and .txt file
 * (`/_next/static/<buildId>/…`). That makes the export NON-REPRODUCIBLE: build the same
 * commit twice and 133 of 176 files differ while the JavaScript and the CSS are byte for
 * byte identical.
 *
 * That is not a tidiness point. `ops/check-box-serves-head.sh` (TASK-231) exists because
 * three times in one week this project had fixes in git and not on the box, and it answers
 * "is the code THERE" by hashing the whole artefact on both sides. With a random build id
 * that check CAN NEVER BE GREEN — it printed „the box is NOT serving this tree. Run
 * ./ops/deploy.sh" over a box whose `_next/static/chunks` + `css` hashed IDENTICAL to the
 * local build. An alarm that fires on every run is not an alarm; the next person turns it
 * off, and the failure it was installed for comes back.
 *
 * So the id is the commit. Same commit -> same bytes -> the check is a real question again.
 * A dirty tree gets a `-dirty` suffix, because a box matching an uncommitted tree is not
 * reproducible either and should not be able to claim it is. No git (a tarball, a fresh
 * container) -> `null`, i.e. Next's own random default: this must never fail a build.
 *
 * @returns {string | null}
 */
function buildIdFromGit() {
  try {
    const git = (...args) =>
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const sha = git('rev-parse', 'HEAD')
    const dirty = git('status', '--porcelain', '--', '.').length > 0
    return dirty ? `${sha.slice(0, 12)}-dirty` : sha.slice(0, 12)
  } catch {
    return null
  }
}

const buildId = buildIdFromGit()

/**
 * decision-16: the admin panel is a static export served by the Node API process on the
 * exe.dev VM. Not Vercel, not Cloudflare Pages. So: no server runtime, no image optimizer,
 * no middleware, no route handlers.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  generateBuildId: () => buildId,
  // Same value, handed to the browser so a Sentry event names the tree it came from
  // (decision-70). It is already public — it is in every /_next/static/<buildId>/ path.
  env: { NEXT_PUBLIC_BUILD_ID: buildId ?? '' },
  // Emits out/shifts/index.html instead of out/shifts.html, so a dumb static file server
  // can resolve routes by directory without a rewrite table.
  trailingSlash: true,
  images: {
    // No Next image optimizer exists in a static export.
    unoptimized: true,
  },
  reactStrictMode: true,
  poweredByHeader: false,
}

export default nextConfig
