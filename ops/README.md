# ops — systemd units, 8h auto-close, backups

Everything runs on one exe.dev VM (decision-16). No Docker (decision-1), no PM2, no pg_cron.
Conventions come from `backlog/docs/runbook-vm-provisioning.md`:

| Item | Value |
|---|---|
| App user | `app` (system user, nologin) |
| App dir | `/srv/nfc` (this repo's build artifact, rsynced) |
| Secrets | `/etc/nfc/env` — `0640 root:app`. Required: `DATABASE_URL`, `APP_KEY`, `PORT`. Optional: `PUBLIC_DIR`, `PG_POOL_MAX`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` |
| DB name / role | `nfc` |
| Postgres | local unix socket, never publicly bound |
| Backups | `/var/backups/nfc`, `0700 postgres:postgres` |

## Files

| File | Installs to |
|---|---|
| `systemd/nfc-api.service` | `/etc/systemd/system/nfc-api.service` |
| `systemd/nfc-autoclose.service` + `.timer` | `/etc/systemd/system/` |
| `systemd/nfc-backup.service` + `.timer` | `/etc/systemd/system/` |
| `sql/autoclose.sql` | ships in the artifact → `/srv/nfc/ops/sql/autoclose.sql` |
| `backup/pg-backup.sh` | ships in the artifact → `/srv/nfc/ops/backup/pg-backup.sh` |
| `backup/restore-test.sh` | ships in the artifact → `/srv/nfc/ops/backup/restore-test.sh` |
| `check-autoclose.sh` | dev/CI only, never installed |
| `deploy.sh` | dev/CI only, runs on the **laptop**, never installed |
| `smoke-live.sh` | dev/CI only, runs on the **laptop** — drives the LIVE host and cleans up after itself |
| `smoke-admin.mjs` | ships in the artifact → `/srv/nfc/ops/smoke-admin.mjs` (used only by `smoke-live.sh`) |

## Install order

Order matters: DB before app, app before timers, backups before real data.

### 1. Prerequisites (runbook §1–§3)

`app` user, ufw, Node 22, Postgres 16, `nfc` role + `nfc` database, and `/etc/nfc/env`
pushed from the psst vault. Do not proceed without:

```bash
ss -tlnp | grep 5432          # 127.0.0.1 only, or nothing (unix socket)
ls -l /etc/nfc/env            # -rw-r----- 1 root app
```

### 2. Deploy the artifact

There is no `dist/` and no root build step. The artifact is assembled from three source
directories, and `ops/deploy.sh` is the only supported way to do it — it also runs migrations
before the restart, which hand-typed rsyncs reliably forget:

```bash
# on the laptop, from the repo root
./ops/deploy.sh timesheets.exe.xyz
```

| Source | Lands at | Contains |
|---|---|---|
| `server/` | `/srv/nfc/` | `server.js`, `instrument.mjs`, `lib/`, `routes/`, `db/`, `wellknown/`, `node_modules/` |
| `web/out/` | `/srv/nfc/public/` | the static admin export (`PUBLIC_DIR` default) |
| `ops/` | `/srv/nfc/ops/` | units, `autoclose.sql`, backup scripts |

`chown -R app:app /srv/nfc` and `chmod +x /srv/nfc/ops/backup/*.sh` are done by the script.
On a **first** deploy the unit does not exist yet, so step 6 fails — finish §3–§5 below and
re-run.

### 2a. Schema

`deploy.sh` runs `node /srv/nfc/db/migrate.js` on every deploy (already-applied files are
skipped). To run it by hand:

```bash
sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/db/migrate.js'
```

Never run `server/db/seed.sql` on the VM — it is dev sample data.

### 3. Backup target

```bash
install -d -m 0700 -o postgres -g postgres /var/backups/nfc
```

### 4. Install units

```bash
install -m 0644 /srv/nfc/ops/systemd/*.service /srv/nfc/ops/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
```

### 5. Enable

```bash
systemctl enable --now nfc-api.service
systemctl enable --now nfc-autoclose.timer     # the TIMER, not the service
systemctl enable --now nfc-backup.timer        # the TIMER, not the service
```

Enabling `nfc-autoclose.service` / `nfc-backup.service` directly is wrong — they are
`Type=oneshot` jobs driven by their timers.

### 6. First backup + the one mandatory restore test

```bash
systemctl start nfc-backup.service
journalctl -u nfc-backup -n 20 --no-pager        # expect "backup ok: /var/backups/nfc/..."
sudo -u postgres /srv/nfc/ops/backup/restore-test.sh
```

The restore test is **not optional** and must pass at least once before real payroll data
exists, and again after every schema migration. An untested backup is a guess. Record the
date it last passed in `backlog/docs/`.

Then pick an offsite target: `backup/pg-backup.sh` has one clearly marked `TODO(offsite)`
block with three concrete options (rclone / restic / rsync-over-ssh). Nothing is chosen and
no credentials are invented — the owner picks one. **Until that is done there is no backup,
only a second copy on the same failing disk.**

### 7. Smoke-test the live box

```bash
./ops/smoke-live.sh                  # defaults to ops/branding.json apiHost
```

82 assertions over real HTTP: every admin page and read route, every auth gate refusing,
operator enrolment → tag report → admin resolve → tap, the OLD-SHAPE `POST /shifts/open`
the field APK sends, and the unbound tap that must stay harmless. It WRITES — a marked
worker, operator, tag, zone and shift — because all four shipped features are writes, and
every row is deleted from a trap and then **counted** to prove production is as it was
found. It never touches the director's admin row: it creates a throwaway admin with a
random password and deletes it in the same trap.

## Operating

```bash
systemctl status nfc-api
journalctl -u nfc-api -f

# access log (decision-23) — one line per ROUTED request, plus every 4xx/5xx. Static admin
# assets answering 200 are deliberately silent or `/_next/*` would bury everything.
#   [req] POST /shifts/open 201 34ms w=7
#   [req] POST /shifts/open 422 11ms w=7 err=unknown_location
journalctl -u nfc-api --since today | grep '\[req\]'
journalctl -u nfc-api --since today | grep -E '\[req\].* (4|5)[0-9][0-9] '   # failures only

systemctl list-timers 'nfc-*'                   # next/last run of both timers
journalctl -u nfc-autoclose --since today        # "UPDATE <n>" per run = auto-closure log
journalctl -u nfc-backup --since '7 days ago'

systemctl start nfc-autoclose.service            # force a run now (safe: idempotent)
```

Redeploy: `./ops/deploy.sh` from the laptop (build → rsync → migrate → restart → verify AASA).

## Why these mechanisms

- **systemd, not PM2** — already installed, survives reboot without `pm2 startup`, journald
  rotates logs, no Node process supervising a Node process. (runbook §5)
- **The access log is `console.log` to journald, not Sentry** (decision-23) — it must work
  on a box with no Sentry credential, which is the state this ships in. Sentry adds the
  correlation (one trace across phone and server); journald is the floor that never
  depends on a third party being reachable.
- **`ExecStart` carries `--import /srv/nfc/instrument.mjs`** — required, not cosmetic. The
  server is ESM; importing the instrumentation from inside `server.js` runs after `pg` and
  `node:http` are loaded, which silently disables all tracing.
- **systemd timer, not pg_cron** — pg_cron needs an extension install, a
  `shared_preload_libraries` edit and a **database restart**. That is a scheduled outage for
  one `UPDATE`.
- **systemd timer, not `setInterval` in the API** — an in-process interval dies with the API
  process, which is exactly when the safety net is needed. A crash on Friday evening would
  leave every open shift running all weekend.
- **`Persistent=true` on both timers** — a reboot across a window causes a catch-up run
  instead of a silently skipped one. Safe because `autoclose.sql` is idempotent.

## Verification checklist

- [ ] `ss -tlnp | grep 5432` shows no public bind
- [ ] `ls -l /etc/nfc/env` is `0640 root:app`; secrets never echoed into a shell transcript
- [ ] `systemctl status nfc-api` active, and still active after `reboot`
- [ ] `journalctl -u nfc-api | grep '\[req\]'` shows request lines, and NONE of them
      contains a `/portal/` token, a cookie, an email or the app key
- [ ] the API is active with `SENTRY_DSN` absent from `/etc/nfc/env` — that is a supported
      state, not a misconfiguration (decision-23)
- [ ] API answers on its port; `/.well-known/apple-app-site-association` returns
      `Content-Type: application/json` (decision-4)
- [ ] `systemctl list-timers 'nfc-*'` lists both timers with a future NEXT
- [ ] `systemctl start nfc-autoclose.service` exits 0 and logs an `UPDATE <n>` line
- [ ] `./ops/check-autoclose.sh` passes (run 1 → 1 row, run 2 → 0 rows)
- [ ] `/var/backups/nfc` contains a dated `.sql.gz` > 200B that passes `gzip -t`
- [ ] `restore-test.sh` has passed **at least once** — date recorded
- [ ] `curl -s https://timesheets.exe.xyz/ | head` returns the admin export, not `not_found`
      (i.e. `/srv/nfc/public/index.html` exists)
- [ ] `TODO(offsite)` in `pg-backup.sh` resolved: a provider chosen, credentials placed, and
      the offsite copy restore-tested by pulling it back down (`DUMP=... restore-test.sh`)
