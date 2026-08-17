# Design system — Schimmer und Glanz

Source of truth for the admin panel, the Android app and the landing page. Written 2026-08-12
from the real brand assets, not from taste.

---

## 1. What the brand actually is

Found, not assumed. The company is **Schimmer & Glanz Gebäudereinigung GmbH**, Vienna.

| | |
|---|---|
| website | https://www.schimmer-wien.at (WordPress + Astra + Spectra, live since 06/2025) |
| Facebook | https://www.facebook.com/Schimmerundglanz/ |
| directories | firmenabc.at `BBXLC`, herold.at `DFbhP` |
| positioning | „Gebäudereinigung und Spezialreinigung — Individuelle und Preiswerte Dienstleistungen mit **Handschlagqualität**" |
| status | **Meisterbetrieb** |
| named clients | Mobile Box, TOI TOI, SMC, **Rapid**, CHV Container, **EVN**, Retrosan, Auto Decker |

### The palette, measured from the official logo file

`schimmer-wien-logo.webp`, 500×208, decoded and counted pixel by pixel:

```
#000000    black
#ACACAC    mid grey      saturation 0.00
#FFFFFF    white
```

**THE BRAND IS ACHROMATIC.** Not "mostly neutral" — measured saturation is exactly zero across
every significant colour in the mark. The faint sage-green visible in the photograph of the
office sign was JPEG artefact under office lighting: twenty pixels, gone in the vector asset.

Two consequences, and they are the foundation of everything below:

1. A black-and-white system is not a stylistic preference to defend. It is the company's
   existing identity, and matching it is the cheap correct answer.
2. **There is no accent colour to inherit.** Every accent in this document is invented by us.
   That is a licence, but it is also a debt: an invented accent must earn its place by doing a
   job, never by decorating.

### What the website is NOT

The site's CSS palette is `#007cba` (WordPress admin blue), `#000`, `#fff` and Astra theme
defaults. There is no design system on the website to extract. It is a competent stock
WordPress build. So this document does not "follow the brand's web style" — there isn't one,
and copying stock theme defaults would be the exact "looks like a template" failure the owner
is trying to avoid.

### Two brands, two audiences — do not merge them

- **Schimmer und Glanz** is what the cleaning company's own customers see: the client portal,
  anything printed, the tags on the wall.
- **Proximata** is the maker's mark: it belongs on the product landing page and in the admin
  chrome, quietly.

The admin's user is the director of the cleaning company. He is not the audience for
Proximata's brand and he is not a customer of Schimmer und Glanz either — he *is* Schimmer und
Glanz. So the admin wears the company's identity, and Proximata signs it in the footer.

---

## 2. Aesthetic direction

**Flat. Dark by default. Achromatic base, one accent that changes character with the theme.**

Flat is the right call here for a reason beyond fashion: this interface is dense with numbers
and state. Shadows, gradients and glass all add visual noise per row, and this product's whole
problem is that it already feels heavy. Flat surfaces separated by *one* hairline and generous
space read faster than surfaces separated by depth.

Dark by default is defensible here and not merely trendy:
- the director uses this in buildings, in stairwells, in vans, at night after a shift
- the brand is black-first — the office sign is a black plate
- it differentiates immediately from every beige WordPress-era competitor in this trade

But dark mode is where amateur systems fall apart, so the rules below are strict.

---

## 3. Colour

### 3.1 Never pure black

```
--bg-base      #0B0C0E     not #000000
--bg-raised    #131519
--bg-overlay   #1B1E23
```

Pure black against bright content creates excessive contrast and eye strain, and — decisive
for a flat system — **you cannot see elevation on `#000`**. In dark mode a surface reads as
raised only when it is *lighter* than what is under it. Black is the floor with no basement,
so every card would need a border instead. Material's `#121212` exists for this reason; ours
is a touch cooler and darker to sit against the brand's black plate.

Light theme mirrors it and never uses pure white for large fields:

