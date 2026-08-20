# OPERATOR-MODEL — a person recognised by phone, and the wipe that precedes him

Status: **design. Nothing built, nothing applied, no migration file created, no code
changed.** SQL below is a sketch inside this document, exactly like `ZONES-MODEL.md` §6.
Production was read (`schema_migrations`, `workers`, `admins` — counts only), never written.

Scope: **W1** per `ops/workflows/RUNBOOK.md` — `sql/ server/ web/`. Android is explicitly
**not** touched here; the operator's own redemption screen, the tag write flow and the
send-logs button are W2/W3 (`android/`). What this document delivers is the identity the
later Android work will authenticate against, and the empty database it starts from.

Input actually read: `server/db/migrations/001`–`006` (006 not applied), `server/lib/auth.js`,
`server/lib/validate.js`, `server/lib/enrolment.js`, `server/routes/{admin,auth,app}.js`,
`server/bin/create-admin.js`, `web/app/login/page.tsx`, `ops/backup/{pg-backup,restore-test}.sh`,
`server/db/check-prod-restore.mjs`, `backlog/docs/VERIFY-FINAL.md`, `backlog/docs/ZONES-MODEL.md`,
`backlog/decisions/decision-{20,22,24,26,41,42,43,44}`, `ops/workflows/{ITERATIONS,RUNBOOK}.md`.

Two decision records accompany it, both **PROPOSED**:

```
decision-45  operator identity is phone-based, lives OUTSIDE `workers`, collision made
             IMPOSSIBLE by a shared registry table; the web admin's own login is untouched
decision-46  the W1 reset — exact scope, exact FK order, a backup gate, and why it must run
             BEFORE decisions 41-44 are accepted, not after
```

---

## 0 · One screen

```
WHO                       admins (1 row, 'schimmer')     UNTOUCHED. Not phone. Not W1.
                           workers                        UNTOUCHED SCHEMA. phone stays
                                                            free text, optional, decorative.
                           operators                       NEW. name + active only.
                           phone_identities                NEW. THE constraint. phone_e164
                                                            PRIMARY KEY, ⇒ worker_id and/or
                                                            operator_id — ONE row can hold
                                                            BOTH, which is how one PERSON is
                                                            allowed to be both roles.
                           operator_sessions               NEW. Mirrors worker_sessions
                                                            exactly. No new crypto.

LOGIN                     web admin        email+password, unchanged, forever until asked
                           worker (iOS)     Sign in with Apple, unchanged
                           worker (Android) enrolment code, unchanged
                           operator         enrolment code (SAME mechanism, new table) —
                                             NOT raw phone entry, NOT built as a stub. SMS
                                             (W5) replaces this AND the worker Android path
                                             together, later, in one change.

THE UNRESOLVED CONFLICT   "create a worker by typing just a name and a phone" (this doc)
                           vs "a worker's rate is REQUIRED and > 0, no exemption" (decision-41,
                           PROPOSED). Both are the owner's words. They contradict on the one
                           field that matters. §8. NOT decided here.

THE RESET                 9 tables, 1 explicit order, backup-then-restore-test FIRST,
                           admins/sessions NEVER named, a live enrolment code and a rate-0
                           leftover both fall out of scope for free if this runs BEFORE
                           migration 006. §9-§10.
```

---

## 1 · The owner's words, unedited (`ops/workflows/ITERATIONS.md`)

> An OPERATOR is identified by PHONE NUMBER. Multiple operator phones allowed. Operator
> phones and worker phones live in ONE namespace and may never collide, so the uniqueness
> has to be enforced by the database, not by a screen. An operator is NOT a cleaner: no
> clock-in, no clock-out. He reads and writes tags. Create a worker from the phone by
> typing name + phone.

Four sentences, four separate design questions. Answered in order.

---

## 2 · One table with a role, or two tables plus a shared registry?

**Two tables (`workers` untouched, new `operators`), plus a third table, `phone_identities`,
that is the ONLY place a phone number is checked for uniqueness.** Not one table with a role.

### 2.1 Why not merge into `workers`

The tempting move is `ALTER TABLE workers ADD COLUMN is_operator BOOLEAN` — one table, one
uniqueness index on `phone`, done. Rejected for a reason that is concrete, not aesthetic:

**decision-41 is PROPOSED, not accepted**, and its text is unconditional: `hourly_rate_cents`
becomes `NOT NULL`, `DROP DEFAULT`, `CHECK (> 0)`, and explicitly **"NO EXEMPTION FOR
INACTIVE WORKERS... the hole is reachable."** If an operator is a row in `workers`, that row
is subject to that CHECK the day decision-41 is accepted — and a pure operator, who never
cleans, has no hourly cleaning wage to satisfy it with. Two bad outcomes, both real:

