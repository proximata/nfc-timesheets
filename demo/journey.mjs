// The ONE worker journey, described once, so that the iPhone clip and the Android clip
// are the same story told twice and can be laid side by side without an edit that lies.
//
// Both recorders walk these stages in this order and give each stage AT LEAST its budget
// of seconds — never less, sometimes more when a device is slow. Each writes the
// boundaries it actually hit to `/tmp/ts-demo/<platform>-stages.json`, and
// demo/compose-devices.mjs aligns the two clips on those boundaries. Nothing is sped up:
// where one device finished a stage sooner, its LAST FRAME is held until the other
// catches up, which is visible as a still picture and is stated in backlog/docs/DEMO.md.
//
// The captions here are the ones the SIDE-BY-SIDE video carries, so they must be true of
// both platforms at once. Where the platforms genuinely differ — sign-in, and what each
// OS can show outside the app — the caption says so rather than papering over it, because
// that difference is the product decision (decision-26) and half the point of the clip.

/** @type {{key: string, seconds: number, caption: string}[]} */
export const STAGES = [
  {
    key: "launch",
    seconds: 12,
    caption: "First launch. Signed out, and nothing else on the screen.",
  },
  {
    key: "signin",
    seconds: 16,
    caption: "Sign in: Apple on iOS, an admin-issued code on Android (decision-26)",
  },
  {
    key: "tapin",
    seconds: 18,
    caption: "NFC TAP IS MOCKED - neither a simulator nor an emulator has an NFC radio",
  },
  {
    key: "takeover",
    seconds: 14,
    caption: "THE TAKEOVER: the whole app becomes one screen, and the clock runs",
  },
  {
    key: "locked",
    seconds: 12,
    caption: "Verlauf is gone until the shift ends. Material and Einstellungen never go.",
  },
  {
    key: "outside",
    seconds: 16,
    caption: "Outside the app: iOS gets an icon badge, Android a lock-screen clock",
  },
  {
    key: "tapout",
    seconds: 18,
    caption: "MOCKED TAP AGAIN - the same tag is the only way to end a shift",
  },
  {
    key: "cleared",
    seconds: 12,
    caption: "Closed and sent. Every indicator cleared, the tab bar whole again.",
  },
];

/**
 * Runs the stages, timing each one and padding it out to its budget.
 *
 * `say` is the per-platform caption recorder: the side-by-side video uses the shared
 * captions above, and each single-platform video uses the richer ones the driver adds.
 */
export async function runStages(handlers, { t0, say, sleep }) {
  const stages = [];
  for (const stage of STAGES) {
    const handler = handlers[stage.key];
    if (!handler) throw new Error(`no handler for stage "${stage.key}"`);
    const at = (Date.now() - t0) / 1000;
    await handler({ say, sleep });
    const spent = (Date.now() - t0) / 1000 - at;
    if (spent < stage.seconds) await sleep((stage.seconds - spent) * 1000);
    const until = (Date.now() - t0) / 1000;
    stages.push({ key: stage.key, at, until });
    console.log(`  stage ${stage.key.padEnd(9)} ${at.toFixed(1)}s -> ${until.toFixed(1)}s`);
  }
  return stages;
}
