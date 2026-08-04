// Puts the iPhone clip and the Android clip side by side, stage by stage.
//
//   node demo/record-ios.mjs && node demo/record-android.mjs && node demo/compose-devices.mjs
//
// Writes docs/media/both-devices.mp4. It reads the raw recordings and the stage boundaries
// the two recorders wrote to /tmp/ts-demo/, so it can only ever be run after both.
//
// WHY SIDE BY SIDE AT ALL. The two apps are the same product and the differences are the
// interesting part: Sign in with Apple against an admin-issued enrolment code (decision-26),
// an icon badge against a lock-screen notification. Sequentially those differences are two
// minutes apart and nobody holds them in their head. Side by side they are one glance.
// Judged by looking at the output at 100%: at 400 px per device the German labels, the
// running clock and the tab bars are all legible, so side by side it is.
//
// THE ONE EDIT, STATED. Both recorders walk the SAME stages from demo/journey.mjs with the
// same minimum durations, so the two clips are already nearly in step. Where one device
// still finished a stage sooner, its LAST FRAME IS HELD until the other catches up
// (`tpad=stop_mode=clone`). Nothing is sped up, slowed down, cut or reordered, and a held
// frame is visible as a still picture. That is the whole of the manipulation.
//
// THE BEFORE AND AFTER CARDS are four real screenshots of four real builds, two per card,
// laid out in the same two panes as the journey so the eye can compare like with like:
//
//   before, Android : docs/media/before-android-shift.png, the build of 3 August 2026,
//                     produced by demo/record-android.mjs against this same seed.
//   before, iOS     : docs/media/app-shift.png as it stood at commit 33e66b2, the build of
//                     30 July 2026. That file was deleted from the tree because it carries
//                     a REAL CLIENT NAME, so it is recovered from the object store and the
//                     name is painted out before it is used — see maskedIosBefore(), which
//                     then reads the painted pixels back and refuses to continue unless
//                     every box is a single flat colour.
//   after, both     : the stills the two recorders took DURING the runs being composed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { captionFilter, fitFontSize } from "./burnin.mjs";
import { STAGES } from "./journey.mjs";

const WORK = "/tmp/ts-demo/compose";
const MEDIA = new URL("../docs/media/", import.meta.url).pathname;
const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";

// One device pane. 400 px wide reads at 100% and keeps the file small.
//
// The height has to be at least the TALLEST of the two sources once scaled to PANE_W, or
// `pad` refuses the job outright: the emulator records 540x1200, which becomes 400x888,
// and a 880-tall pane failed with "Padded dimensions cannot be smaller than input
// dimensions". The simulator's 1206x2622 becomes 400x869. 900 clears both.
const PANE_W = 400;
const PANE_H = 900;

const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

const read = (name) => {
  const path = `/tmp/ts-demo/${name}-stages.json`;
  if (!existsSync(path)) throw new Error(`${path} is missing — run demo/record-${name}.mjs first`);
  return JSON.parse(readFileSync(path, "utf8"));
};

const ios = read("ios");
const android = read("android");
const sources = {
  ios: "/tmp/ts-demo/ios-raw.mov",
  android: "/tmp/ts-demo/android-raw.mp4",
};
for (const [name, path] of Object.entries(sources)) {
  if (!existsSync(path)) throw new Error(`${path} is missing — run demo/record-${name}.mjs first`);
}

mkdirSync(WORK, { recursive: true });

/**
 * One stage of one device, cut out, letterboxed into the pane and held on its last frame
 * until `hold` seconds have passed.
 *
 * `-ss`/`-to` AFTER `-i` so the cut is frame-accurate rather than snapped to a keyframe:
 * a keyframe-accurate cut drifts by up to two seconds, which is the entire margin the
 * two clips have.
 */
