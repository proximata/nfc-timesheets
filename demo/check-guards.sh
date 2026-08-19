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

# A server that REFUSES exits. A server whose guard is missing starts and LISTENS FOREVER,
# so a plain `if cmd; then fail; else ok; fi` does not fail on a missing guard - it hangs,
# which is how a removed guard once sat undetected for 39 minutes looking like a slow test.
# Surviving 5 s therefore IS the failure, and is reported as one.
must_refuse() {
  desc=$1; shift
  "$@" >/dev/null 2>&1 &
  pid=$!
  n=0
  while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n + 1)); done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    fail "$desc (it STARTED instead of refusing)"
  else
    if wait "$pid" 2>/dev/null; then
      fail "$desc (it exited 0 instead of refusing)"
    else
      ok "$desc"
    fi
  fi
}

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

  # make-admin's own check is `SELECT current_database()`, which answers only AFTER
  # connecting -- and what it connects to can be the live host. Same two vectors.
  #
  # These two assert the REFUSAL MESSAGE, not merely a non-zero exit, and that is not
  # fussiness. With the guard deleted, make-admin still exits non-zero here -- because it
  # dials timesheets.exe.xyz:5432 and the connection dies. `if cmd` therefore reported ok
  # for a build that had ALREADY left the machine; the test passed because the network was
  # unreachable, not because anything refused. Matching the wording is what makes these
  # fail when the guard is removed.
  refuses_with() {
    desc=$1; want=$2; shift 2
    out=$("$@" 2>&1 </dev/null || true)
    case "$out" in
      *"$want"*) ok "$desc" ;;
      *) fail "$desc (no refusal: $(printf '%s' "$out" | head -1))" ;;
    esac
  }

  refuses_with "demo/make-admin.mjs refuses a ?host= that overrides the URL host" \
    "refusing DATABASE_URL ?host=" \
    env DATABASE_URL='postgres://127.0.0.1/nfc_demo?host=timesheets.exe.xyz' node demo/make-admin.mjs

  refuses_with "demo/make-admin.mjs refuses a non-loopback \$PGHOST" \
    'refusing $PGHOST=' \
    env DATABASE_URL=postgres:///nfc_demo PGHOST=timesheets.exe.xyz node demo/make-admin.mjs

  # demo-server.mjs accepts FORGED Apple identity tokens (that is the point of it - a
  # simulator has no Apple ID). The only thing keeping that off a real database is this
  # refusal, so it is exercised twice: wrong name, and right name on a remote host.
  must_refuse "demo/demo-server.mjs refuses a database that is not nfc_demo" \
    env DATABASE_URL="postgres:///$DB" APP_KEY=x PORT=0 node demo/demo-server.mjs
fi

must_refuse "demo/demo-server.mjs refuses a non-loopback database host" \
  env DATABASE_URL=postgres://timesheets.exe.xyz/nfc_demo APP_KEY=x PORT=0 node demo/demo-server.mjs

# The two ways the DRIVER's host differs from the URL's host. Both of these reached
# timesheets.exe.xyz:5432 while the old guard read the hostname as "" or "127.0.0.1" --
# verified by intercepting net.Socket.connect, not by reading pg's source. A guard that
# reads a different value than the driver does is not a guard, so both are exercised.
must_refuse "demo/demo-server.mjs refuses a ?host= that overrides the URL host" \
  env DATABASE_URL='postgres://127.0.0.1/nfc_demo?host=timesheets.exe.xyz' APP_KEY=x PORT=0 node demo/demo-server.mjs

must_refuse "demo/demo-server.mjs refuses a non-loopback \$PGHOST" \
  env DATABASE_URL=postgres:///nfc_demo PGHOST=timesheets.exe.xyz APP_KEY=x PORT=0 node demo/demo-server.mjs

must_refuse "demo/demo-server.mjs refuses to listen on a non-loopback address" \
  env DATABASE_URL=postgres:///nfc_demo APP_KEY=x PORT=0 node demo/demo-server.mjs --host 0.0.0.0

# 3, 4, 5: the three scripts that could be pointed at the live host.
# (must_refuse is defined near the top of this file.)
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

if DEMO_API=https://timesheets.exe.xyz node demo/record-ios.mjs >/dev/null 2>&1; then
  fail "demo/record-ios.mjs accepted a non-loopback target"
else
  ok "demo/record-ios.mjs refuses a non-loopback target"
fi

# BOTH tls-front checks go through must_refuse and not through `if cmd`. This is the one
# process here that LISTENS when its guard is missing: with the check written the plain
# way, deleting the guard made check-guards hang forever instead of failing.
must_refuse "demo/tls-front.mjs refuses a non-loopback upstream" \
  node demo/tls-front.mjs --upstream 10.0.0.1:80

# The LISTEN side, not only the upstream. This one bound 0.0.0.0 and published a server
# that mints Apple identity tokens onto the LAN; `https://<mac-lan-ip>:8443/` answered 200.
must_refuse "demo/tls-front.mjs refuses to listen on a non-loopback address" \
  node demo/tls-front.mjs --host 0.0.0.0

# The iOS build is the one that could be pointed at the live host by a build setting.
if DEMO_TAG_HOST=timesheets.exe.xyz sh demo/ios-setup.sh >/dev/null 2>&1; then
  fail "demo/ios-setup.sh built against a non-loopback tag host"
else
  ok "demo/ios-setup.sh refuses a non-loopback tag host"
fi

# EVERY CHECK IN demo/ MUST AT LEAST PARSE.
#
# Two of them did not, for a whole round. Both had a comment written INSIDE a
# `page.eval(\`...\`)` template literal containing a backtick, which ends the string; the
# files then threw `SyntaxError: missing ) after argument list` at import time. Nobody saw
# it, because a check that dies before its first assertion prints a stack trace and exits
# non-zero, which looks exactly like a check that ran and found a defect — and the round's
# report recorded them as "fixed".
#
# `node --check` is the whole test. It costs a few milliseconds per file and it is the
# difference between "this check found nothing" and "this check never ran".
unparseable=""
checked=0
for f in demo/*.mjs; do
  checked=$((checked + 1))
  node --check "$f" >/dev/null 2>&1 || unparseable="$unparseable $f"
done
if [ "$checked" -lt 10 ]; then
  fail "only $checked file(s) in demo/*.mjs — the glob matched nothing, so this proves nothing"
elif [ -n "$unparseable" ]; then
  fail "demo/*.mjs does not parse:$unparseable"
else
  ok "all $checked demo/*.mjs parse"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "check-guards: OK"
else
  echo "check-guards: $fails FAIL"
  exit 1
fi