- decision-41 ships with the CHECK as worded ⇒ every operator now needs an invented rate,
  which is precisely the thing decision-41 exists to forbid ("a migration does not get to
  choose somebody's wage" — the same sentence applies to an API insert).
- decision-41 grows a role-conditional exemption (`CHECK (hourly_rate_cents > 0 OR NOT
  is_worker)`) ⇒ that is a schema change to a not-yet-accepted decision, made to accommodate
  a table merge that was optional in the first place. Coupling two independent decisions
  that don't need to be coupled.

Keeping `operators` as its own table makes this collision **structurally impossible rather
than merely avoided by discipline**: decision-41's CHECK is declared on `workers` and
`workers` alone; nothing about an operator's existence can ever be in its blast radius,
whichever way the owner rules on 41. This is the whole reason the brief says not to build
against a proposed ruling — the table boundary is how you don't have to.

Secondary reasons, each smaller alone but all pointing the same way:

- `workers` already carries `apple_sub`, `email`, five `enrolment_code_*` columns (decisions
  22, 26) — all worker-specific, all meaningless on a pure operator. A merged table either
  grows a `role` discriminator that every one of those columns has to be reasoned about
  against, or the columns stay nullable-and-ignored, which is how `needs_correction` (001's
  own cautionary tale) came to exist.
- The existing route dispatch (`server/server.js:237-240`) already discriminates on
  `route.auth`, a literal string checked against a specific session table
  (`sessions`/`worker_sessions`). Adding `"operator"` alongside them is the smallest change
  that fits the shape already there — "role" is realised as *which session table
  authenticated you*, not a new permissions column. `RUNBOOK.md`'s own words — *"'admin' is
  a role, not a flag"* — is exactly this: a role is a first-class identity kind with its own
  session, not a boolean bolted onto an existing person.

### 2.2 Why a registry table, and not an app-level double-check

A `UNIQUE` index cannot span two tables. The two remaining options, and why the second wins:

| Option | Mechanism | Verdict |
| --- | --- | --- |
| App-level: before inserting an operator, `SELECT 1 FROM workers WHERE phone = $1`, and the reverse on worker insert | A read-then-write. Two operators created concurrently (or an operator and a worker, from the web admin and a future Android screen at the same moment) can both pass the check before either commits. **Race, not impossible.** | Rejected — the brief says impossible, not unlikely. |
| `phone_identities (phone_e164 PRIMARY KEY, worker_id UNIQUE NULL, operator_id UNIQUE NULL)` | The phone claim and the person-row creation happen in ONE transaction. The second writer's `INSERT INTO phone_identities` hits the PK and raises `23505` **atomically**, before either commits. Same idiom as `zones_tag_serial_idx` (decision-44) and `shifts_one_open_per_worker_idx` (001) — the database is the boundary, never the API. | **Chosen.** |

`phone_identities` is deliberately not `phone → (kind, id)` with `kind` exclusive. It is
`phone → worker_id? , operator_id?`, **both nullable, at least one required**
(`CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)`). That shape is not incidental —
it is §3's answer.

**No column is duplicated.** `operators` carries no phone column at all; `workers.phone`
stays exactly what it is today (§2.3). `phone_identities` is the *only* place a canonical
phone number is stored, so there is exactly one thing that can be wrong, matching 005's own
rule: *"a derivable fact is not stored... a stored copy drifts."* Reading "this operator's
phone" is `SELECT phone_e164 FROM phone_identities WHERE operator_id = $1` — one join, on
tables that will never exceed a few hundred rows.

### 2.3 `workers.phone` is NOT touched, and here is the tension that forces that

`server/lib/validate.js:optionalPhone` is explicit: *"Never normalised, because normalising
means silently changing what the director typed."* That is the opposite of what §4 below
requires — a canonical, comparable form is the entire point of the collision constraint. The
brief resolves this explicitly: *"Store E.164 and say what is rejected."* So for **identity**
phones, normalise; the existing free-text column keeps its documented, deployed meaning for
**contact** phones, and the two are not silently merged.

Consequence, stated plainly so it is not rediscovered as a bug: **a worker can, after this
design ships, have two different-looking phone numbers on file** — `workers.phone` (whatever
was typed into the web admin, unnormalised, decorative, exactly as today) and, only if a
`phone_identities` row exists for them, a canonical `phone_e164`. They are not asserted to
agree. A worker created **the new way** (§2.4, an operator typing name+phone in the field)
gets both set from the one string the operator typed, in one transaction — no divergence is
possible at creation. A worker who has existed since before this design, whose phone was
typed loosely into the web admin months ago, has no `phone_identities` row until an admin
explicitly promotes it (a future, one-click "use this as the sign-in number" action — not
built here, named as the upgrade path). **NULL in `phone_identities` for an existing worker
is not a defect; it is "nobody has verified this number as an identity yet,"** exactly the
same reading `location_revenue`'s absent row already carries for a month nobody entered.

### 2.4 The two write paths into `workers`, and which one is new

```
TODAY   web admin, POST /admin/workers {name, email?, phone?, hourly_rate_cents, active}
        auth: "admin". phone is optionalPhone — loose, free text, unchanged.

NEW     an operator, in the field, {name, phone}  — THIS is "create a worker from the phone
        by typing just a name and a phone." auth: "operator" (§7). phone goes through the
        NEW validator (§4), gets stored in workers.phone verbatim (an operator only ever
        typed digits, so there is nothing to lose by also using it as the display value)
        AND claimed in phone_identities in the same transaction.
        hourly_rate_cents: NOT SUPPLIED BY THIS ENDPOINT. §8 is why that is not a detail.
```

---

## 3 · Is an operator also allowed to be a worker?

**Yes — the owner cleaning a building himself is not an edge case this design can refuse to
answer, and the answer is: one phone, one `phone_identities` row, up to two person-rows.**

The owner's two statements — *"an operator has no clock-in"* and (implicitly, from the
brief) *"say what happens when that person must clean"* — are not actually in conflict once
"operator" is read as a **capability a phone number holds**, not a partition of people.
*"An operator does not clock in"* means: the `operators` row and `operator_sessions` grant no
route that opens or closes a shift — there is no `auth: "operator"` route anywhere near
`POST /shifts/open`, full stop, structurally, not by policy. It says nothing about whether
the human behind that phone number also holds a **separate** `workers` row.