function cut(device, index, hold) {
  const { at, until } = (device === "ios" ? ios : android).stages[index];
  const out = `${WORK}/${device}-${String(index).padStart(2, "0")}.mp4`;
  ff([
    "-i", sources[device],
    "-ss", at.toFixed(3), "-to", until.toFixed(3),
    "-vf", [
      `scale=${PANE_W}:-2`,
      `pad=${PANE_W}:${PANE_H}:0:(oh-ih)/2:black`,
      "fps=12",
      "setpts=PTS-STARTPTS",
      `tpad=stop_mode=clone:stop_duration=${Math.max(0, hold - (until - at)).toFixed(3)}`,
    ].join(","),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  return out;
}

// ---------------------------------------------------------------------------
// Stage by stage: cut both, hold the shorter, stack.
// ---------------------------------------------------------------------------
const segments = [];
const captions = [];
let clock = 0;

for (const [index, stage] of STAGES.entries()) {
  const iosStage = ios.stages[index];
  const androidStage = android.stages[index];
  if (iosStage.key !== stage.key || androidStage.key !== stage.key) {
    throw new Error(`stage ${index} is "${iosStage.key}"/"${androidStage.key}", expected "${stage.key}"`);
  }
  const hold = Math.max(iosStage.until - iosStage.at, androidStage.until - androidStage.at);

  const left = cut("ios", index, hold);
  const right = cut("android", index, hold);
  const out = `${WORK}/pair-${String(index).padStart(2, "0")}.mp4`;
  ff([
    "-i", left, "-i", right,
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]",
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);

  captions.push({ at: clock, text: stage.caption });
  clock += hold;
  segments.push(out);
  console.log(`stage ${stage.key.padEnd(9)} ${hold.toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
// The iOS "before", recovered and redacted.
//
// docs/media/app-shift.png was deleted at commit 33e66b2 ("redacted demo media") because
// every row in it is labelled with the operator's REAL CLIENT. The picture is still the
// only honest photograph of the iPhone app before the takeover shipped, so it is taken out
// of the object store and the four name rows are painted over with flat boxes.
//
// THE BOXES ARE THEN READ BACK. A mask that is trusted rather than checked is how a name
// ships: a box measured off a scaled preview lands a few pixels high and leaves the tops of
// the letters legible. Each region is decoded to grey and must be ONE value, or this
// throws and nothing is written.
// ---------------------------------------------------------------------------
const IOS_BEFORE_BLOB = "33e66b2:docs/media/app-shift.png";
const IOS_BEFORE_W = 384;
const IOS_BEFORE_H = 832;
// x,y,w,h in the original 384x832. Box 1 stops at x=250 so the "In progress" pill at
// x≈285 — the whole point of the picture — stays in frame.
const NAME_BOXES = [
  [20, 198, 230, 34],
  [20, 340, 230, 34],
  [20, 440, 230, 34],
  [20, 540, 230, 36],
];

function maskedIosBefore() {
  const src = `${WORK}/ios-before-raw.png`;
  const out = `${MEDIA}before-ios-shift.png`;
  writeFileSync(src, execFileSync("git", ["show", IOS_BEFORE_BLOB], { maxBuffer: 1 << 26 }));

  const boxes = NAME_BOXES.map(([x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x3A3A3A:t=fill`);
  ff(["-i", src, "-vf", boxes.join(","), "-frames:v", "1", out]);

  // Read the written file back, not the filter graph's promise about it.
  const grey = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", out, "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 26 },
  );
  if (grey.length !== IOS_BEFORE_W * IOS_BEFORE_H) {
    throw new Error(`${out} is ${grey.length} grey bytes, expected ${IOS_BEFORE_W * IOS_BEFORE_H}`);
  }
  for (const [x, y, w, h] of NAME_BOXES) {
    const first = grey[y * IOS_BEFORE_W + x];
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (grey[row * IOS_BEFORE_W + col] !== first) {
          throw new Error(`mask at ${x},${y} ${w}x${h} is not flat at ${col},${row} — a name may be showing`);
        }
      }
    }
  }
  console.log(`masked ${NAME_BOXES.length} client-name rows -> ${out}`);
  return out;
}

// ---------------------------------------------------------------------------
// A card: two stills in the same two panes as the journey, with a heading and a note.
// Every pixel above the text is a photograph of a build, never a drawing of one.
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/'/g, "\u2019").replace(/[\\:]/g, (c) => `\\${c}`);

function text(line, size, y, colour) {
  const fitted = fitFontSize(line, size, PANE_W * 2 - 24);
  return (
    `drawtext=fontfile=${FONT}:expansion=none:text='${esc(line)}':` +
    `fontcolor=${colour}:fontsize=${fitted}:x=(w-text_w)/2:y=${y}`
  );
}