```
--bg-base      #FAFAFA
--bg-raised    #FFFFFF
--bg-overlay   #FFFFFF
```

### 3.2 Text is never pure white on dark

100% white on a dark surface at large sizes is glare. Step it down and let hierarchy come from
opacity, not from colour:

```
dark                          light
--text-primary    #E9EAEC     #16181C
--text-secondary  #A9ADB4     #4B5057     ← note: ~#ACACAC, the brand grey
--text-muted      #6C7178     #767C85
```

`--text-secondary` on dark is deliberately the brand's own `#ACACAC` nudged for contrast. The
one place the brand palette survives literally.

### 3.3 The accent: same hue, different character per theme

The owner's instinct was right and it has a principled basis. A single fixed accent cannot
work in both themes: a colour saturated enough to sing on dark is a glaring, low-contrast mess
on white, and a colour that reads correctly on white goes muddy and dead on dark.

So: **one hue, two treatments.** Not two different colours — the same hue, re-tuned. Express
in OKLCH, because it is perceptually uniform, so equal lightness steps *look* equal, which is
exactly what breaks when you tune HSL by hand.

```
hue = 190  (cyan-teal — "clean", water, not the medical blue every competitor uses)

dark theme   NEON       oklch(0.82 0.16 190)   ≈ #46E5E0    high chroma, high L
light theme  PASTEL     oklch(0.72 0.09 190)   ≈ #52BFC0    lower chroma, lower L
```

Why this direction and not the reverse: on a dark field the eye's sensitivity to saturation
drops, so chroma must go *up* to read as vivid. On white, the same chroma becomes shouting, so
it comes down and the colour reads as pastel. The hue never moves, so the product feels like
one product in both themes.

**Rules that make this safe rather than merely pretty:**

- the accent is for **one** thing per screen: the primary action, or the live state. Two
  accents on a screen means neither is an accent.
- **never put small text or an icon in the accent alone.** Neon cyan on `#0B0C0E` passes
  contrast for large text and misses for body. Accent carries emphasis; the text stays
  `--text-primary`.
- the accent is never the *only* signal for anything. See §4.
- no neon glow, no `box-shadow` bloom. That is a 2021 dribbble tic and it will date the
  product faster than anything else here. The accent is flat.

### 3.4 The five domain states — the part that actually matters

This product's states carry money and consequence. They already exist in the code and they
must survive a monochrome system:

| state | dark | light | shape signal |
|---|---|---|---|
| running / open | accent | accent | live dot, animated only if motion is allowed |
| auto-closed, unresolved | `oklch(0.78 0.14 75)` amber | `oklch(0.70 0.10 75)` | left rule, 3px |
| corrected by a human | `oklch(0.72 0.13 300)` violet | `oklch(0.64 0.09 300)` | left rule, 3px |
| inactive / deactivated | `--text-muted` | `--text-muted` | reduced opacity + strikethrough on the name only |
| excluded from payroll | `--text-muted` | `--text-muted` | hatched left rule + explicit words |

**COLOUR IS ALWAYS THE SECOND SIGNAL.** In an achromatic system the first signal must be
stronger than usual: weight, a left rule, position, or the word itself. Every one of these
states must be identifiable in a greyscale screenshot. That is the test — take the screenshot,
desaturate it, and see whether you can still read the table. If you cannot, the design is
wrong, not the reviewer.

### 3.5 Contrast is measured, never eyeballed

A monochrome palette makes it very easy to ship elegant grey-on-grey that a director cannot
read on a phone in a stairwell in daylight.

```
body text            ≥ 4.5:1     non-negotiable
large text / UI      ≥ 3:1
disabled             ≥ 3:1       — "disabled" is not "invisible"
focus ring           ≥ 3:1 against BOTH the control and its background
```

Ship a check that computes these from the token file, so a token change that breaks contrast
fails a build rather than a user.

---

## 4. Typography

The brand wordmark is an upright condensed sans, wide-tracked, on a circular path. That is a
*display* treatment and it does not belong in a data table.

