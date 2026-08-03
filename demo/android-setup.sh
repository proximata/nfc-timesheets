#!/bin/sh
# Point the SHIPPING Android debug build at the LOCAL demo server, without changing one
# line of the app.
#
#   sh demo/android-setup.sh
#
# The APK built here is byte-for-byte the one `./gradlew :app:assembleDebug` produces:
# `branding.properties` is untouched, so `BuildConfig.TAG_HOST` is still
# `timesheets.exe.xyz` and the tag URL in the recording is the real tag URL off the wall.
# Everything below happens INSIDE THE EMULATOR.
#
# Three problems, three fixes:
#
#   1. `Api.kt` builds its base URL as `https://${BuildConfig.TAG_HOST}` — correct, and not
#      going to be weakened for a recording. So the demo needs real TLS on port 443 of a
#      host called `timesheets.exe.xyz`.
#   2. macOS will not let a normal user bind port 443. `adb reverse` binds the port on the
#      EMULATOR, where adbd is root, and forwards it to the Mac's 8443. No sudo, no
#      /etc/hosts edit on the Mac, nothing outside the emulator.
#   3. The demo certificate is self-signed, and an app targeting API 24+ ignores the user
#      certificate store. So the demo CA is bind-mounted into the system store, in the
#      emulator only, for the life of that emulator.
#
# NOTHING HERE TOUCHES THE MAC and nothing survives an emulator restart. Re-run it after
# every cold boot of the AVD.
set -e

ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ADB="$ANDROID_HOME/platform-tools/adb"
TLS_DIR="${TLS_DIR:-/tmp/ts-demo/tls}"
PKG=io.github.qwadratic.NFCTimeSheets
APK="${APK:-android/app/build/outputs/apk/debug/app-debug.apk}"

[ -f "$TLS_DIR/ca.pem" ] || { echo "no CA at $TLS_DIR/ca.pem — see backlog/docs/DEMO.md §2"; exit 1; }
[ -f "$APK" ] || { echo "no APK at $APK — run ./gradlew :app:assembleDebug first"; exit 1; }

HASH=$(openssl x509 -subject_hash_old -noout -in "$TLS_DIR/ca.pem")
echo "demo CA hash: $HASH"

echo "== waiting for a fully booted emulator =="
"$ADB" wait-for-device
while [ "$("$ADB" shell getprop sys.boot_completed | tr -d '\r')" != "1" ]; do sleep 3; done
# boot_completed fires before the package service is actually usable on a loaded host, and
# an install into that window is what killed system_server twice while this was written.
while [ "$("$ADB" shell pm list packages 2>/dev/null | wc -l | tr -d ' \r')" -lt 100 ]; do sleep 5; done

echo "== installing the debug APK (before any namespace surgery) =="
"$ADB" install -r "$APK" >/dev/null
"$ADB" shell cmd locale set-app-locales "$PKG" --user current --locales de-AT || true

echo "== root, and SELinux permissive so a bind mount is allowed =="
"$ADB" root >/dev/null 2>&1 || true
sleep 3
"$ADB" wait-for-device
"$ADB" shell setenforce 0

echo "== staging the system CA store with the demo CA added =="
"$ADB" push "$TLS_DIR/ca.pem" /data/local/tmp/demo-ca.pem >/dev/null
"$ADB" shell "mkdir -p /data/local/tmp/cacerts \
  && cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cacerts/ \
  && cp /data/local/tmp/demo-ca.pem /data/local/tmp/cacerts/$HASH.0 \
  && chmod 644 /data/local/tmp/cacerts/* && chown root:root /data/local/tmp/cacerts/*"

echo "== staging a hosts file that sends timesheets.exe.xyz to the emulator's loopback =="
"$ADB" shell 'printf "127.0.0.1 localhost\n::1 ip6-localhost\n127.0.0.1 timesheets.exe.xyz\n" > /data/local/tmp/hosts'

echo "== binding both into init and zygote, so apps inherit them =="
# Apps are forked from zygote and inherit ITS mount namespace, so a bind mount made in the
# adb shell alone is invisible to the app. init (pid 1) is included so the mounts survive a
# zygote restart, which the watchdog does cause on a slow host.
"$ADB" shell "for p in 1 \$(pidof zygote) \$(pidof zygote64); do
    nsenter --mount=/proc/\$p/ns/mnt -- /bin/mount --bind /data/local/tmp/cacerts /apex/com.android.conscrypt/cacerts
    nsenter --mount=/proc/\$p/ns/mnt -- /bin/mount --bind /data/local/tmp/hosts /system/etc/hosts
  done"

echo "== forwarding the emulator's port 443 to the Mac's TLS front on 8443 =="
"$ADB" reverse tcp:443 tcp:8443

echo
echo "ready. verify with:"
echo "  adb shell cat /system/etc/hosts"
echo "  adb shell ls /apex/com.android.conscrypt/cacerts | wc -l   # one more than stock"
