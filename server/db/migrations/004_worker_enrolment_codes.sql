-- 004_worker_enrolment_codes.sql — admin-issued enrolment codes (decision-26).
--
-- WHY: decision-22 made worker identity Sign in with Apple. The Android app has landed
-- and an Android-owning cleaner has no Apple ID. decision-26 chose an admin-issued code:
-- the admin generates it FOR A PERSON, the worker types it once, and it is exchanged for
-- the SAME worker_sessions row Apple sign-in already produces. One session system, two
-- enrolment mechanisms. iOS is untouched.
--
-- NO BEGIN/COMMIT — migrate.js runs each file with `psql -1`, so the file plus its
-- schema_migrations row is already one transaction (see 001_init.sql).
--
-- ADDITIVE ONLY. 001, 002 and 003 are APPLIED IN PRODUCTION on a box holding one worker,
-- one building and five real shifts. Every column below is NULLable with no DEFAULT, so
-- existing rows stay valid and the worker already enrolled via Apple keeps signing in
-- with no code present. Nothing here is on the Apple path.
--
-- ---------------------------------------------------------------------------
-- COLUMNS ON `workers`, NOT A SEPARATE TABLE.
--
-- decision-26: a code is "bound to one worker ... one active code per worker replaces
-- any previous one. This needs no separate table." A codes table would allow two live
-- codes for one person, which is a state with no meaning and one more thing to reason
-- about at the trust boundary. One row per worker, one code per row, replacement is an
-- UPDATE.
--
-- THE HASH, NEVER THE CODE. SHA-256, via lib/auth.js hashToken — the same helper every
-- other bearer token in this system uses (worker_sessions.token, portal_grants.token_hash).
-- Plain SHA-256 and not scrypt, deliberately: redemption happens at a public trust
-- boundary that must stay cheap, and the secret is 40 bits of CSPRNG output with no
-- dictionary behind it. What makes 40 bits safe is short expiry + single use + hard rate
-- limiting (routes/auth.js), not a slow KDF — a slow KDF here would only be a free DoS
-- lever. A leaked pg_dump then yields digests of codes that have already expired.
--
-- UNIQUE on the hash: two workers holding the same live code would make "which worker
-- does this code name" ambiguous at redemption. The odds are ~1 in 2^40 per issue and the
-- issuing route retries on 23505, but "vanishingly unlikely" is not "impossible", and an
-- ambiguous credential is not a state worth being able to reach. NULLs are not unique in
-- Postgres, so every worker without a live code coexists fine.
--
-- THE AUDIT TRAIL — issued_at / issued_by / redeemed_at.
-- A code is read aloud over the phone. When one is used by the wrong person, the only
-- question worth answering is "who issued it, when, and when was it redeemed". These
-- three columns describe the MOST RECENT code for that worker and survive the hash being
-- cleared (that is the point: the hash is gone the instant the code is used or revoked,
-- so it cannot carry the history). Issuing a new code resets redeemed_at, so the trio
-- always describes one code and never a mixture of two.
--
-- issued_by is ON DELETE SET NULL: losing the admin row must not block deleting an admin,
-- and must not delete the worker. "Issued by someone no longer here" is still a fact.
-- ---------------------------------------------------------------------------
ALTER TABLE workers
  ADD COLUMN enrolment_code_hash        TEXT UNIQUE,
  ADD COLUMN enrolment_code_expires_at  TIMESTAMPTZ,
  ADD COLUMN enrolment_code_issued_at   TIMESTAMPTZ,
  ADD COLUMN enrolment_code_issued_by   BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN enrolment_code_redeemed_at TIMESTAMPTZ;

-- A code without an expiry is a permanent bearer credential — exactly the thing
-- decision-26 called "the system's first expiring secret" and refused to make optional.
-- An expiry without a hash is a dangling fact. Both NULL means "no live code", which is
-- what every row on the live box already is, so this applies cleanly over them.
ALTER TABLE workers
  ADD CONSTRAINT workers_enrolment_code_pair
  CHECK ((enrolment_code_hash IS NULL) = (enrolment_code_expires_at IS NULL));
