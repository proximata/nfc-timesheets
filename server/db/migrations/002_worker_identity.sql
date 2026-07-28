-- 002_worker_identity.sql — Sign in with Apple replaces the client-side worker picker
-- (decision-22).
--
-- WHY THIS EXISTS: until now the iOS app held an @AppStorage("workerId") Picker and
-- POST /shifts/open trusted body.worker_id. Anyone holding the app key could file
-- hours as anyone. That is an authentication hole, not a UX preference. After this
-- migration the SERVER decides who the caller is, from a session minted against a
-- verified Apple identity token.
--
-- NO BEGIN/COMMIT here — migrate.js runs each file with `psql -1`, so the file plus
-- its schema_migrations row is already one transaction (see 001_init.sql).
--
-- 001_init.sql is APPLIED on the live box and is not editable. This is additive only:
-- both new columns are NULLable, so existing worker rows stay valid and the deployed
-- admin path keeps working while the iOS side catches up.

-- ---------------------------------------------------------------------------
-- workers.apple_sub / workers.email — the eligibility pair.
--
-- apple_sub is Apple's `sub` claim: stable per (Apple ID, app team), opaque, and the
-- only identifier that survives a name change or a Hide My Email rotation. UNIQUE, so
-- one Apple account cannot be two workers.
--
-- email is what the ADMIN types in to pre-authorise a person. It is the only bootstrap
-- path: the admin cannot know apple_sub in advance, so first login matches on email
-- and then stores the sub on that row for every login after.
--
-- LOWERCASE IS AN INVARIANT, not a convention. Login lower-cases before it looks the
-- address up, so a row stored as "Anna@Example.at" would simply never match and the
-- worker would be permanently locked out with no visible cause. Enforced in three
-- places on purpose: lib/validate.js normalises admin input, routes/auth.js normalises
-- what Apple returns, and the CHECK below is the backstop for anything written by hand
-- with psql.
--
-- Hide My Email: Apple may hand back x@privaterelay.appleid.com instead of the real
-- address. It is stable per app, so it works fine as a key — the admin just cannot
-- guess it. POST /auth/apple therefore echoes the address back in its 403, the app
-- shows it, and the worker reads it to their manager who pastes it in here. No
-- approval queue, no extra table, no self-service enrolment.
-- ---------------------------------------------------------------------------
ALTER TABLE workers
  ADD COLUMN apple_sub TEXT UNIQUE,
  ADD COLUMN email     TEXT UNIQUE CHECK (email = lower(email));

-- ---------------------------------------------------------------------------
-- worker_sessions — server-side sessions for the iOS app.
--
-- Deliberately NOT the `sessions` table. That one is deployed, tested and carries
-- admin_id NOT NULL; overloading it would mean a nullable FK, a discriminator column
-- and a class of bug where a worker cookie satisfies an admin route. Two tables, two
-- cookie names, no shared failure mode.
--
-- `token` stores SHA-256(token), never the raw value — identical to `sessions`
-- (lib/auth.js). A leaked pg_dump or any read-only SQL hole then yields hashes that
-- cannot be replayed as live sessions. Plain SHA-256 is right here and would be wrong
-- for a password: the token is 32 bytes of CSPRNG output, so there is no dictionary to
-- attack and a slow KDF on every authenticated request would only buy a cheap DoS.
--
-- ON DELETE CASCADE: hard-deleting a worker takes their sessions with them. The admin
-- panel soft-deletes (active = false) instead, and eligibility is re-checked against
-- `active` on every request, so deactivating locks a worker out immediately either way.
-- ---------------------------------------------------------------------------
CREATE TABLE worker_sessions (
  token      TEXT PRIMARY KEY,
  worker_id  BIGINT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cheap sweep of expired sessions, run opportunistically on login:
--   DELETE FROM worker_sessions WHERE expires_at < now()
CREATE INDEX worker_sessions_expires_at_idx ON worker_sessions (expires_at);

-- "log this worker out everywhere" / cascade on deactivate.
CREATE INDEX worker_sessions_worker_id_idx ON worker_sessions (worker_id);