function card(name, seconds, { left, right, heading, labels, lines }) {
  const out = `${WORK}/${name}.mp4`;
  const shot = (i) =>
    `[${i}:v]scale=-2:${PANE_H - 260},pad=${PANE_W}:${PANE_H}:(ow-iw)/2:70:black[p${i}]`;
  const captionsForCard = [
    text(heading, 26, 24, "yellow"),
    text(labels[0], 17, PANE_H - 172, "#B0B0B0").replace("x=(w-text_w)/2", `x=${PANE_W / 2}-text_w/2`),
    text(labels[1], 17, PANE_H - 172, "#B0B0B0").replace("x=(w-text_w)/2", `x=${PANE_W + PANE_W / 2}-text_w/2`),
    ...lines.map((line, i) => text(line, 19, PANE_H - 134 + i * 32, "white")),
  ].join(",");
  ff([
    "-loop", "1", "-t", String(seconds), "-i", left,
    "-loop", "1", "-t", String(seconds), "-i", right,
    "-filter_complex",
    `${shot(0)};${shot(1)};[p0][p1]hstack=inputs=2,fps=12,${captionsForCard}[v]`,
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  return out;
}

// "All four tabs still there" was the first draft of the second line and it was WRONG on
// the left-hand pane: the iPhone build of 30 July had three (Log, History, Settings) — the
// Material tab came later. Caught by looking at the rendered card, which is the only way it
// was ever going to be caught.
const before = card("card-before", 7, {
  left: maskedIosBefore(),
  right: `${MEDIA}before-android-shift.png`,
  heading: "BEFORE \u2014 a running shift was one row in a list",
  labels: ["iOS \u2014 30 July 2026", "Android \u2014 3 August 2026"],
  lines: [
    "One small pill, or the word \u201eL\u00e4uft\u201c, on one row of an ordinary list.",
    "Every tab stayed. Outside the app, nothing mentioned the shift at all.",
    "The iPhone still is a real capture; its client name is painted out.",
  ],
});

const after = card("card-after", 7, {
  left: `${MEDIA}ios-shift.png`,
  right: `${MEDIA}android-shift.png`,
  heading: "AFTER \u2014 the shift takes the app over",
  labels: ["iOS, today", "Android, today"],
  lines: [
    "Building named, state in words, and a clock that runs.",
    "Verlauf is gone from both. The pink is Material You, off the wallpaper.",
  ],
});

// ---------------------------------------------------------------------------
// Concatenate, then label the two panes and burn the shared captions in.
// ---------------------------------------------------------------------------
const list = `${WORK}/list.txt`;
writeFileSync(list, `${[before, after, ...segments].map((f) => `file '${f}'`).join("\n")}\n`);

const joined = `${WORK}/joined.mp4`;
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

// The two cards are not part of the journey, so every caption is pushed back by their
// combined length and the cards carry their own text. MEASURED off the encoded files
// rather than taken from the `-t` that was asked for: x264 rounds to whole frames, and a
// tenth of a second of drift here is a caption that starts before the pane it describes.
const seconds = (file) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
    ], { encoding: "utf8" }).trim(),
  );
const cardSeconds = seconds(before) + seconds(after);
const shifted = captions.map((c) => ({ ...c, at: c.at + cardSeconds }));
const total = cardSeconds + clock;

// Which pane is which, in the top bar under the DEMO banner, so no frame of the JOURNEY is
// ambiguous about which phone it is looking at.
//
// `enable` and not always-on: the two cards at the front are stills of OTHER builds on
// other hardware — the iPhone one came off a real handset, not this simulator — so a
// standing "iPhone 17 Simulator" label over them would have been false. The cards carry
// their own labels.
const label = (text, centre) =>
  `drawtext=fontfile=${FONT}:expansion=none:text='${text}':fontcolor=white:fontsize=16:` +
  `x=${centre}-text_w/2:y=42:enable='gte(t,${cardSeconds.toFixed(2)})'`;

const mp4 = `${MEDIA}both-devices.mp4`;
ff([
  "-i", joined,
  "-vf", [
    ...captionFilter(shifted, total, {
      width: PANE_W * 2,
      fontSize: 19,
      top: 64,
      bottom: 46,
      banner: "DEMO \u2014 local server, invented data, NFC MOCKED on both devices",
    }),
    label("iOS 26 \u2014 iPhone 17 Simulator", PANE_W / 2),
    label("Android 16 \u2014 Pixel 7 Emulator", PANE_W + PANE_W / 2),
  ].join(","),
  "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an",
  mp4,
]);
console.log(`wrote ${mp4} (${total.toFixed(1)}s, ${shifted.length} captions + before/after cards)`);
