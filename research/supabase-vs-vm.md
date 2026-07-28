# Research: Supabase vs exe.dev VM for API + DB

Input to `decision-12`. Sources dated 2026 unless noted. All URLs cited inline.

**Verdict up front: HYBRID.** Supabase for Postgres + cron + (optionally) API. Supabase
**cannot** serve `/.well-known/apple-app-site-association` or `/t` — hard blocker, no
workaround on the Supabase domain. Those move to a separate edge host on a
**company-owned domain**, decided *before* NFC tags get written.

---

## 1. Feature-by-feature mapping

Supabase URL namespace is fixed: `/rest/v1/*`, `/auth/v1/*`, `/functions/v1/*`,
`/storage/v1/*`. Edge Function paths "must be prefixed by function name"
([routing docs](https://supabase.com/docs/guides/functions/routing)). Custom domains only
rebrand the host — "your Edge Functions will now be available at
`https://api.example.com/functions/v1/your_function_name`"
([custom domains](https://supabase.com/docs/guides/platform/custom-domains)). **No root-path
control, ever.**

| # | Feature | Supabase approach | Works? | Notes |
|---|---|---|---|---|
| 1 | `GET /roster` | Single Edge Function `api` w/ Hono router → `/functions/v1/api/roster` | ✅ | Or PostgREST `GET /rest/v1/workers?select=*`. Edge Fn preferred (keeps custom header auth). |
| 2 | `POST /shifts` | Same Edge Fn, insert via service-role client | ✅ | Payload is a few hundred bytes. No limit pressure. |
| 3 | `GET /shifts/unresolved` | Same Edge Fn → SQL view `shifts_unresolved` | ✅ | Put the filter in a Postgres view; function stays thin. |
| 4 | `GET /admin/data` | Same Edge Fn → Postgres function `admin_snapshot()` returning JSON | ✅ | Aggregation in SQL, not JS — dodges the 2 s CPU cap entirely. |
| 5 | `POST/DELETE /admin/workers` | Same Edge Fn | ✅ | — |
| 6 | `POST/DELETE /admin/locations` | Same Edge Fn | ✅ | — |
| 7 | `X-App-Key` / `X-Admin-Pin` auth | `verify_jwt = false` + `auth: 'none'`, compare headers in handler | ✅ | Explicitly supported: *"For a genuinely public function… use `auth: 'none'` with `verify_jwt = false`"* and the Stripe-webhook pattern (verify your own shared secret in-handler). [functions/auth](https://supabase.com/docs/guides/functions/auth) |
| 8 | 15-min cron, auto-close >8 h shifts | `pg_cron`, pure SQL `UPDATE` — **no** Edge Function call | ✅ | `cron.schedule('close-stale','*/15 * * * *', $$ update … $$)`. Runs in-DB, zero network, zero invocations. |
| 9 | `/.well-known/apple-app-site-association` | — | ❌ **BLOCKED** | Path is not addressable. Storage public objects live at `/storage/v1/object/public/…`. Custom domain does not remap root. |
| 10 | `/t` landing page (NFC target) | — | ❌ **BLOCKED** | Same path problem, *plus*: *"Serving of HTML content is only supported with custom domains (otherwise `GET` requests that return `text/html` will be rewritten to `text/plain`)"* — [limits](https://supabase.com/docs/guides/functions/limits). Custom domain = paid add-on, and still `/functions/v1/t`. |
| 11 | Hourly rates + payroll aggregation | Postgres views / functions; `numeric` money columns | ✅ | Strongest argument *for* real Postgres over D1/SQLite. |
| 12 | 3B: P&L, contracts, pro-rata material costs (decision-6) | SQL CTEs / materialized views | ✅ | Pro-rata by labor hours is a window-function query. Native fit. |

**Score: 10/12 native, 2/12 hard-blocked.** Both blockers are on the *public web surface*,
not the API. That's what forces the hybrid.

### Why #9 and #10 cannot be fudged
- The NFC tag URI, the AASA host, and the universal-link host must be **the same origin**.
  Apple fetches `https://<host>/.well-known/apple-app-site-association` for the host in the
  `applinks:` entitlement.
- Supabase gives you no route at `/` on any host it terminates TLS for.
- Therefore the NFC/universal-link origin is *never* a Supabase origin. Something else
  must own that hostname.

---

## 2. Free tier limits vs pilot need (20 workers, 20 buildings)

Pilot load estimate: 20 workers × ~4 taps/day × 22 workdays ≈ **1,800 API calls/month**,
plus admin panel polling ≈ a few thousand. Shift rows: 20 × 22 × 12 ≈ **5,300 rows/year**
(~1 MB with indexes).

| Limit | Free plan | Pilot need | Headroom |
|---|---|---|---|
| API requests | Unlimited | ~5k/mo | ✅ ∞ |
| Edge Function invocations | 500,000/mo | ~5k/mo | ✅ 100× |
| Database size | **500 MB** | ~5 MB/yr | ✅ ~100 yr |
| Egress | 5 GB/mo | <100 MB | ✅ |
| Cached egress | 5 GB/mo | ~0 | ✅ |
| File storage | 1 GB | 0 (no uploads in 3A) | ✅ |
| MAUs (Supabase Auth) | 50,000 | 0 (custom header auth) | ✅ |
| Compute | Shared CPU, **500 MB RAM** | trivial | ✅ |
| **Automatic backups** | **NOT INCLUDED** | payroll data — required | ❌ |
| **Pausing** | **after 1 week of inactivity** | — | ⚠️ |
| **Uptime SLA** | **NOT INCLUDED** | "cannot take down the API" | ❌ |
| Custom domains | **NOT INCLUDED** (paid add-on) | needed if Supabase fronts anything public | ❌ |
| Active projects | 2 per org | 1–2 (prod + staging) | ⚠️ tight |

Sources: [pricing](https://supabase.com/pricing),
[functions/limits](https://supabase.com/docs/guides/functions/limits),
[backups](https://supabase.com/docs/guides/platform/backups).

**Verdict: free tier is technically sufficient for pilot traffic and storage, and
insufficient for pilot *risk*.** Backups are the deal-breaker, not capacity. Supabase's own
docs: *"We recommend that free tier plan projects regularly export their data using the
Supabase CLI `db dump` command and maintain off-site backups."*

**What triggers paid ($25/mo Pro):** wanting daily backups, wanting no pausing, wanting a
custom domain (+$10/mo add-on), or >2 projects. None of these are traffic-driven. For a
company payroll system, Pro is the honest baseline.

### Pausing, precisely
> "Supabase pauses Free Plan projects that show low activity over a 7-day period… Typically
> a few user requests to the database each day over the previous week is enough to keep the
> project from being paused."
> — [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

A live cleaning crew tapping tags daily clears this easily. **But**: holidays, August
shutdown, or a stalled pilot triggers a pause; restore is manual dashboard click, 30 s–3 min
([SimpleBackups writeup](https://simplebackups.com/blog/supabase-free-tier-paused)). Also
unclear whether `pg_cron` internal activity counts as "user database activity" — the docs say
*user* requests. Do not rely on the cron job to keep it alive.

---

## 3. Edge Function limits — do any break a feature?

From [functions/limits](https://supabase.com/docs/guides/functions/limits):

| Limit | Value (Free) | Impact here |
|---|---|---|
| Memory | 256 MB | none |
| Wall clock | 150 s (400 s paid) | none |
| **CPU time** | **2 s per request** | none *if* aggregation stays in SQL. Doing payroll math in JS over years of rows would eventually bite. Keep it in Postgres. |
| Request idle timeout | 150 s → 504 | none |
| Function bundle | 20 MB (CLI) | none |
| Functions per project | 100 (Free) | none — we want **one** |
| Ports 25/587 blocked | — | no SMTP from Edge Fns. Irrelevant now, relevant if 3B sends payroll emails → use Resend HTTP API. |
| `text/html` rewritten to `text/plain` without custom domain | — | kills `/t` (feature 10) |
| No Web Worker / `vm` API, no multithreaded native libs (sharp, libvips) | — | irrelevant now; blocks server-side image/PDF work in 3B |

**Cold start:** ~200–350 ms observed
([r/Supabase](https://www.reddit.com/r/Supabase/comments/1c1bmek/edge_function_slow_execution_time/)),
improved by "2× smaller, 3× faster boot" (Sep 2024) and "up to 97% faster cold starts"
(Jul 2025) — [blog](https://supabase.com/blog/persistent-storage-for-faster-edge-functions).
Tail latency complaints of 5000 ms+ exist
([discussion #29301](https://github.com/orgs/supabase/discussions/29301)).

For NFC clock-in this is **fine**: the write is fire-and-forget from the app, not a blocking
UX step. Mitigation is already the recommended pattern — **one** Edge Function with an
internal router, so it stays warm across all endpoints
([routing](https://supabase.com/docs/guides/functions/routing)).

---

## 4. Cron detail

- `pg_cron` is available on the hosted platform including free
  ([schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions)).
- Granularity: *"anywhere from every second to once a year"* — `*/15 * * * *` is trivially
  supported ([cron overview](https://supabase.com/docs/guides/cron)).
- Guidance: ≤8 concurrent jobs, each ≤10 min. We need 1 job running for milliseconds.
- Job history in `cron.job_run_details` — free observability the VM's `setsid` loop doesn't have.
- **Do NOT use `pg_net` → Edge Function for this.** Pure SQL `UPDATE … WHERE end IS NULL AND
  start < now() - interval '8 hours'` sets `needs_correction = true` in-database. No HTTP, no
  invocation cost, no cold start, no Vault secret to rotate. `ponytail:` if 3B needs a push
  notification on auto-close, *then* add `pg_net` → Edge Fn; upgrade path is one line.

This is strictly better than the VM plan (a Node `setInterval` that dies with the process).

---

## 5. Region / latency

[regions](https://supabase.com/docs/guides/platform/regions) — `eu-central-1` (Frankfurt) is
available as a specific region, and is the default for the `Central EU` general region.
Edge Functions also support `x-region: eu-central-1` pinning
([regional-invocation](https://supabase.com/docs/guides/functions/regional-invocation)).

Vienna → Frankfurt ≈ 600 km. Expected RTT **12–25 ms** on consumer mobile. Irrelevant against
a 200–350 ms cold start and irrelevant for a clock-in action. Also EU-resident → GDPR posture
is simpler than us-east-1. Zurich (`eu-central-2`) is geographically closer but has no
practical latency advantage and thinner feature coverage.

---

## 6. Auth: custom headers

Clean. Config:

```toml
# supabase/config.toml
[functions.api]
verify_jwt = false
```

Handler compares `X-App-Key` / `X-Admin-Pin` itself. Supabase Auth / JWT is **not** forced;
docs describe exactly this for third-party webhooks that "don't send Supabase credentials"
([functions/auth](https://supabase.com/docs/guides/functions/auth)).

Gotchas:
- Use **constant-time** comparison for the PIN. A 6-digit PIN over a public endpoint is
  weak regardless — add per-IP rate limiting (or move admin auth to real Supabase Auth in 3B).
  Current `server.js` uses `!==`, same weakness; not a regression, but flag it.
- With `verify_jwt = false` the function is fully public. Header check is the *only* gate.
- Anything you expose via PostgREST (`/rest/v1`) is gated by the anon key + RLS, a *different*
  auth model. Keep 3A entirely on the Edge Function; do not mix.

---

## 7. Reliability: Supabase free vs single exe.dev VM

| | Supabase Free | Supabase Pro ($25) | exe.dev VM |
|---|---|---|---|
| Uptime SLA | none ("Uptime SLAs: not included in free") | none (SLA is Team/Enterprise) | none |
| Actual availability | multi-AZ managed AWS, public [status page](https://status.supabase.com/) | same | one box, one disk |
| Auto pause | **yes, 7 d inactivity** | no | no |
| Backups | **none** | daily, 7-day retention | whatever you script |
| PITR | no | paid add-on | no |
| Patching / OS ops | Supabase | Supabase | you |
| Blast radius of your own bug | function redeploy | function redeploy | can brick the box |
| Recovery when it breaks | ticket + community | ticket + community | you have SSH — *faster* |

Neither option has a contractual SLA. Supabase wins on **backups, patching, and
"can't-be-nuked-by-a-bad-deploy"**; the VM wins on **you can always SSH in and fix it**.
For a payroll system where losing shift data means not paying people correctly, backups
dominate. That argues Supabase **Pro**, not Supabase Free.

---

## 8. The AASA / NFC-domain problem — the real decision

The NFC tags are physical objects glued to buildings across Vienna. **The hostname baked
into them is effectively permanent** (decision-5 puts the location ID in the NDEF URI, so
re-writing tags means visiting every building). Current plan bakes in `timesheets.exe.xyz`
(decision-4) — an exe.dev sandbox subdomain the company does not own.

**This is the highest-leverage finding in this doc, and it is independent of Supabase.**

> Buy a company-owned domain (e.g. `nfc.<company>.at`) and point the tags at that, before
> writing a single tag.

Then that hostname must serve, on the same origin:
1. `/.well-known/apple-app-site-association`, `Content-Type: application/json`
2. `/t?l=<ID>` landing page

Options for owning that origin:

| Host | AASA w/ correct Content-Type | `/t` HTML | Cost | Commercial use OK? |
|---|---|---|---|---|
| **Cloudflare Workers (static assets)** | ✅ full header control | ✅ | free (100k req/day) | ✅ yes |
| **Vercel** (already chosen for admin, decision-11) | ✅ via `vercel.json` `headers` | ✅ | **Hobby is non-commercial-only** → needs Pro $20/user/mo | ❌ on Hobby |
| exe.dev VM (status quo) | ✅ | ✅ | VM cost | ✅ |
| Supabase | ❌ | ❌ (text/plain) | — | — |
| GitHub Pages | ❌ (already rejected, decision-4) | ✅ | free | ✅ |

Vercel AASA has a known sharp edge: Next.js can intercept `/.well-known/apple-app-site-association`
with dynamic routing; the fix is `public/.well-known/apple-app-site-association` plus an
explicit `vercel.json` `headers` entry
([next.js#14047](https://github.com/vercel/next.js/issues/14047)).

**Vercel Hobby being non-commercial-only is a live problem for decision-11 too**:
*"Hobby teams are restricted to non-commercial personal use only."*
— [fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines). A Vienna cleaning
company's admin panel is commercial. Either budget Vercel Pro or move the frontend to
Cloudflare Pages/Workers (free, commercial use permitted).

---

## 9. Alternatives evaluated

### Cloudflare Workers + D1
- Free: 100k req/day, **10 ms CPU/request**, 128 MB, 5 cron triggers/account
  ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- D1 free: 500 MB/db, 5 GB/account, **50 queries per Worker invocation**, 7-day Time Travel PITR
  ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- ✅ Solves AASA/`/t` natively (full path + header control, own domain, free, commercial OK).
- ✅ Cron Triggers cover the 15-min job.
- ❌ **D1 is SQLite, not Postgres — contradicts decision-2** and is a poor fit for the 3B
  payroll/P&L aggregation (no `numeric`, weak window/CTE story vs Postgres, 100-col cap,
  100 bound params).
- ❌ 10 ms CPU on free is tight for anything non-trivial.
- **Best role: front door only.** Worker serving AASA + `/t` on the company domain, optionally
  proxying `/api/*` → Supabase. Not the database.

### Vercel Functions + Neon / Vercel Postgres
- Real Postgres (Neon), EU regions available, generous free tier.
- ❌ Vercel Hobby non-commercial → Pro required, so no longer "free".
- ❌ Neon free tier also scales-to-zero / suspends; cold start on first query.
- ❌ No in-database cron; needs Vercel Cron (Hobby: **1 job/day only** — cannot do 15-min).
  That alone kills feature 8 on Vercel's free tier.
- Neutral: viable if you're already paying Vercel Pro, but adds a second vendor for no gain
  over Supabase.

### Keep VM, add Cloudflare in front
- Cloudflare free proxy: TLS, DDoS absorption, caching, hides origin IP. Genuinely free,
  ~30 min of work, keeps decision-1 and decision-4 intact.
- Does **not** fix: no backups unless scripted, single disk, OS patching, process supervision,
  the `setsid`/PM2 fragility, or "one bad deploy takes the API down."
- Does **not** fix the exe.xyz domain-ownership problem.
- **Cheapest incremental hardening, but doesn't move the reliability needle where it matters.**

---

## 10. Recommendation

**HYBRID. Adopt Supabase for data + API. Move the public/NFC surface to a company-owned
domain on Cloudflare (or Vercel Pro). Retire the exe.dev VM.**

```
Company domain  nfc.<company>.at   ──► Cloudflare Worker (free)
                  /.well-known/apple-app-site-association   → static JSON, explicit Content-Type
                  /t?l=<ID>                                 → landing page HTML
                  /api/*  (optional)                        → proxy to Supabase Edge Function

App + admin  ──►  Supabase eu-central-1 (Frankfurt)
                  Edge Function  `api`  (Hono router, verify_jwt=false, X-App-Key/X-Admin-Pin)
                  Postgres 15/16 + views + admin_snapshot()
                  pg_cron  */15  → pure-SQL 8h auto-close (decision-10)

Admin UI    ──►  Vercel Pro or Cloudflare Pages (Next.js, decision-3 / decision-11)
```

Reasoning:
1. **Supabase clears 10/12 features natively**, and is *better* than the VM at exactly the
   two things the VM is worst at: cron durability and backups.
2. **The 2 blocked features are static web serving** — the cheapest thing on earth to host
   elsewhere. Don't contort Supabase to do it.
3. **Postgres stays Postgres** (decision-2 honored), which the 3B payroll/P&L work needs.
4. **No Docker involved** (decision-1's *intent* honored — decision-1 should be superseded,
   not violated, since it also mandates PM2/systemd on a VM that would no longer exist).
5. **Cost**: $0 for a throwaway pilot; **$25/mo Supabase Pro** is the honest number for real
   payroll data (daily backups + no pausing). Add $20/mo if the admin UI must be on Vercel Pro,
   $0 if it goes to Cloudflare Pages.

**Start on Supabase Free, but with a scripted nightly `supabase db dump` to off-site storage
from day one.** Upgrade to Pro the moment real (non-throwaway) worker data enters the system.
Do not ship payroll on an unbacked free-tier database.

---

## 11. Migration risk + fallback path

Risk is **low**, because nothing here is deeply Supabase-shaped — *if* you keep it that way:

| Asset | Lock-in | Escape |
|---|---|---|
| Schema + data | none | `supabase db dump` → `psql` into any Postgres. Standard SQL only. |
| `pg_cron` job | none | `pg_cron` is an OSS Citus extension; `CREATE EXTENSION pg_cron` on any Postgres 16. |
| Edge Function | **low, if you use Hono** | Hono runs on Deno *and* Node. Same router file behind `@hono/node-server` on a VM. |
| Auth | none | Custom headers, not Supabase Auth. |
| Client SDK | **avoid** | Use `postgres.js`/`pg` against the connection string, not `supabase-js` RPC sugar. Keeps the handler portable. |
| AASA / `/t` | none | Static files. Any host. |

Fallback drill (should be ≤1 day):
1. `supabase db dump -f dump.sql`
2. Provision Postgres 16 on the exe.dev VM, restore.
3. `deno`→`node`: swap `Deno.serve(app.fetch)` for `serve({ fetch: app.fetch })`. Same routes.
4. Recreate the cron job with `CREATE EXTENSION pg_cron` (or a systemd timer).
5. Repoint the Cloudflare Worker's `/api/*` proxy at the VM. **NFC tags never change** —
   this is the payoff for owning the domain.

`ponytail:` deliberately using one fat Edge Function + Hono + a raw pg client instead of
per-endpoint functions and `supabase-js`. Ceiling: one function means one deploy unit and one
cold-start pool; if a single endpoint ever needs 400 s or heavy CPU, split *that one* out.
Upgrade path: move a route into its own function, adjust the Worker proxy. Nothing else changes.

---

## 12. Gotchas discovered (checklist)

1. **AASA and `/t` cannot live on Supabase.** Not on free, not on Pro, not with a custom
   domain. Path namespace is fixed.
2. **`text/html` is downgraded to `text/plain`** on Edge Functions without a custom domain.
3. **Custom domain = paid plan + $10/mo add-on**, and only *one* per project, CNAME only,
   and *"not intended to enable hosting of frontend applications."*
4. **Free tier has zero backups.** Supabase tells you to DIY `db dump`. For payroll data this
   is the single strongest reason to pay.
5. **Free projects pause after 7 days of low *user* activity.** `pg_cron` activity is not
   documented as counting. Restore is manual.
6. **Free plan = 2 active projects per org**, so prod + staging consumes the whole allowance.
7. **2 s CPU cap per request** on Edge Functions. Keep payroll aggregation in SQL, not JS.
8. **Ports 25/587 blocked** — no direct SMTP from Edge Functions (matters for 3B emails).
9. **No `sharp`/`libvips`, no Web Worker API** — no server-side image/PDF generation in Edge
   Functions (matters if 3B wants PDF payslips; use a separate host or an HTTP service).
10. **Direct Postgres connection is IPv6-only** unless you buy the IPv4 add-on. Use the
    Shared Pooler (`aws-eu-central-1.pooler.supabase.com:6543`, transaction mode) from serverless,
    `:5432` session mode from a long-lived Node process.
    [connecting-to-postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
11. **Vercel Hobby is non-commercial-only.** Affects decision-11 today, Supabase or not.
    [fair use](https://vercel.com/docs/limits/fair-use-guidelines)
12. **Next.js can hijack `/.well-known/apple-app-site-association`** on Vercel — needs an
    explicit `vercel.json` headers rule. [next.js#14047](https://github.com/vercel/next.js/issues/14047)
13. **Cloudflare D1 is SQLite** — would violate decision-2 and hurt 3B payroll math.
14. **Vercel Cron on Hobby is 1 job/day** — cannot satisfy the 15-min requirement (decision-10).
15. **Neither Supabase Free nor a single VM has an uptime SLA.** "Cannot take down the API
    server" is a design goal, not something any free tier will contract to.
16. 🔴 **Decide the NFC hostname before writing tags.** It is the only irreversible choice in
    this entire architecture. `timesheets.exe.xyz` is not company-owned.

---

## 13. Decision-record impact

If this research is accepted:

- **decision-12** → accepted, amended: Supabase for DB + API, **not** for AASA/`/t`.
- **decision-1** (No Docker, PM2/systemd on exe.dev VM) → needs a superseding record; the VM
  goes away. The "no Docker" intent survives (Supabase + Workers involve no containers).
- **decision-4** (AASA on exe.xyz) → **must be superseded**. New AASA host = company-owned
  domain on Cloudflare/Vercel. Highest urgency: blocks task "write NFC tags".
- **decision-5** (location ID in NDEF URI) → unaffected, but the *host* part of that URI is
  now the open question.
- **decision-2** (Postgres) → reinforced. Rules out D1.
- **decision-11** (frontend on Vercel) → needs a cost/ToS note: Hobby is non-commercial.
- **decision-10** (8 h auto-timeout) → implementation changes from Node cron to `pg_cron`
  pure SQL. Strictly more reliable.
