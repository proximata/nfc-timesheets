---
id: decision-3
title: Next.js App Router + pnpm + Biome (not ESLint+Prettier)
date: '2026-07-28 13:51'
status: accepted
---
## Context

Web admin panel needs a framework. Owner wants something modern, agent-friendly, with good ecosystem. Prefers single-tool linting over ESLint+Prettier combo.

## Decision

- Next.js with App Router (latest stable minus one minor — no bleeding edge)
- pnpm (not npm)
- Biome for lint + format (replaces ESLint + Prettier in one tool)
- All dependency versions pinned exact (no ^ or ~ ranges)
- `.npmrc` with `save-exact=true`

## Consequences

- Biome has ESLint rule equivalents — conversion straightforward
- Pinned versions mean manual updates but no surprise breaks
- pnpm strict node_modules prevents phantom dependencies
