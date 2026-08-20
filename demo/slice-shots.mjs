// Cut a tall full-page phone screenshot into readable tiles.
//
//   node demo/slice-shots.mjs docs/media/look-phone/390-dark-home.png [tileHeightPx]
//
// A 9914px-tall PNG is not a picture anybody looks at; it is a picture everybody scales to
// thumbnail and then claims to have read. ffmpeg is already a dependency of demo/png.mjs,
// so this is a crop loop and nothing else.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const src = process.argv[2]
if (!src) throw new Error('usage: node demo/slice-shots.mjs <png> [tileHeight]')
const TILE = Number(process.argv[3] ?? 1400)
const OVERLAP = 60

const probe = execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src,
]).toString().trim()
const [w, h] = probe.split(',').map(Number)

const out = join(dirname(src), 'tiles')
mkdirSync(out, { recursive: true })
const stem = basename(src, '.png')

let i = 0
for (let y = 0; y < h; y += TILE - OVERLAP) {
  const tileH = Math.min(TILE, h - y)
  if (tileH < 40) break
  const file = join(out, `${stem}-t${String(++i).padStart(2, '0')}.png`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `crop=${w}:${tileH}:0:${y}`, file])
  console.log(`${file}  y=${y}..${y + tileH} of ${h}`)
}