```
UI + body     Inter          system fallback stack, no webfont for the admin
numbers       Inter, font-variant-numeric: tabular-nums
display       the wordmark's own treatment, landing page only
```

**`tabular-nums` on every number, without exception.** This product shows euros and hours in
columns. Proportional digits make a column of money ragged and, worse, make the same figure
change width between states — which reads as the number changing when it has not.

```
scale (rem)   0.75  0.875  1  1.125  1.375  1.75  2.25
weights       400 body · 500 UI labels · 600 headings · no 700 in the admin
line-height   1.5 body · 1.25 headings · 1.2 numeric cells
```

German compounds are long: `Materialanforderungen`, `Objektauswertung`,
`Gebäudereinigung`. Every component must be tested at German string lengths, and
`overflow-wrap: anywhere` belongs on any cell that can receive a compound noun. A layout that
only holds in English is broken, because German is the default locale.

---

## 5. Space, shape, density

```
spacing     4 · 8 · 12 · 16 · 24 · 32 · 48 · 64      (4px base)
radius      0 flush · 6 controls · 10 cards · 999 pills
border      1px  --border  = rgba(255,255,255,0.08) dark / rgba(0,0,0,0.10) light
            1px  --border-strong for a real division
```

Flat means the hairline does the work that a shadow would. One hairline, never two adjacent —
two stacked cards each with a border produce the doubled 2px line that makes an interface look
homemade.

**On the two white containers that started this.** The fix is not a new colour. Most of these
screens want **one** surface, with hierarchy from type and space, not two nested boxes. A card
inside a card is almost always a missing heading.

---

## 6. Motion

Baseline tier only. Motion here is for continuity and feedback — never delight.

```
instant    0ms      state that must feel direct: checkbox, tab
fast       120ms    hover, focus, small colour change
base       200ms    disclosure open/close, card enter
slow       320ms    a panel sliding in, once per interaction
easing     cubic-bezier(0.2, 0, 0, 1)
```

**Never animates:** a number changing, a table re-sorting, anything on load, anything that
would delay the first paint of data. A figure that animates while a director reads it is a
figure he will re-read.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important;
                           transition-duration: 0.01ms !important; }
}
```

The live-shift pulse is the one animation with a job — it says "this is happening now" — and
it is the first thing to disappear under reduced motion, replaced by a static filled dot.

---

## 7. Theming mechanics

```css
:root                     { /* light tokens */ }
@media (prefers-color-scheme: dark) { :root { /* dark tokens */ } }
[data-theme="dark"]       { /* dark tokens */ }
[data-theme="light"]      { /* light tokens */ }
```

Dark is the *default* by brand decision, but the OS preference wins unless the user chose
explicitly — so the control has **three** states: `System / Dunkel / Hell`, never two. A
two-state toggle silently lies to the person who has never touched it.

No new dependency. These are CSS custom properties in `web/app/globals.css`, and Android takes
the same values into `ui/Theme.kt`. **State where the shared source of truth lives** before
writing either — two hand-maintained lists will drift, and the drift will show up as an app
that does not look like its own admin.

---

## 8. What is deliberately NOT in this system

- no shadows beyond a single overlay scrim
- no gradients
- no glassmorphism / backdrop blur
- no icon set decision yet — inherit the existing one until a real gap appears
- no component library, no Tailwind. Hand-written CSS custom properties, per the standing
  dependency budget.
- no second accent hue. When one is genuinely needed, it will be for a real semantic job and
  it will be argued in a decision record.

---

## 9. Open, and blocking

1. **Vector artwork.** Everything above is measured from a 500×208 raster. Ask for the
   original AI/SVG before anything is printed or rendered large.
2. **`GEBÄUDE · DENKMAL · FASSADE`.** Monument and façade work. The app models neither. Do not
   let the design quietly sell a narrower business than the company runs.
3. **Is Proximata visible or invisible to this customer?** Decides whether the maker's mark
   appears in the admin chrome or only on the landing page.
