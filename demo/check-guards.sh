#!/bin/sh
# The runnable check for demo/: prove the four refusals still refuse.
#
#   sh demo/check-guards.sh
#
# These guards are the only thing standing between a tired copy-paste and either
# TRUNCATEing the live payroll database or recording a "demo" of real workers' hours. A
# guard nobody exercises is a comment. This runs each one for real and fails loudly.
#
# Needs a local Postgres. Skips with exit 0 when there is none, like every other check here.
set -e
cd "$(dirname "$0")/.."

fails=0
ok()   { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }

# 1 + 2 need a database that is NOT called nfc_demo.
if ! pg_isready -q 2>/dev/null; then
  echo "check-guards: no Postgres reachable — SKIP (database guards untested)"
  DB=""
else
  DB="nfc_guardcheck_$$"
  createdb "$DB"
  trap 'dropdb --if-exists "$DB" >/dev/null 2>&1' EXIT
  DATABASE_URL="postgres:///$DB" node server/db/migrate.js >/dev/null

  if psql -q -d "$DB" -v ON_ERROR_STOP=1 -f demo/seed.sql >/dev/null 2>&1; then
    fail "demo/seed.sql TRUNCATED a database that is not nfc_demo"
  else
    ok "demo/seed.sql refuses a database that is not nfc_demo"
  fi

  # ...and the refusal must be a refusal, not a crash after the damage. workers is the
  # first table the seed writes, so an untouched empty table proves nothing ran.
  if [ "$(psql -tAc 'SELECT count(*) FROM workers' -d "$DB")" = "0" ]; then
    ok "demo/seed.sql wrote nothing before refusing"
  else
    fail "demo/seed.sql wrote rows before refusing"
  fi

  if DATABASE_URL="postgres:///$DB" node demo/make-admin.mjs >/dev/null 2>&1; then
    fail "demo/make-admin.mjs created an admin outside nfc_demo"
  else
    ok "demo/make-admin.mjs refuses a database that is not nfc_demo"
  fi
fi

# 3, 4, 5: the three scripts that could be pointed at the live host.
if DEMO_BASE=https://timesheets.exe.xyz node demo/record-admin.mjs >/dev/null 2>&1; then
  fail "demo/record-admin.mjs accepted a non-loopback target"
else
  ok "demo/record-admin.mjs refuses a non-loopback target"
fi

if DEMO_API=https://timesheets.exe.xyz node demo/record-android.mjs >/dev/null 2>&1; then
  fail "demo/record-android.mjs accepted a non-loopback target"
else
  ok "demo/record-android.mjs refuses a non-loopback target"
fi

if node demo/tls-front.mjs --upstream 10.0.0.1:80 >/dev/null 2>&1; then
  fail "demo/tls-front.mjs accepted a non-loopback upstream"
else
  ok "demo/tls-front.mjs refuses a non-loopback upstream"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "check-guards: OK"
else
  echo "check-guards: $fails FAIL"
  exit 1
fi
