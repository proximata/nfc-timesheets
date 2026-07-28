---
id: decision-2
title: Postgres replaces JSON file store
date: '2026-07-28 13:51'
status: accepted
---
## Context

Current server writes to `data.json` via `fs.writeFileSync`. Not concurrency-safe, no query capability, loses data on crash during write. Pilot with real workers requires durability.

## Decision

Install Postgres 16 on the exe.dev VM. Use `pg` (node-postgres) with connection pool. Existing test data is throwaway — no migration needed, fresh schema.

## Consequences

- ACID guarantees, FK constraints, proper indexes
- Need schema migrations strategy for future changes (plain SQL files for now)
- ~100MB RAM overhead for Postgres on 8GB VM — negligible
