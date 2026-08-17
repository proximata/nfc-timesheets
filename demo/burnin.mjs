// Burning captions into frames, in the one place all four recorders can share it.
//
// Captions are burned in rather than written in a README because a video travels away
// from the text that came with it, and the one sentence that must never travel alone is
// "this tap did not happen".
//
// THREE THINGS HERE ARE SCAR TISSUE, all found by looking at rendered frames:
//
//   1. `expansion=none`. drawtext's default expands `%` and `{}` as format specifiers, so
//      a caption reading "12% target" is dropped whole with a `Stray %` warning on stderr
//      and ffmpeg still exits 0. Turning expansion off makes the text a string again.
//   2. The captions sit in a PADDED BAR, not on top of the picture. An overlaid band
//      covers whatever is behind it, and on a scrolling admin panel that is a table row.
//      Padding costs 84 pixels of height and can never hide anything.
//   3. A caption wider than the frame IS SILENTLY CLIPPED AT BOTH ENDS. `x=(w-text_w)/2`
//      goes negative, ffmpeg exits 0, and the iOS clip shipped a first cut reading
//      "...expiry and nonce for rea". So the width is MEASURED and the size brought down
//      until it fits — see fitFontSize.
//   4. The caption window is HALF-OPEN, `[at, until)`. ffmpeg's `between(t,a,b)` is
//      inclusive at BOTH ends, and one caption's `until` IS the next one's `at`, so a
//      frame landing exactly on a boundary satisfied both and drew both strings on top of
//      each other. It shipped: admin-walkthrough at t=103.0s and both-devices at
//      t=26.083s were each one frame of illegible overprint. Only frames whose time hits
//      the boundary exactly are affected, which is why it survived review - it is a
//      single frame, invisible at speed and obvious when tiled. demo/check-captions.mjs
//      is the regression test.
//
// An apostrophe cannot be escaped inside a single-quoted `text=` at all — `\'` closes the
// string and the rest of the caption is parsed as a filter name — so it is replaced with
// the typographic one and the result is asserted.
import { execFileSync } from "node:child_process";

const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";

const esc = (s) => {
  const out = s.replace(/'/g, "\u2019").replace(/[\\:]/g, (c) => `\\${c}`);
  if (out.includes("'")) throw new Error(`caption still carries a raw apostrophe: ${s}`);
  return out;
};

/**
 * Ink width of `text` in pixels, at `fontSize`, MEASURED.
 *
 * drawtext reports nothing back, so the alternative is an average-character-width guess,
 * and a guess is what clipped the tail off a caption in the first cut. This renders the
 * line white-on-black onto a canvas far wider than any caption and scans the raw grey
 * plane for the last lit column. One ffmpeg per line, tens of milliseconds, no dependency.
 */
export function textWidth(text, fontSize) {
  const w = 4000;
  const h = Math.ceil(fontSize * 3);
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v", "error", "-f", "lavfi", "-i", `color=black:s=${w}x${h}`,
      "-vf",
      `drawtext=fontfile=${FONT}:expansion=none:text='${esc(text)}':` +
        `fontcolor=white:fontsize=${fontSize}:x=0:y=${Math.round(fontSize / 2)}`,
      "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  let last = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = w - 1; x > last; x--) {
      if (raw[row + x] > 16) {
        last = x;
        break;
      }
    }
  }
  return last + 1;
}

/**
 * The largest size at or below `nominal` at which `text` fits inside `maxWidth`.
 *
 * Ink width is very nearly linear in font size, so one measurement picks the candidate and
 * a second confirms it; the loop is there for the rounding, and it throws rather than
 * shipping a clipped line if even the floor is too wide.
 */
export function fitFontSize(text, nominal, maxWidth, { floor = 9 } = {}) {
  const at = textWidth(text, nominal);
  if (at <= maxWidth) return nominal;
  let size = Math.max(floor, Math.floor((nominal * maxWidth) / at));
  while (size > floor && textWidth(text, size) > maxWidth) size -= 1;
  if (textWidth(text, size) > maxWidth) {
    throw new Error(`caption does not fit in ${maxWidth}px even at ${floor}pt: ${text}`);
  }
  return size;
}

/**
 * Just the caption `drawtext`s — one per caption, in the bottom band, half-open in time.
 *
 * Split out of captionFilter so a recorder that builds its OWN frame (its own scale, its
 * own padding, its own title bar) can still get the caption track without inheriting a
 * banner it does not want. captionFilter below is unchanged and still calls this, so the
 * half-open rule — note 4 above, the one that shipped two frames of overprint — has
 * exactly one implementation and demo/check-captions.mjs still covers it.
 *
 * @param captions [{at, text, until?}] in seconds, in order. Each runs until the next one
 *   starts, or until its own `until` when it carries one — which a film cut from SEVERAL
 *   recordings needs, because there the last caption of one segment would otherwise run on
 *   over the opening seconds of the next one and narrate the wrong screen. Seen in
 *   docs/media/redesign-demo: „die Zwischenablage enthält genau diese URL“ was still on
 *   screen two and a half seconds into the phone segment.
 * @param total    length of the recording in seconds, for the last caption's end.
 */
export function captionDrawtexts(captions, total, { width, fontSize = 20, bottom = 50 }) {
  // 8 px of air at each end, so a line that only just fits still looks deliberate.
  const fits = width - 16;
  return captions.map(({ at, text, until: cap }, i) => {
    const until = Math.min(cap ?? Number.POSITIVE_INFINITY, captions[i + 1]?.at ?? total);
    const size = fitFontSize(text, fontSize, fits);
    if (size < fontSize) console.log(`  caption shrunk ${fontSize}->${size}pt to fit: ${text}`);
    // Half-open: `gte(t,at) * lt(t,until)`, never `between`, which includes both ends and
    // therefore double-draws the frame that lands on a boundary (note 4 above). The last
    // caption has no successor to collide with and simply runs to the end of the clip.
    const isLast = i === captions.length - 1 && cap === undefined;
    const enable = isLast
      ? `gte(t,${at.toFixed(3)})`
      : `gte(t,${at.toFixed(3)})*lt(t,${until.toFixed(3)})`;
    return [
      `drawtext=fontfile=${FONT}:expansion=none:`,
      `text='${esc(text)}':`,
      `fontcolor=white:fontsize=${size}:`,
      `x=(w-text_w)/2:y=h-${Math.round(bottom / 2 + fontSize / 2)}:`,
      `enable='${enable}'`,
    ].join("");
  });
}

/**
 * The video filter chain: scale, fps, black bars top and bottom, the standing DEMO
 * banner in the top bar, and one `drawtext` per caption in the bottom bar.
 *
 * @param captions [{at, text}] in seconds, in order. Each runs until the next one starts.
 * @param total    length of the recording in seconds, for the last caption's end.
 */
export function captionFilter(captions, total, { width, fps = 12, fontSize = 20, banner, top = 34, bottom = 50 }) {
  // 8 px of air at each end, so a line that only just fits still looks deliberate.
  const fits = width - 16;

  const drawn = captionDrawtexts(captions, total, { width, fontSize, bottom });

  const bannerSize = fitFontSize(banner, Math.round(fontSize * 0.85), fits);

  return [
    `scale=${width}:-2`,
    `fps=${fps}`,
    `pad=iw:ih+${top + bottom}:0:${top}:black`,
    `drawtext=fontfile=${FONT}:expansion=none:text='${esc(banner)}':` +
      `fontcolor=white:fontsize=${bannerSize}:x=(w-text_w)/2:` +
      `y=${Math.round(top / 2 - fontSize * 0.45)}`,
    ...drawn,
  ];
}
