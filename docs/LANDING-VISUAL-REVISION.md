# Landing visual revision — 23 September 2026

Branch: `codex/tasks-351-358`, isolated checkout `.worktrees/351-358`.

## Intent and references

Owner requested recognisable Microsoft Teams and other integration images near the top, larger controls/type, better language switching, coherent icons, and a continuously looping cleaner illustration.

Visual references inspected: [Harvest integrations](https://www.getharvest.com/integrations) and [Connecteam integrations](https://connecteam.com/integrations/). Borrowed the readable logo-card hierarchy and clear CTA treatment, not their page content. Local logo provenance is in `web/public/integrations/SOURCES.md`.

## Implementation

- Four cards directly after the hero: Microsoft Teams, Microsoft 365, Outlook, Google Calendar. Planned/Coming soon is explicit in DE and EN. These remain placeholders.
- Segmented DE/EN control, outlined sign-in, prominent Book a call, larger body type and buttons. Language buttons meet the 44px target.
- Building, NFC tap and report use one SVG icon style.
- 3.2-second looping illustration. The left arm, hand and phone share one SVG transform pivoted at the shoulder. No independent phone translation. User-controlled pause and reduced-motion support cover all animated parts.
- Public landing colours explicitly style the Microsoft placeholder, avoiding inherited admin-theme contrast problems.

## Verification

`pnpm verify`: checks, DE/EN parity, Biome, TypeScript and static build passed. `node ops/check-branding.mjs`: passed, no TODO lines. Dedicated review read all 65 ADRs and found no remaining blockers after the 44px fix.

Browser verification is documented in the task completion notes. No booking, Microsoft authentication or calendar integration was activated. No server/database changes, deployment or push.
