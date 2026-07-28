# NFC TimeSheets — demo video script

**Format:** vertical 1080×1920, 30 fps, ~60 s. Dark theme (`#0a0e14`) matching the app.

## Global layout (every segment)

```
┌───────────────────────────┐  1080 wide
│  ● ● ● ●   progress dots   │  top, y≈50
│                           │
│   [ STEP N · ROLE ]  pill │  banner, y≈120
│   Big title               │  y≈180
│                           │
│   ┌───────────────────┐   │
│   │                   │   │
│   │   phone / term    │   │  centered card,
│   │   recording       │   │  rounded 40px, subtle border
│   │                   │   │
│   └───────────────────┘   │
│                           │
│   caption band (fades)    │  lower third, y≈1700
└───────────────────────────┘  1920 tall
```

- **Progress dots** (4) top-center; the active step's dot is enlarged/bright.
- **Banner pill**: role-tinted (ADMIN = amber, WORKER = blue, PROOF = green).
- **Card**: phone clips scaled to ~1180 tall (device look); terminal scaled to ~980 wide.
- **Caption band**: 1–3 timed captions per segment, cross-fading, bottom-anchored.

## Segments

| # | Source | Dur | Speed | Banner | Title | Captions (timed) |
|---|--------|-----|-------|--------|-------|------------------|
| 0 | title card | 2.0s | — | — | **NFC TimeSheets** | "Tap a tag. Log the shift. Done." |
| 1 | IMG_8562 | ~15s | 1.5× | STEP 1 · ADMIN (amber) | Register a worker | ① "Unlock the admin panel with a PIN" → ② "Add the worker — here, 'myself'" |
| 2 | IMG_8563 | ~13s | 1.5× | STEP 2 · ADMIN (amber) | Register a location | ① "Scan the NFC tag to capture its ID" → ② "Name it 'Hoiv 4' — only registered tags count" |
| 3 | IMG_8564 | ~20s | 1.5× | STEP 3 · WORKER (blue) | Punch in, punch out | ① "Pick your name, tap the tag to start" → ② "Tap again to finish" → ③ "History: Hoiv 4 · Synced ✓" |
| 4 | term.mp4 | ~14s | 1.0× | STEP 4 · PROOF (green) | It's on the server | ① "curl the live API…" → ② "'myself' @ 'Hoiv 4' — confirmed server-side" |
| 5 | outro | 2.5s | — | — | **Server-verified timesheets** | "One tap in. One tap out." |

Each segment fades in over ~0.4 s. Phone clips are wrapped in a rounded device card; the
terminal clip in a rounded window card. Captions cross-fade at the timed switch points.
