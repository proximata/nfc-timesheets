# Decision Brief — Infra + Android

Audience: project owner. Inputs: `research/supabase-vs-vm.md`, `research/android-path.md`.

---

## 1. Infrastructure verdict: HYBRID (Supabase DB+API, tiny static host for AASA)

**Blocker first: Supabase cannot serve `/.well-known/apple-app-site-association` or `/t`.** URL namespace is fixed — everything lives under `/rest/v1`, `/auth/v1`, `/functions/v1`, `/storage/v1`. Custom domain rebrands host only, no root-path control at any tier. Also rewrites `text/html` → `text/plain` without paid custom domain. So Supabase can be the database and the API, but it can never be the universal-link domain. That one file needs a host you control at root. Everything else (10/12 features) maps natively.

Recommendation: **Postgres + one Hono Edge Function on Supabase eu-central-1 (Frankfurt)**, `verify_jwt=false`, custom `X-App-Key` / `X-Admin-Pin` headers. **`pg_cron` in pure SQL** for the 8h auto-close. **AASA + `assetlinks.json` + `/t` landing on a company-owned domain** behind a Cloudflare Worker (free, commercial use allowed). Retire the VM.

**3 strongest reasons**

1. **Reliability = "cannot take down the API server."** VM = you patch it, you restart PM2, you own the pager. Supabase = managed Postgres + managed function runtime, no Docker anywhere (satisfies decision-1 spirit better than the VM ever did). `pg_cron` runs inside the DB — no separate Node process to die.
2. **Backups.** Supabase free tier has **zero backups** — their docs tell you to DIY `pg_dump`. Not shippable for payroll data. This is the real cost driver: **$25/mo Pro is the honest number**, not $0. But a self-run VM with no backup story is worse *and* costs money.
3. **The static-host split is cheap and removes the fragile part.** AASA is one 200-byte JSON file. Cloudflare Worker serves it free, forever, with no server to keep alive. The most breakage-prone piece (a Node process serving a MIME-sensitive file) stops being a process at all.

**Cost reality check (be honest about it):**
- Supabase Free: $0, no backups → pilot-only, not payroll-grade.
- Supabase Pro: $25/mo, PITR available → the number to plan for.
- Cloudflare Workers: $0.
- **Vercel Hobby is non-commercial-only.** A cleaning company's admin panel violates ToS. decision-11 needs a cost note regardless of the Supabase call — Vercel Pro is $20/mo/seat, or self-host the Next.js static export on the same Cloudflare Worker for $0. `ponytail:` Cloudflare Pages for the admin panel is the lazy correct answer here — it's a static-ish Next.js app, no need for a second vendor bill.
- **Vercel Cron on Hobby = 1 job/day.** Cannot do 15-min. Dead as a cron alternative.

**🔴 Loudest finding, unrelated to Supabase:**
**The NFC hostname is the only irreversible choice in the architecture.** `timesheets.exe.xyz` is not company-owned. Once tags are written and glued inside buildings, changing the host means physically revisiting every building. **Buy a company domain and decide the hostname BEFORE task-6 writes a single tag.** This blocks tag writing today.

---

## 2. Backlog impact

| Task | Fate | Why |
|---|---|---|
| **TASK-1** provision VM | **DROP** | No VM. Replace with `task-1b: Create Supabase project (eu-central-1), enable pg_cron, configure PITR/backup policy`. |
| **TASK-2** DB schema | **KEEP, rewrite delivery** | Same Postgres schema. Delivery becomes Supabase migrations (`supabase/migrations/`) not hand-run SQL. Add RLS posture note (service-role key only, no anon access in 3A). Low effort change. |
| **TASK-3** server rewrite to Postgres | **REWRITE** | Target changes from "Node/Express on PM2" to "single Hono Edge Function on Deno". Hono runs on both Deno and Node → fallback to a VM stays ≤1 day if Supabase disappoints. Medium effort, mostly mechanical. |
| **TASK-4** serve AASA | **REWRITE + SPLIT** | Cannot be Supabase. New target: Cloudflare Worker on company domain serving `/.well-known/apple-app-site-association`, `/t`, and (new) `/.well-known/assetlinks.json`. Low effort, ~40 LOC. |
| **TASK-5** DNS cutover | **REWRITE, ELEVATE** | No longer "point DNS at VM". Becomes **acquire company domain + fix NFC hostname permanently**. Now a *blocker* for TASK-6/8 (tag writing). Highest-priority sequencing change in the whole backlog. |
| **TASK-11** 8h cron | **REWRITE, SIMPLER** | `pg_cron` pure SQL, 15-min schedule, `UPDATE shifts SET ...` directly. No `pg_net`, no Edge Function call, no invocation cost, nothing to keep running. Effort drops from medium to low. decision-10 unchanged, implementation swapped. |