```
phone_identities
  phone_e164    worker_id    operator_id
  +43664...     NULL          7            <- a pure operator: reads/writes tags, cannot clock in
  +43676...     4            NULL          <- a pure cleaner: clocks in, cannot touch tag admin
  +43699...     11           3             <- the owner: BOTH rows exist, ONE phone, ONE
                                               registry entry claims it for both
```

The third row is not a special case in the schema — it is just two FKs on one row instead of
one. What makes it correct rather than a loophole: **the registry PK still allows exactly one
phone number to appear once.** Nobody else can register `+43699...` as their own operator or
worker phone; the ambiguity the owner is worried about — "whose session does this number
log into" — genuinely cannot arise, because the registry doesn't route by phone alone, it
routes by *which credential was presented* (an operator code redeems into
`operator_sessions`, a worker code/Apple-ID redeems into `worker_sessions`) against a person
row that the registry already confirmed is the sole owner of that number.

**Turning the owner into "also a worker" is an explicit admin action, not automatic.** Two
directions, and both need a rate the moment decision-41 is accepted — see §8:

```
operator → also worker   admin creates a workers row (name copied, rate typed), then
                          UPDATE phone_identities SET worker_id = <new id>
                          WHERE phone_e164 = <the operator's already-claimed number>
                          -- fails 23505 on worker_id's own UNIQUE if that phone is
                          -- somehow already linked to a DIFFERENT worker: correct,
                          -- one phone cannot back two different clock-in identities.

worker → also operator   symmetric, and only possible for a worker who HAS a phone_e164
                          (i.e. was already promoted per §2.3 — a worker with only the
                          legacy free-text `phone` cannot be turned into an operator
                          without first choosing a canonical number for them).
```

Nothing here is built in W1 (no admin-panel button). The schema is shaped so it is one
`UPDATE`, not a migration, when the owner asks for the button.

---

## 4 · What normalises a phone number, and what is rejected

Ladder first. *Needed at all?* Yes — the whole constraint is a string-equality problem across
spelling variants, and the brief names the exact three: `0664...`, `+43 664...`, with spaces
and slashes. *stdlib?* Node has no phone parser. *Already-installed dependency?* None —
`libphonenumber-js` would be a new npm dependency, forbidden outright (`pg` +
`@sentry/node`, nothing else). *One line?* No — this is exactly the kind of input validation
at a trust boundary the brief says never to simplify away.

```
ponytail: hand-rolled, AUSTRIA-DEFAULT E.164 normaliser. Not a general phone parser.
CEILING: a number typed with neither a leading 0 nor a + is REJECTED, not guessed at — this
system will never silently assume a foreign country's trunk convention. A German cleaner's
mobile typed as "0176 12345678" normalises to +4917612345678 as if it were Austrian, which
is WRONG and gets caught by (5) below only if the resulting shape is implausible, not because
the code understood it was German. UPGRADE PATH: libphonenumber-js, the day a non-Austrian
operator phone is a real, not hypothetical, requirement — a decision record of its own,
because it is the first npm dependency this server would carry beyond pg + Sentry.
```

```
function identityPhone(raw, field) {
  1. required (not optionalPhone's shape — an operator without a phone is not an operator)
     reject: undefined / null / "" / whitespace-only        -> 422 required_field
  2. strip cosmetic characters ONLY: spaces, "-", "/", "(", ")"
     reject anything else non-digit/non-leading-"+"          -> 422 invalid_phone
     (a name pasted into the field, a stray letter — same character-class refusal
      optionalPhone already applies, just now feeding a real parse instead of free text)
  3. leading "00"  -> replace with "+"                        (00436... == +436...)
  4. no "+" prefix:
       leading "0" -> drop it, prepend "+43"                  (0664...     -> +43664...)
       otherwise   -> REJECT, 422 invalid_phone,
                      reason "missing_country_code" (a bare "664 1234567" is refused,
                      never silently assumed Austrian — the ambiguity is the director's
                      to resolve by typing a 0 or a +, not this function's to guess)
  5. final shape, E.164: /^\+[1-9]\d{7,14}$/
       - leading digit after "+" is never 0 (no country code starts with 0)
       - 8-15 digits total after "+" (ITU E.164 ceiling is 15; 8 is a lower sanity floor —
         shorter than that is a landline extension or a typo, not a phone that can receive
         an SMS in W5)
     fail                                                     -> 422 invalid_phone
  return the normalised string, e.g. "+436641234567"
}
```

Worked examples, because a boundary is only real once it is shown rejecting something:

```
"0664 123 45 67"        -> +436641234567        ok
"+43 664/1234567"       -> +436641234567        ok  (same identity as the line above —
                                                       THIS is the collision the whole
                                                       design exists to catch)
"0043 664 1234567"      -> +436641234567        ok
"01 5055904"             -> +4315055904          ok  (Vienna landline; still an identity,
                                                       just not one that will ever receive
                                                       an SMS OTP — accepted anyway, W5's
                                                       problem, not this validator's)
"664 1234567"            -> REJECTED 422 invalid_phone / missing_country_code
"Anna"                    -> REJECTED 422 invalid_phone (fails step 2)
"+43664"                  -> REJECTED 422 invalid_phone (5 digits after +43, below the
                                                       8-digit floor)
""                        -> REJECTED 422 required_field
```

No exemption for an operator whose phone was already free-typed into `workers.phone` in the
old loose format — that string is never fed through this function automatically (§2.3); it is
either re-typed through a validated path, or it stays legacy contact text forever.

---

