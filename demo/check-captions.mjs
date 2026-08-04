// The runnable check for demo/burnin.mjs: no frame may ever carry two captions.
//
//   node demo/check-captions.mjs
//
// WHY THIS EXISTS. ffmpeg's `between(t,a,b)` is inclusive at BOTH ends, and in a caption
// track one line's end IS the next line's start. Any frame whose timestamp landed exactly
// on a boundary therefore satisfied both `enable` expressions and drew both strings in the
// same place, producing one frame of illegible overprint. It shipped twice —
// docs/media/admin-walkthrough.mp4 at t=103.0s and docs/media/both-devices.mp4 at
// t=26.083s — because one frame in 1600 is invisible at speed and obvious only in a tile.
//
// The check renders a few seconds of real video through the REAL captionFilter, with
// boundaries deliberately placed ON frame times, and counts ink in the caption band. Two
// captions drawn at once put far more ink in the band than either alone, so the assertion
// is "no frame is an ink spike", which needs no OCR and no reference image.
//
// Needs ffmpeg, like everything else in demo/. Skips with exit 0 when it is absent.
import { execFileSync, spawnSync } from "node:child_process";
import { captionFilter } from "./burnin.mjs";

const FPS = 12;
const W = 480;
const H = 270;
const BOTTOM = 50;
const TOP = 34;
const TOTAL = 6;

if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
  console.log("check-captions: no ffmpeg — SKIP");
  process.exit(0);
}

// Boundaries land exactly on frame times (12 fps -> every 1/12 s). 2.0 and 4.0 are frame
// times; that is the whole point, and a boundary off the grid would pass either way.
const captions = [
  { at: 0, text: "First caption, the one that must end cleanly" },
  { at: 2, text: "Second caption, which must not overprint the first" },
  { at: 4, text: "Third caption, closing the clip" },
];

const filter = captionFilter(captions, TOTAL, {
  width: W,
  fps: FPS,
  banner: "DEMO — check-captions",
  top: TOP,
  bottom: BOTTOM,
}).join(",");

// A flat mid-grey source: the band ink is then entirely the captions.
const raw = execFileSync(
  "ffmpeg",
  [
    "-v", "error",
    "-f", "lavfi", "-i", `color=gray:s=${W}x${H}:d=${TOTAL}:r=${FPS}`,
    "-vf", `${filter},crop=${W}:${BOTTOM}:0:ih-${BOTTOM}`,
    "-pix_fmt", "gray", "-f", "rawvideo", "-",
  ],
  { maxBuffer: 1 << 28 },
);

const per = W * BOTTOM;
const frames = Math.floor(raw.length / per);
if (frames < TOTAL * FPS - 2) {
  console.error(`check-captions: expected ~${TOTAL * FPS} frames, got ${frames}`);
  process.exit(1);
}

const ink = [];
for (let f = 0; f < frames; f++) {
  let lit = 0;
  const off = f * per;
  for (let i = 0; i < per; i++) if (raw[off + i] > 200) lit++;
  ink.push(lit);
}

// Every frame carries exactly one caption, so every frame's ink should sit near the
// median. A doubly-drawn frame is a large spike above it.
const sorted = [...ink].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const bad = ink
  .map((v, f) => ({ f, t: +(f / FPS).toFixed(3), v }))
  .filter(({ v }) => v > median * 1.25);

if (median === 0) {
  console.error("check-captions: no caption ink at all — the filter drew nothing.");
  process.exit(1);
}
if (bad.length > 0) {
  console.error(`check-captions: ${bad.length} frame(s) carry more than one caption:`);
  for (const b of bad) console.error(`  t=${b.t}s ink=${b.v} vs median ${median}`);
  process.exit(1);
}

console.log(`check-captions: OK (${frames} frames, one caption each, median ink ${median})`);