**New tasks**
- `task-1b` Supabase project + pg_cron + backup policy
- `task-4b` Cloudflare Worker static host (AASA + assetlinks + `/t`)
- `task-5b` Acquire company domain (blocks TASK-6, TASK-8)
- `task-30` Add `/.well-known/assetlinks.json` (Android; see §3)

**Decision records to write**
- decision-12 → **accept, amended** (hybrid, not full Supabase)
- decision-4 → **SUPERSEDE** (AASA moves off exe.xyz to company domain / Cloudflare) — this one gates tag writing
- decision-1 → superseding record (no VM at all; "no Docker" survives trivially)
- decision-11 → add ToS + cost note (Hobby tier illegal for commercial use)
- decision-10 → note implementation = `pg_cron`
- new: "Android = separate native Kotlin app, no cross-platform framework"

---

## 3. Android verdict: YES, worth doing. Kotlin + Compose, second native app.

Not now — but the API must not block it, and it doesn't.

**Approach:** native Kotlin + Jetpack Compose. Cross-platform (KMP/RN/Flutter) rejected: UI surface is ~580 LOC and NFC is the single most platform-specific API on the phone — every framework makes you write it twice anyway. **Shared code = the REST API.** Nothing else is worth sharing.

**Why it's a good deal:**
- **Android NFC UX is strictly better than iOS.** Android 16+ fires `ACTION_VIEW` for `https://` NDEF URIs → App Links → app opens directly. **One tap.** iOS needs two (tag, then notification — Apple's own docs). For workers with cold hands at 6am, that matters.
- **decision-5's tag URI works on Android unchanged. Zero tag rewrites.** The URI-encoded-location-ID call was correct.
- **Play internal testing beats TestFlight for this pilot**: $25 once vs $99/yr, builds never expire (no 90-day treadmill), no beta review, delivered through the Play Store app workers already have. The 12-tester/14-day rule gates *production only* — pilot never touches it.

**Does it change how the API is built NOW?** Barely — three cheap things, do them while writing TASK-3/TASK-4:

1. **Serve `/.well-known/assetlinks.json`** from the same Cloudflare Worker as AASA. Same constraints: exact `Content-Type: application/json`, **no redirects**. Costs ~5 lines while you're already in that file. Skipping it means reopening the worker later.
2. **Keep the API additively versioned** — never break a field, only add. Then iOS and Android release order stops mattering. Free discipline, no code.
3. **Optional `X-Client: ios/1.2.0` header** for server-side logging. One line. `ponytail:` ceiling — this is logging, not analytics; if you need real telemetry later, that's a different tool.

**No FCM in 3A.** decision-10 is already satisfied by local notifications on both platforms.

**Traps to bank for later (not now):** Android 16 user-facing NFC allowlist (`isTagIntentAllowed()`), Android 17 `DISPATCH_NFC_MESSAGE` permission, and no NFC dispatch to stopped-state apps (worker must open the app once after install; OEM battery managers re-trigger this). All three cause *silent* clock-in failure. Also: emulator has no NFC — a physical Android device is mandatory for dev.

---

## 4. Open questions — answer before implementation

**Blocking, answer today:**

1. **What domain do the NFC tags point at?** Company-owned, permanent. This is irreversible once tags are in buildings. Blocks TASK-5, TASK-6, TASK-8. Nothing else matters more.
2. **Free tier or $25/mo Pro?** Free = no backups on payroll data. Pilot-acceptable, production-not. Pick one now; migrating later is annoying but not hard.
3. **Vercel Hobby ToS violation — accept the $20/mo, or move the admin panel to Cloudflare Pages?** Recommendation: Cloudflare, one vendor, $0.

**Blocking, answer this week:**

4. **Retire the VM entirely, or keep it cold as fallback?** Hono runs on Deno and Node, so fallback is ≤1 day. Keeping a cold VM costs money for insurance you probably don't need.
5. **Data residency: is Frankfurt (eu-central-1) acceptable for Austrian employee time/payroll data?** Assumed yes (GDPR, EU region). Confirm — if a lawyer says Austria-only, the whole Supabase call reopens.
6. **Who is the Play Console account holder — personal or company org?** Org account is exempt from the 12-tester/14-day production rule. Cheap to get right at signup, painful to change.

**Non-blocking, decide before 3B:**

7. Admin auth: stays PIN, or moves to Supabase Auth? PIN is fine for 5-20 workers and one admin. `ponytail:` don't build auth you don't need yet.
8. When does Android start — after the iOS pilot proves the flow, or parallel? Recommendation: after. One platform's worth of field feedback first.
