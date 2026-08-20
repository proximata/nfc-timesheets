# SURFACE PROBE — what a human sees and reaches, re-measured

Adversarial re-test of the surface layer at `425b284`. Everything below was measured this
session against a local stack (`DB nfc_demo`, API on `:8080`, `PUBLIC_DIR=web/out` built WITH
the real Maps key). Production was read only, never written.

`backlog/docs/RECON.md` is treated as **evidence to re-test, not findings to repeat**. Two of
its claims did not survive.

---

## 0 · Verdict

```
the grey pin       ✓ OBSERVED. RECON H2 is WRONG — it is not the key, it was the PORT.
the maps key       ✗ NOT authorised for the API host. Production has no key at all.
                     Adding it to deploy.sh does NOT fix it — Google's allowlist must change.
the two hosts      ✓ live, 0 redirects, right content types; collapse mutation goes RED
android checks     ✓ core-check OK, known-tags-check OK (and there IS a runner: checks/run.sh)
```

---

## 1 · The grey pin — RECON H2 overturned

RECON H2 says the grey pin "has NEVER been observed", 12 assertions SKIPPED, cause
*"the key is referrer-restricted and rejects 127.0.0.1"*.

**That is false.** The key allowlists `http://127.0.0.1:8080/*` and nothing else on loopback.
RECON's rebuild ran the API on a different port, got `RefererNotAllowedMapError`, and wrote the
symptom down as a property of the key. `README.md` § Checks already says this in as many words.

Measured, `BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs`:

```
1680/dark   / a pin is grey and SAYS the word, or it is neither
            5 pins drawn · 1 unzoned+pinnable · 1 grey · 1 carrying the word      ok
1680/dark   / the info box hangs off a pin that is grey AND says the word
            306px, grey=true, word=true — Wohnhaus Wagramer Strasse                ok
1680/light  identical                                                             ok
1440/dark   identical                                                             ok
1440/light  identical                                                             ok
```

`224 ok · 0 FAIL · 4 SKIP`. The 4 remaining skips are both map assertions at **390 only**, and
they are principled, not silent: the map is collapsed on a phone by design and the Objektliste
IS the surface there — which the probe asserts separately and passes (2/2 unzoned rows carry the
sentence at both themes).

So decision-43's *colour is the second signal* is now **proven on the map**, not just in the
Objektliste. It was provable all along.

## 2 · The Maps key — the finding RECON's B5 stopped one step short of

`node demo/check-map-key.mjs`:

```
FAIL  https://schimmer-glanz.exe.xyz/   apiHost — serves the admin panel
      canvas=0 pins=0 RefererNotAllowedMapError
```

Two separate facts, and only the first is in RECON:

1. production ships **no key at all** — `ops/deploy.sh` never sets
   `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, so the bundle has no `AIza…`;
2. **the key would not work if it did.** The browser key's HTTP-referrer allowlist does not
   contain `https://schimmer-glanz.exe.xyz/*`.

∴ RECON rank 4 — *"Ship the maps key in `ops/deploy.sh`. One line."* — is **wrong as written**.
One line in `deploy.sh` produces a bundle that loads Maps and is refused by Google. The fix is
two steps and the console step is not in this repo:

```
Google Cloud console → APIs & Services → Credentials → the browser key
  → Application restrictions → Websites → add  https://schimmer-glanz.exe.xyz/*
  → KEEP  http://127.0.0.1:8080/*   (every local map check runs against it)
then  ops/deploy.sh: export NEXT_PUBLIC_GOOGLE_MAPS_KEY=…
```

`demo/check-map-key.mjs` already asks exactly this question under the real hostname and is
already RED. It is not greppable — a key restriction is not in the tree — so this check is the
only thing that can see it.