## 5 · Does phone identity replace the admin's username+password?

**No. It sits beside it, permanently, until the owner explicitly asks otherwise — and W1
does not ask.**

Two independent facts settle this:

1. **The literal risk.** The admin row today has `email = 'schimmer'` — not an address, a
   username (`web/app/login/page.tsx`'s own comment: *"the live identity is `schimmer`, and a
   browser that validates it as an address locks the operator out."*). Replacing it with
   phone-based login means the owner's own password stops working the moment this deploys,
   for a mechanism (SMS) that does not exist until W5. That is a self-inflicted lockout of
   the one account nobody can afford to lose, timed to ship two iterations before its
   replacement is ready.
2. **The scope boundary.** Nothing in the owner's four sentences (§1) mentions the web admin.
   "Operator" is introduced as an Android-app concept — *"he reads and writes tags"* is a
   phone-in-hand action, not a desk action. `admins` already has its own well-understood,
   already-deployed, already-audited login (decision-20); conflating it with the new phone
   registry would mean the director's own desk login now participates in a uniqueness
   constraint designed for field workers, for no requirement anyone stated.

**Consequence for `phone_identities`:** it never gains an `admin_id` column. If the owner
later wants the web admin to *also* recognise him by phone (e.g. so the same phone that is
his operator identity can also open the panel), that is a new, explicit decision — call it
"phone-based admin login" — not a side effect of this one. Named here so it is not
rediscovered as a gap.

---

## 6 · The data model

```sql
-- ===========================================================================
-- operators — a person who reads and writes tags. Never clocks in: no route reachable
-- with an operator session opens or closes a shift, full stop (§3). No hourly_rate_cents
-- column exists here and none should ever be added — a rate is a WAGE FOR CLEANING, and an
-- operator who never cleans has none to record. A person who does both holds TWO rows,
-- linked by ONE phone_identities entry (§3), and the rate lives on their `workers` row only.
-- ===========================================================================
CREATE TABLE operators (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,  -- audit only, same idiom
                                                                 -- as workers.enrolment_code_issued_by
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

  -- ENROLMENT CODE COLUMNS, VERBATIM FROM 004 (decision-26), NOT REINVENTED.
  -- Same shape, same hashing (SHA-256 via lib/auth.js hashToken — never scrypt, for the
  -- same reason 004 gives: this is a 40-bit CSPRNG bearer secret behind short expiry +
  -- single use + rate limiting, not a password), same pair constraint. This is the W1
  -- login mechanism: an admin issues an operator a code exactly as they issue a worker
  -- one today, on the SAME screen shape, and W5 retires BOTH at once.
  , enrolment_code_hash        TEXT UNIQUE
  , enrolment_code_expires_at  TIMESTAMPTZ
  , enrolment_code_issued_at   TIMESTAMPTZ
  , enrolment_code_issued_by   BIGINT REFERENCES admins(id) ON DELETE SET NULL
  , enrolment_code_redeemed_at TIMESTAMPTZ
);

ALTER TABLE operators ADD CONSTRAINT operators_enrolment_code_pair
  CHECK ((enrolment_code_hash IS NULL) = (enrolment_code_expires_at IS NULL));

-- ===========================================================================
-- phone_identities — THE constraint. One phone, one row, at least one owner. This table
-- and not a UNIQUE(phone) column on two tables is what makes the collision the owner
-- described IMPOSSIBLE rather than merely checked: the second conflicting INSERT hits this
-- PK inside the SAME transaction that would have created the second person, and the whole
-- transaction rolls back. Same idiom as zones_tag_serial_idx (decision-44) and
-- shifts_one_open_per_worker_idx (001) — uniqueness the database owns, not the API.
--
-- worker_id / operator_id: BOTH nullable, BOTH UNIQUE (so a phone claims at most one
-- workers row and at most one operators row — never two of the same kind), and the CHECK
-- below forbids the empty row. A phone_identities row with BOTH set is not a bug, it is
-- §3: one person, one number, two capabilities.
--
-- ON DELETE SET NULL, not CASCADE: deleting a workers or operators row must not delete the
-- OTHER half of a linked identity, and must not silently free a phone number for reuse
-- while its sibling row still exists holding half a claim. A row that decays to both NULL
-- is caught by the CHECK on the next write and is a bug to investigate, not a state to
-- leave standing — ops runs `DELETE FROM phone_identities WHERE worker_id IS NULL AND
-- operator_id IS NULL` as routine cleanup, same spirit as the sessions sweep in
-- lib/auth.js.
-- ===========================================================================
CREATE TABLE phone_identities (
  phone_e164   TEXT PRIMARY KEY CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  worker_id    BIGINT UNIQUE REFERENCES workers(id)   ON DELETE SET NULL,
  operator_id  BIGINT UNIQUE REFERENCES operators(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT phone_identities_claims CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)
);

-- "which person owns this phone" — the ONLY read this table exists to answer, and (once
-- W5 exists) the first query an inbound SMS login does.
CREATE INDEX phone_identities_worker_idx   ON phone_identities (worker_id)   WHERE worker_id   IS NOT NULL;
CREATE INDEX phone_identities_operator_idx ON phone_identities (operator_id) WHERE operator_id IS NOT NULL;

-- ===========================================================================
-- operator_sessions — byte-for-byte the shape of worker_sessions (002). Two tables, two
-- cookie names, no shared failure mode — the same reasoning 002 gives for not overloading
-- `sessions` (admin_id NOT NULL there; a nullable admin_id plus a discriminator column is
-- how a worker cookie ends up satisfying an admin route by accident).
-- ===========================================================================
CREATE TABLE operator_sessions (
  token       TEXT PRIMARY KEY,      -- SHA-256(token) — see hashToken, never the raw value
  operator_id BIGINT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX operator_sessions_expires_at_idx ON operator_sessions (expires_at);
CREATE INDEX operator_sessions_operator_id_idx ON operator_sessions (operator_id);

-- workers, admins: ZERO CHANGES. No column added, no constraint touched.
```

`ponytail:` `created_by`/`enrolment_code_issued_by` both point at `admins`, so the very
first operator (the owner himself) has to be created by the one admin row that already
exists — no chicken-and-egg bootstrap script is needed, unlike `create-admin.js`, which
exists precisely because there is no admin yet at all on a fresh box. **Ceiling:** if the
single admin row is ever lost with zero operators enrolled, there is no operator-side
recovery path either — same blast radius `create-admin.js`'s own doc already accepts for
the admin case, not a new one.

---

## 7 · API surface — additive, no route touches an existing one

```
POST /auth/operator-code {code} -> operator_sessions cookie (ts_operator)
    mirrors POST /auth/code (routes/auth.js:137) exactly: checkGlobalEnrolmentRate,
    checkLoginRate, normaliseCode, decoy-hash timing match on a miss. auth: "app"
    (X-App-Key only — there is no session yet, same as the worker equivalent).

POST /auth/operator-logout -> revoke this operator's session. auth: "operator"

POST /operator/workers {name, phone} -> 201 {id, name, phone}
    auth: "operator". THE endpoint behind "create a worker from the phone by typing name +
    phone." phone through identityPhone (§4); on success, ONE transaction:
      INSERT INTO workers (name, phone, active) VALUES ($1, $2, true)
      INSERT INTO phone_identities (phone_e164, worker_id) VALUES ($2, <new id>)
    409 phone_claimed, naming nothing about WHO holds it (an operator must not be able to
    fingerprint who is or isn't already enrolled by phone number — same anti-enumeration
    posture decision-22's 403 already applies to Apple email, extended here).
    hourly_rate_cents: NOT ACCEPTED BY THIS ENDPOINT. §8.

POST /admin/operators {name, phone} -> 201 {id, name, phone_e164}         auth: "admin"
DELETE /admin/operators/:id                                              auth: "admin"
    same transactional phone-claim shape as above, admin-facing mirror of decision-26's
    worker screen. Soft-delete (active = false) preferred; a hard DELETE is available and
    ON DELETE SET NULL on phone_identities means it never orphans-deletes a linked worker.

POST /admin/operators/:id/enrolment-code   -> {code, expires_at}         auth: "admin"
DELETE /admin/operators/:id/enrolment-code -> revoke                     auth: "admin"
    byte-identical route shape to POST/DELETE /admin/workers/:id/enrolment-code
    (server/routes/admin.js:1690-1691), same CODE_TTL_MS, same newEnrolmentCode from
    lib/enrolment.js — reused, not reimplemented.

server.js dispatch (server/server.js:237-240), ONE new branch, same shape as the two already there:
    if (route.auth === "app" || route.auth === "worker" || route.auth === "operator")
      requireAppKey(req.headers);
    ...
    : route.auth === "operator" ? await requireOperatorSession(req.headers)
```

`requireOperatorSession` mirrors `requireWorkerSession` line for line — cookie
`ts_operator`, `JOIN operators o ON o.id = s.operator_id`, `AND o.active`, same deactivation
lockout semantics as a worker (§: `requireWorkerSession`, `lib/auth.js:220-233`).

**No route with `auth: "operator"` appears anywhere near `/shifts/open`, `/shifts/close`, or
`/shifts/unresolved`.** That is the structural version of "an operator does not clock in" —
not a comment, an absence.

---

## 8 · THE CONFLICT — flagged, not resolved, because resolving it is not this document's job

§2.4 named it; here it is in full, because it is the single most consequential finding in
this design and the brief is explicit that a proposed-decision dependency must be surfaced,
not built past.

```
THE OWNER, THIS ITERATION           "Create a worker from the phone by typing name + phone."
                                     Nothing else. That is the entire input.

THE OWNER, decision-41 (PROPOSED)   A worker's hourly_rate_cents is REQUIRED, > 0, no
                                     exemption for any state including inactive.
```

**Today** (accepted schema, `hourly_rate_cents INTEGER NOT NULL DEFAULT 0`): §7's
`POST /operator/workers` works exactly as specified — the row is created, the rate is 0, and
the worker is invisible-until-corrected on the payroll screens exactly the way every
rate-less worker is today. This is a **known, already-shipped defect class**
(`006_zones_revenue_rates.sql`'s own opening comment: *"every rate-less defect in this
system descends from that [DEFAULT 0]"*) that this new endpoint would manufacture on
purpose, once per field-created worker, forever, for as long as decision-41 stays proposed.

**The moment decision-41 is accepted as currently worded**, `POST /operator/workers`'s
`INSERT INTO workers (...)` starts failing `23502`/`23514` on every single call, because it
never supplies a rate and the column no longer has one to fall back to. The endpoint whose
entire purpose is "just a name and a phone" cannot satisfy a schema that requires a fourth,
unstated fact.

Three ways out, presented and rejected or deferred, none chosen:

1. **The operator also types a rate.** Solves the schema. Breaks the owner's own
   specification of the flow, in the same sentence he specified it.
2. **A placeholder/invented rate, auto-set and visibly flagged incomplete.** Decision-41's
   own text forecloses this for `active = true` rows — it is the exact hole 006 was written
   to close (*"a migration does not get to invent one"*; the same applies to an INSERT).
3. **An `active`-gated exemption** (`CHECK (hourly_rate_cents > 0 OR NOT active)`, the
   operator-created row lands `active = false` until an admin sets a rate and flips it).
   Decision-41's own text names this exact shape and rejects it: *"NO EXEMPTION FOR INACTIVE
   WORKERS ... the hole is reachable (deactivate, set 0, and the row can never be reactivated
   without an edit nobody expects)."* Reopening it here, even scoped to creation, is amending
   decision-41, not implementing it.

**This is not decided in this document, and nothing downstream of it should be built until
it is.** The owner has two options, stated so a future reader does not have to re-derive
them: (a) amend decision-41 with an explicit, narrow carve-out for operator-created rows —
which is a change to a PROPOSED record and is the owner's to make, or he re-affirms 41 as
worded and (b) accepts that "just a name and a phone" becomes "a name, a phone, and a rate"
the day 41 lands, i.e. `POST /operator/workers` grows a required field between now and then.
Either is buildable. Neither is assumed here.

---

## 9 · The data reset — scope

Owner's words: *"Wipe everything: workers, locations, buildings, shifts, tags, portal links.
Keep one admin so you are not locked out of your own panel while doing it."*

**Untouched, by construction — never named in any DELETE, never reachable by a cascade from
anything that is:** `admins`, `sessions`, `clients`, `contacts`, `inventory_items`,
`app_settings`. Nothing in the owner's list references or is referenced by these six; a
reset that clears "workers, locations, buildings, shifts, tags, portal links" cannot touch
them without a deliberate, separate instruction, and none was given.

**Named directly:**

| Owner's word | Table(s) |
| --- | --- |
| workers | `workers` |
| locations / buildings | `locations` |
| shifts | `shifts` |
| tags | `zones` — **only if migration 006 has been applied.** Pre-006 there is no tags table at all; a tag's only identity today is a UUID baked into a URL nothing stores server-side (decision-5). |
| portal links | `portal_grants` |

**Forced, not named — a mechanical consequence of deleting workers/locations, not a scope
decision:**

| Table | Why it cannot survive the named deletions |
| --- | --- |
| `worker_sessions` | `worker_id NOT NULL REFERENCES workers(id) ON DELETE CASCADE` — deleted automatically the instant a worker row goes; listed anyway for auditability (§10 explains why explicit beats implicit here). |
| `material_requests` | `worker_id NOT NULL REFERENCES workers(id)`, **no cascade.** A material request cannot exist without the worker who asked for it (005: *"the worker's own words"*) — there is no meaningful "orphan" reading. Deleting every worker forces deleting every material request. The owner did not say "material requests"; deleting every worker says it for him. |
| `location_contracts` | `location_id NOT NULL REFERENCES locations(id)`, no cascade. Contract history cannot survive its building. |
| `location_revenue` (006 only) | Same shape, same reason. |
| `zones` (006 only) | Already named above as "tags"; also forced independently, since `shifts.start_zone_id`/`end_zone_id` and `zones.location_id` both point at rows being deleted anyway. |

**What material_requests losing every row actually costs**, stated because a silent
side-effect on an un-named table is exactly the kind of thing that should not be silent:
every open supply request (`submitted`/`approved`/`ordered`) is destroyed along with the
worker who filed it. Production, per `VERIFY-FINAL.md`, currently has whatever the live
box holds — this reset design does not know the count and does not need to: the FK makes
the outcome unconditional regardless of how many rows exist.

---

## 10 · The data reset — exact FK order, and the tool

**Explicit, ordered `DELETE`, not `TRUNCATE ... CASCADE`**, even though a single
`TRUNCATE workers, locations CASCADE` would touch the identical table set (verified by
walking `pg_constraint` where `confrelid` is `workers` or `locations` — every dependent
table above, nothing else). Explicit wins here for one reason that matters more on a payroll
database than brevity does: **a reviewer reading the script sees the exact nine tables and
the exact order without first reconstructing the FK graph in their head**, and a destructive
script pointed at a client's real data is exactly the place this project's own convention
(explicit history over implicit derivation — decision-42's whole argument) applies hardest.
`TRUNCATE CASCADE` is named here as the **cross-check**, run once before trusting the manual
list and again if a future migration adds a new table referencing `workers` or `locations`:

```sql
-- cross-check only, never the reset itself:
SELECT conrelid::regclass FROM pg_constraint
 WHERE confrelid IN ('workers'::regclass, 'locations'::regclass) AND contype = 'f';
-- must equal exactly: worker_sessions, material_requests, shifts (twice, once per column
-- set — same table), location_contracts, portal_grants, (006:) location_revenue, zones
```

Order (deepest dependents first; guarded with `to_regclass` so the same script runs
correctly whether or not 006 has landed — the exact idiom `restore-test.sh` already uses):

```sql
-- ops/reset-w1.sql — SKETCH, NOT WRITTEN. Run with psql directly, NOT via migrate.js:
-- this is DML on operational data, not a schema migration, so it is allowed its own
-- BEGIN/COMMIT (the "no BEGIN/COMMIT" house rule applies only to files under
-- server/db/migrations/, where migrate.js already wraps each file in psql -1).

\set ON_ERROR_STOP on
BEGIN;

-- 0 · PRE-FLIGHT: refuse to run silently past a live enrolment code (§11) or an admin
--     count that would leave the owner locked out. Both RAISE, which aborts the
--     transaction before a single row is touched.
DO $$
DECLARE n_admins int; n_live_codes int;
BEGIN
  SELECT count(*) INTO n_admins FROM admins;
  IF n_admins < 1 THEN
    RAISE EXCEPTION 'refusing to reset: 0 admin rows exist NOW, before this script runs '
      '— the lockout this script exists to avoid is already true. Fix that first.';
  END IF;

  SELECT count(*) INTO n_live_codes FROM workers
   WHERE enrolment_code_hash IS NOT NULL AND enrolment_code_expires_at > now();
  IF n_live_codes > 0 THEN
    RAISE EXCEPTION '% worker(s) hold a LIVE, unredeemed enrolment code. Wiping them '
      'destroys an in-progress enrolment a real person may be about to complete. '
      'Re-run with ALLOW_LIVE_CODE_LOSS=1 (a psql variable, not a default) once that is '
      'a deliberate choice, not an oversight.', n_live_codes;
  END IF;
END $$;

-- 1 · row counts BEFORE, printed — the only record of what this destroyed, beyond the
--     backup taken in step -1 (§11, outside this transaction, before psql even opens).
\echo 'BEFORE:'
SELECT 'worker_sessions'   AS t, count(*) FROM worker_sessions
UNION ALL SELECT 'material_requests', count(*) FROM material_requests
UNION ALL SELECT 'shifts', count(*) FROM shifts
UNION ALL SELECT 'portal_grants', count(*) FROM portal_grants
UNION ALL SELECT 'location_contracts', count(*) FROM location_contracts
UNION ALL SELECT 'workers', count(*) FROM workers
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'admins (must be unchanged after)', count(*) FROM admins;

-- 2 · deepest dependents first
DELETE FROM worker_sessions;                                   -- would cascade anyway; explicit
DELETE FROM material_requests;                                 -- forced (§9)
DELETE FROM shifts;                                             -- named
DELETE FROM portal_grants;                                      -- named ("portal links")

DO $$ BEGIN
  IF to_regclass('public.location_revenue') IS NOT NULL THEN
    EXECUTE 'DELETE FROM location_revenue';                     -- 006 only, forced
  END IF;
  IF to_regclass('public.zones') IS NOT NULL THEN
    EXECUTE 'DELETE FROM zones';                                -- 006 only, named ("tags")
  END IF;
END $$;

DELETE FROM location_contracts;                                 -- forced (§9)
DELETE FROM workers;                                             -- named. Takes id 6, TTL
                                                                   -- Test, rate 0, with it —
                                                                   -- for free. See §11.
DELETE FROM locations;                                           -- named ("buildings")

-- 3 · the one assertion that would have caught the failure mode this whole design guards
--     against: an admin swept up by a cascade or a copy-paste error above.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM admins;
  IF n < 1 THEN
    RAISE EXCEPTION 'ABORT: admins table is now EMPTY. This transaction is being rolled '
      'back rather than committed — the owner would be locked out of his own panel.';
  END IF;
END $$;

\echo 'AFTER:'
SELECT 'workers' AS t, count(*) FROM workers
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'shifts', count(*) FROM shifts
UNION ALL SELECT 'admins', count(*) FROM admins;

COMMIT;
```

**The RED case this script must be shown failing before it is trusted** (brief: *"a check
whose negative case cannot fail is not a check"*): run it once against a scratch copy with
the pre-flight `DO $$` blocks deliberately commented out, seeded with a live enrolment code
and with a hand-edited copy that also runs `DELETE FROM admins` — confirm THAT version
either raises (guard present) or leaves `admins` empty (guard absent, proving the guard is
load-bearing and not decorative). Only after that contrast is observed does the real script
count as verified, not merely written.

---

## 11 · The two production facts named in the brief, and how sequencing resolves one of them

**`workers id 6, 'TTL Test', rate 0`** — this row is not special-cased anywhere in §10's
script. It is simply one of the rows `DELETE FROM workers` removes, because it is a worker
and the owner said "wipe workers." **If this reset runs before migration 006 is applied**,
`006`'s `DO $$ ... RAISE EXCEPTION` guard (which fires today specifically because of this
row — `check-prod-restore.mjs`'s own comment names it as the first thing it found) checks an
**empty** `workers` table and passes trivially. The documented one-line ops workaround in
`server/db/README.md` becomes unnecessary, not because the row was handled specially, but
because it no longer exists by the time anyone asks the question. **This is the concrete
argument for sequencing the reset before decisions 41-44 are accepted and 006 is applied,**
not merely a nice side effect — decision-46 states it as the recommendation.

**The enrolment code expiring 2026-08-22** — this is the one fact in the brief that §10's
pre-flight guard treats as a hard stop, not a note. Reset timing genuinely depends on a
question this document cannot answer from here: **is that code still live, or already
redeemed?** (Production is read-only to this run; the answer requires a query nobody ran
this session.) Two honest paths, stated so the choice is the owner's:

- **Wait.** The code expires naturally on 2026-08-22; run the reset any time after. Costs a
  few days of delay on W1 for a wipe that has no other deadline.
- **Wipe now, notify.** Whoever holds that code (a worker mid-enrolment, on Android, per
  decision-26) loses it silently unless someone tells them; they need a **new** code issued
  **after** the reset, from the (also wiped, then recreated fresh) worker roster — or, if
  they are meant to survive the reset as a person, their enrolment is not actually part of
  "wipe everything" and the brief's scope needs a named exception before the script runs.

Neither is chosen here. `ALLOW_LIVE_CODE_LOSS=1` in §10 makes "wipe now" a keystroke, not a
silent default — the guard's entire job is making sure that keystroke was a decision.

---

## 12 · What this design deliberately does NOT do

- **No Android code, no Android screen.** The operator's own login UI, the tag read/write
  flow, the send-logs button — all W2/W3, per `RUNBOOK.md`'s ownership table. What ships
  here is testable the same way `check-api.js` already tests `/auth/code` and `/roster`:
  direct HTTP, no device.
- **No SMS, no Twilio, no OTP.** W5, explicitly last, explicitly because it retires a
  working mechanism (decision-26's codes) and can lock everyone out at once if it goes
  wrong. `phone_identities` is shaped so W5 has a canonical number to text without a second
  migration — that is the entire extent of "forward-compatible" claimed here.
- **No `roles` table, no permissions framework.** Three identity kinds, three session
  tables, one literal string compared in `server.js`'s dispatch — the smallest change that
  matches what is already there for admin/worker. Rejected explicitly in §2.1.
- **No retroactive normalisation of existing `workers.phone` values.** They are not touched,
  not validated against §4, not assumed to be real phone numbers at all. Promotion to a
  canonical identity is a future, explicit, one-row-at-a-time admin action.
- **No change to `admins` or the web login.** §5.
- **No resolution of §8.** Named as the reason.
- **No non-Austrian phone support beyond "has a + and a plausible length."** §4's ponytail.
- **No clients/contacts/inventory_items/app_settings touched by the reset.** §9.

---

## 13 · What breaks if this is got wrong, worst first

```
1  §8 built past          an operator-created worker either (a) silently costs €0,00/h
   silently                forever if decision-41 stays proposed and nobody notices, or
                            (b) the field-onboarding flow throws a 500 on every call the
                            day 41 is accepted, in a stairwell, with no admin nearby.
                            COST: a cleaner who cannot be paid correctly, or an operator
                            flow that stops working the exact week it starts mattering.

2  admins swept into the   the owner is locked out of his own panel with no self-service
   reset, even once         recovery (JOURNEYS.md: "recovery is the operator, on the
                            machine" — there is no reset-by-email, deliberately). §10's
                            final assertion inside the SAME transaction is what makes this
                            a rollback instead of an incident.

3  phone_identities row    same phone number silently authenticates two different
   allowed with BOTH        person-rows of the SAME kind (two workers, or two operators) —
   worker_id AND             exactly the ambiguity the owner described, reintroduced. The
   operator_id NULL,         UNIQUE constraints on worker_id/operator_id individually (not
   or two rows claiming      just the phone_e164 PK) are what makes this unrepresentable;
   the same phone            dropping either one reopens it.

4  the live enrolment       a real person, mid-onboarding, finds their code silently
   code destroyed            invalid with no explanation. Costs a support call at best, a
   without the pre-flight    day of unpaid confusion at worst. §11.
   guard

5  the reset run AFTER      migration 006's rate guard now has to be handled by the
   006/decision-41           documented ops workaround FOR EVERY leftover rate-0 row
   instead of before          instead of dissolving for free. Not a correctness bug, a
                              missed cheap win. §11.
```

---

## 14 · What the owner must decide before any of this is built

| # | Question | Why it cannot be deferred | Default if silent |
| --- | --- | --- | --- |
| 1 | **§8 — does decision-41 get a carve-out for operator-created workers, or does "name + phone" become "name + phone + rate"?** | `POST /operator/workers` cannot be built correctly until one of these is chosen; building it against the CURRENT accepted schema (rate defaults to 0) manufactures the exact defect decision-41 exists to close. | nothing is built; the endpoint stays undesigned past §7's shape |
| 2 | **Does the reset run before or after decisions 41-44 are accepted?** §11 argues before. | Running after means re-solving the rate-0 leftover by hand for every row instead of it disappearing on its own; running before is strictly cheaper and has no stated downside. | before, as recommended, but not assumed acted upon |
| 3 | **Wait for the 2026-08-22 enrolment code, or wipe now and re-notify whoever holds it?** §11. | The reset script's pre-flight guard hard-stops on this either way; someone has to pass `ALLOW_LIVE_CODE_LOSS=1` on purpose. | the script refuses to run; nothing is lost by accident |
| 4 | **Does the web admin ever gain phone-based login of its own?** §5 says no, for now. | Out of scope unless stated; `phone_identities` has no `admin_id` column and none should be added speculatively. | no; admins stay email+password only |
| 5 | **Is a non-Austrian operator phone a real near-term requirement?** §4's ponytail. | Determines whether the hand-rolled normaliser is sufficient for W1 or whether `libphonenumber-js` (the first non-`pg`/`@sentry` dependency) needs its own decision record now rather than later. | Austria-default normaliser, foreign numbers without a `+` rejected |

---

## 15 · What did NOT happen in producing this document

- **No file was written or edited outside this document and the decision/task records
  filed alongside it.** No migration file. No route. No `web/` component.
- **Production was read-only.** `schema_migrations` (confirms `006` not applied),
  `SELECT count(*) FROM admins`, `SELECT count(*) FROM workers` — counts only, over SSH,
  never a full row, never a write.
- **No scratch database was created or exercised this session.** §10's SQL is a sketch, not
  a rehearsed script; the RED-case rehearsal it names (its own §10, last paragraph) is a
  requirement placed on the BUILD phase, not evidence produced here.
- **No enrolment code's actual expiry was queried.** §11's two paths are both live because
  this run could not tell you which one the facts support.
- **Android, iOS: untouched, unread beyond confirming RUNBOOK's ownership table.**
