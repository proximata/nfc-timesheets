# BLOCKER: AASA host conflict — decision-15 vs research plan

Status: **unresolved, blocks TASK-4, TASK-5, TASK-6, TASK-8.**
Found: 2026-07-28, while restructuring the backlog after `research/decision-brief.md`.

## The conflict

`research/decision-brief.md` recommends: **Cloudflare Worker serves AASA + `assetlinks.json`
+ `/t`**, VM retired entirely.

That recommendation silently assumed a **company-owned domain** (the brief's §1 said "on a
company-owned domain"). decision-15 then chose to stay on `timesheets.exe.xyz` for MVP.

Those two cannot both hold:

- A Cloudflare Worker can only serve a hostname whose **zone is in your Cloudflare account**.
- `exe.xyz` is exe.dev's domain, not ours. We cannot add it as a CF zone.
- AASA must be served from the **exact host in the tag URI**, and **redirects are not
  followed** (Apple + Google both).

Therefore: **if tags point at `timesheets.exe.xyz`, Cloudflare cannot serve AASA, and the
exe.dev VM must stay alive to serve it.** The VM cannot be fully retired.

## Options

**A. Keep a minimal VM for AASA + `/t` only.** API → Supabase, admin → Cloudflare Pages,
cron → `pg_cron`. VM shrinks from full API host to a ~20-line static file server.
- Consistent with decision-15. No new hostname. TASK-4 barely changes (it already said
  "serve AASA from exe.xyz server") — **decision-4 turns out to have been right**.
- Failure mode is milder than it looks: iOS caches AASA at install time, so downtime breaks
  *new* installs, not existing ones. `/t` is only hit when the app is **not** installed.
- Cost: the VM stays a moving part.

**B. Point tags at a `*.workers.dev` subdomain** (e.g. `nfc-ts.<account>.workers.dev`).
Root-path control, correct MIME, free, VM fully retired. Hostname is controlled by our CF
account rather than exe.dev — same *class* of third-party dependency, different vendor.
- Cost: ugly hostname visible to workers/clients on tap.

**C. Buy `app.<company>.at`** (~EUR 10/yr), CNAME to CF or exe.dev. Clean, permanent, removes
the decision-15 revisit trigger entirely.

## Recommendation

**A for MVP.** It matches decision-15, requires no new hostname decision, and keeps TASK-4
close to its original shape. The VM survives as a static file server, which is a much
smaller thing to keep alive than a full API host.

Revisit at the decision-15 trigger (first paying client). At that point C collapses A and the
decision-15 risk into one EUR 10 purchase.

## Consequence for the backlog

Under option A, the restructure is:

| Task | Fate under A |
|---|---|
| TASK-1 provision VM+Postgres | rewrite → "Create Supabase project (eu-central-1), enable pg_cron" |
| TASK-2 DB schema | keep; delivery via `supabase/migrations/` |
| TASK-3 server rewrite | rewrite → Hono Edge Function on Deno (Supabase) |
| TASK-4 serve AASA | **mostly unchanged** — stays on exe.dev VM; ADD `assetlinks.json` |
| TASK-5 DNS cutover | rewrite → "shrink VM to AASA/`/t` static server, decommission API+JSON store" |
| TASK-11 8h cron | rewrite → pure-SQL `pg_cron`, effort drops |
| TASK-14 Next.js setup | retarget Vercel → Cloudflare Pages (decision-14) |

Decision records: decision-4 **survives** (was correct). decision-11 **superseded** by
decision-14. decision-12 accept-with-amendment (hybrid, VM not fully retired).
