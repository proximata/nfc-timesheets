# server/releases

Served by `routes/release.js` (`GET /app/version`, `GET /app/download`). See
`server/README.md` § "App self-update" for the full contract.

This directory is empty in git on purpose: an APK is a binary artifact, not source, and
does not belong in version control any more than `web/out/` does. Getting a real build here
is a **deploy** step (not built by this task — `sql/` and `server/` only, and this
iteration deploys nothing):

```
releases/latest.json                              <- the manifest GET /app/version reads
releases/nfc-timesheets-<version>-<code>-release.apk  <- whatever latest.json's "file" names
```

`latest.json` shape:

```json
{
  "version_code": 5,
  "version_name": "0.4.0",
  "file": "nfc-timesheets-0.4.0-5-release.apk",
  "sha256": "…",
  "notes": "…"
}
```

Only `version_code` (a positive integer) and `file` (a non-empty string) are required. A
missing or malformed manifest is read as "nothing published yet" (`{published: false}`),
never a 500 — the update check must survive an empty or half-written directory.

Override the directory with the `RELEASES_DIR` environment variable, the same idiom
`PUBLIC_DIR` already uses — `server/check-api.js` points it at a scratch directory with a
fixture manifest so the self-check never touches a real APK.
