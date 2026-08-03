// One screenshot writer, shared by the admin and the Android recorder.
//
// UI screenshots are flat colour and a truecolour PNG of one is mostly wasted bytes. A
// 128-colour palette is visually identical on this material — gradients are limited to the
// hatched "below target" fill — and roughly halves the file. This repo is public and
// already carries media; twelve screenshots at full size would add well over a megabyte.
//
// `dither=none` on purpose: dithering a screenshot puts noise into flat panels, which
// costs more bytes than the palette saves and makes text look grubby.
import { execFileSync } from "node:child_process";

export function writePng(from, to, { width } = {}) {
  const scale = width ? `scale=${width}:-2,` : "";
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", from,
    "-vf", `${scale}split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none`,
    to,
  ]);
}
