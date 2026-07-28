# Runbook: VM Provisioning (reusable across projects)

Status: reusable reference. **Not currently on the critical path for NFC TimeSheets** —
`research/decision-brief.md` recommends retiring the VM in favour of Supabase + Cloudflare.
Kept because (a) it is the ≤1-day fallback if Supabase disappoints, and (b) it is reusable
for other projects.

Target platform: exe.dev VM, Debian/Ubuntu, Node 22+, Postgres 16.
Constraints carried from decisions: **no Docker** (decision-1).

---

## 0. Conventions

| Item | Value |
|---|---|
| App user | `app` (non-root, no login shell) |
| App dir | `/srv/<project>` |
| Secrets file | `/etc/<project>/env` — root-owned, `0600` |
| Process manager | systemd (preferred) — see §5 for why over PM2 |
| DB | Postgres on localhost, unix socket, no public port |

---

## 1. Provision + base hardening

```bash
ssh <host>

adduser --system --group --home /srv/<project> --shell /usr/sbin/nologin app
apt-get update && apt-get install -y curl ca-certificates gnupg ufw fail2ban

ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80 && ufw allow 443
ufw --force enable
```

Postgres must never listen publicly. Verify:
```bash
ss -tlnp | grep 5432   # expect 127.0.0.1 only, or no TCP at all (unix socket)
```

## 2. Node + Postgres

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
apt-get install -y postgresql-16 postgresql-contrib-16
corepack enable && corepack prepare pnpm@latest --activate   # decision-3: pnpm
```

DB + role:
```bash
sudo -u postgres createuser --pwprompt <project>
sudo -u postgres createdb -O <project> <project>
```

## 3. Secrets: local psst vault → VM

**Do not `scp -r .psst/` to the server.** Three reasons:
1. `.psst/envs/` is **plaintext at rest** unless `psst lock` has been run — an `scp` of the
   directory copies readable secrets and leaves them readable.
2. It ships the *whole* vault, including dev-only and unrelated secrets. The VM should
   receive only what it runs with.
3. It puts a second copy of the vault on a box with a wider attack surface than the laptop.

Instead: **export the scoped subset, stream it over ssh stdin, never touch disk in between.**

Tag secrets by destination once:
```bash
psst tag DATABASE_URL server prod
psst tag APP_KEY     server prod
```

There is no `ADMIN_PIN` to push (decision-20). The web admin authenticates against a
password hash in the `admins` table; seed the first one **on the VM** after the first
deploy with `node /srv/nfc/bin/create-admin.js`, which reads the password from a tty and
never writes it to disk, to the environment, or to shell history.

Push (streams through stdin — no temp file on either side):
```bash
psst --tag server export \
  | ssh <host> 'install -d -m 0750 -o root -g app /etc/<project> \
      && install -m 0640 -o root -g app /dev/stdin /etc/<project>/env'
```

`0640 root:app` = app user reads it, nobody else does. Verify:
```bash
ssh <host> 'ls -l /etc/<project>/env && wc -l < /etc/<project>/env'
```

Rotation is the same command again — it overwrites atomically via `install`.

**Never** `echo`/`cat` the file in a shell an agent is reading; the values land in the
transcript. Check counts and permissions, not contents.

### Local hygiene
```bash
psst lock                      # encrypt vault at rest when not in use
psst install-hook              # pre-commit secret scan
echo '.psst/envs/' >> .gitignore
```

## 4. Deploy

```bash
# on laptop
pnpm build && rsync -az --delete ./dist/ <host>:/srv/<project>/
```

Prefer rsync of a built artifact over `git pull` on the server — keeps git credentials and
build toolchain off the VM.

## 5. systemd service (not PM2)

decision-1 allowed either. Prefer systemd: it is already installed, survives reboot without
a `pm2 startup` dance, has journald log rotation built in, and adds no runtime dependency.
PM2 is a Node process supervising Node processes — one more thing that can die.

`/etc/systemd/system/<project>.service`:
```ini
[Unit]
Description=<project> API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=app
WorkingDirectory=/srv/<project>
EnvironmentFile=/etc/<project>/env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

# hardening — cheap, no downside for a plain Node service
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/<project>

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now <project>
systemctl status <project> && journalctl -u <project> -f
```

## 6. Backups — do not skip

The finding that killed Supabase free tier applies here too: **a VM with no backup story is
worse than a managed DB with none**, because you also own the hardware failure.

```bash
# /etc/cron.daily/<project>-backup
sudo -u postgres pg_dump <project> | gzip > /var/backups/<project>-$(date +\%F).sql.gz
find /var/backups -name '<project>-*.sql.gz' -mtime +14 -delete
```

Offsite copy is required for payroll data — a dump sitting on the same disk as the DB is not
a backup. Restore-test it once; an untested backup is a guess.

## 7. Checklist

- [ ] ufw enabled, Postgres not publicly bound
- [ ] app user non-root, nologin shell
- [ ] `/etc/<project>/env` is `0640 root:app`
- [ ] vault locked locally, `.psst/envs/` gitignored, pre-commit hook installed
- [ ] systemd unit enabled, survives `reboot`
- [ ] daily pg_dump + offsite copy + **one tested restore**
