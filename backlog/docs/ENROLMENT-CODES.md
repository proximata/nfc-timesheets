# Getting a worker's phone signed in

For the director. No technical knowledge assumed. Written **2026-08-03**, Vienna time.

Everything below was checked against a real database and a real running server, not against a
description of one. Where a report and the software disagreed, the software won.

The panel is at **https://timesheets.exe.xyz**, on the **Mitarbeiter** screen.

---

## Read this first — two things are blocking

### 1. This is not live yet. Nothing in this document works this afternoon.

The server running at timesheets.exe.xyz today does not have the enrolment code feature in it
at all. I checked the live server directly: the enrolment address answers "no such thing".
The iPhone sign-in address answers normally, so the live server is healthy — it is simply the
older version.

**Needed:** one deployment. Nothing else. Until then the **Zugangscode** column and its
buttons do not exist on the screen you will open.

### 2. There is still no Android app to type a code into.

This is the larger of the two, and it is not fixed by deploying.

The Android app has **never been compiled**. There is no installable file, it is not in the
Play Store, and it has never run on a real handset — not once, not by anyone. The
code-typing screen has been written and its logic has been tested, but **no human being has
ever seen it on a phone.**

So after the deployment the position will be:

- The admin panel can create, show, and block enrolment codes. ✅
- The server accepts a correct code and signs the phone in. ✅ (proven end to end)
- There is nothing for an Android worker to install. ❌

**In plain terms:** enrolment codes are ready and the machinery behind them is proven, but
an Android-owning cleaner still cannot clock in, because there is still no app on their
phone. Deploying is worth doing anyway — it puts the admin side in place and changes nothing
for the iPhone users — but it does not by itself put an Android worker to work.

---

## What this is for

Until now the only way into the app was **Sign in with Apple**, which needs an iPhone and an
Apple account. A cleaner with an Android phone had no way in at all, and asking someone to
buy an iPhone in order to be paid is not a reasonable thing to ask.

So there are now **two ways in, one worker record, one set of hours**. Nothing about payroll,
shifts or reports changes. It is only the front door that differs.

| The worker has | How they sign in | What you do |
|---|---|---|
| An iPhone | Sign in with Apple, using their email address | Nothing new — exactly as today |
| Any other phone | Types a short code once | Create a code and read it to them |

**The email address is still needed in both cases.** It is how the iPhone route identifies
the person, and it stays in the worker record regardless.

---

## Enrolling a worker on an iPhone — unchanged

Nothing here is different from today, and nothing about the iPhone app was touched. It is
live and in daily use, and it stays that way.

1. **Mitarbeiter** → make sure the person's **E-Mail-Adresse** is exactly right.
2. The worker installs the app and taps **Sign in with Apple**.
3. They are signed in.

If Apple gives them a hidden address (something ending `privaterelay.appleid.com`), the app
shows that address on screen. The worker reads it to you and you paste it into their email
field. Then they try again. This is the only fiddly part, and it has not changed.

**Do not issue an enrolment code to an iPhone user out of habit.** It works, but it is one
more thing to go wrong for no benefit.

---

## Enrolling a worker on an Android or any other phone

*(Once there is an app to install — see blocker 2.)*

1. Go to **Mitarbeiter**.
2. Find the person. In the **Zugangscode** column press **Zugangscode erstellen**.
3. A panel appears at the top of the screen with a code like:

   > **97531**

4. **Write it down or press "Zugangscode kopieren" now.** This is the only time it is ever
   shown. It cannot be looked up afterwards — not by you, not by anyone, not from the
   database. This is deliberate.
5. Phone the worker and read it out.
6. They open the app for the first time and type it in. That is it — their phone is signed in
   and stays signed in.

### If you lose the code before reading it out

Press **Neuen Zugangscode erstellen**. The old one dies the instant the new one is created,
so there is never more than one live code per person and no confusion about which is current.
Creating codes is free — do it as often as you like.

### The code is easy to read down a bad line, on purpose

It is **five digits and nothing else** — no letters, no dash (decision-63). There is nothing
left to mishear as a letter, so the old "O becomes 0" handling is gone with the letters.

- Spaces and dashes typed out of habit are still ignored: "12 3-45" is accepted.
- Anything containing a letter is simply wrong now, and is refused like any wrong code.

### The code expires after 15 minutes

This is SHORT, and deliberately so: five digits are only safe because the window is small
(decision-63). **Read the code out while you are already on the phone with the person, with
the app open in front of them.** Do not create it in the morning for an afternoon call.

If the 15 minutes run out, the column says **"Am … abgelaufen, nicht verwendet"** and you
simply create a new one — one click, as often as you like.

---

## What the worker sees

1. They open the app for the first time.
2. One screen, one box, asking for the code.
3. They type it and are signed in — their name appears and they can start recording hours.
4. **They never do this again.** The phone stays signed in for about three months of
   inactivity, and every clock-in resets that. In practice a working cleaner never sees the
   screen twice.

If they type it wrong, they get one message: **the code was not accepted.** It never says
"expired" or "already used" or "nearly right". That is intentional — anything more specific
would help a stranger guess a real code.

After several wrong attempts the app makes them wait, and the wait gets longer each time, up
to fifteen minutes. This is the protection that makes a short code safe, so it cannot be
turned off. It is worth telling a worker "type it carefully" rather than letting them guess.

---

## The "Zugangscode" column — did I already send Ivan a code?

This is the question the column exists to answer.

| What it says | What it means | What to do |
|---|---|---|
| **Kein Zugangscode** | Never had one, or it was blocked | Create one if they need it |
| **Gültig bis 15:32** | A live code is out there right now | Nothing — wait for them |
| **Am … abgelaufen, nicht verwendet** | The hour ran out; nobody used it | Create a new one |
| **App eingerichtet am …** | Done. Their phone is signed in | Nothing |
| **Inaktiv – kein Zugangscode möglich** | The person is deactivated | Reactivate first if they are back |

The times shown are Vienna time, always — not the time zone of whatever laptop you happen to
be using. The column re-checks the clock about twice a minute, so a code that has just run
out stops claiming to be valid.

---

## When a code goes to the wrong person

This is the expected accident, not an exotic one. You read a code down the phone; codes get
misheard, forwarded, or read to the wrong person entirely. There are **two different
situations** and they need **two different actions**. Getting this wrong is the one real
trap in the whole feature.

### Situation A — they have not used it yet

The column still says **"Gültig bis …"**.

➡️ Press **Zugangscode sperren**.

The code stops working instantly. There is nothing else to do. Then create a new one for the
right person.

### Situation B — they have already used it

The column says **"App eingerichtet am …"**.

➡️ **"Zugangscode sperren" will NOT help you here.** The code is already gone — it can only
be used once, and it was. Blocking it does nothing, because the phone that used it is now
signed in on its own.

➡️ Press **Deaktivieren** on that worker instead.

That signs out every phone holding that person's identity, immediately, and stops any further
hours being recorded. Then press **Wieder aktivieren** and issue a fresh code to the right
person.

**The short version:** *not used yet → block the code. Already used → deactivate the worker.*

### Do you need to worry about someone guessing a code?

No, and this was sized deliberately rather than hoped for.

A code is **five digits — one of 100,000 possibilities**, and it is **alive for 15 minutes**,
not a day and not a week. Those two numbers were chosen together (decision-63): the short code
is only safe because the window is short.

One computer guessing gets **three tries**, then has to wait — 30 seconds, then a minute, then
longer, up to a quarter of an hour. Over one code's whole 15-minute life that is about seven
guesses, so the chance of landing one is roughly **one in fourteen thousand**.

Someone attacking from many computers at once is capped differently: the server answers at
most **15 code attempts a minute in total, from everybody combined**, so 225 guesses over a
code's life — about **one in 444**, or one in nine in the never-actually-happens case where
fifty codes are live for the full fifteen minutes. That is weaker than the old eight-character
code was, and it is a trade the owner made knowingly in exchange for five digits that can be
read out over the phone. If that ceiling is ever reached, the server raises an alert by
itself — it is not a number normal use can come near.

The code is never written into any log or error report anywhere. I generated eighteen real
codes, drove them through a real server, and searched every line it produced: none of them
appeared. The database stores only a scrambled fingerprint of the code, never the code
itself, so even a stolen copy of the database does not hand anyone a way in.

---

## What still cannot be done

Honestly, and in rough order of how much it will cost you:

1. **An Android worker still cannot clock in.** There is no installable app. This is the
   whole point of the feature and it is not finished. (Blocker 2 above.)
2. **Nothing is deployed.** (Blocker 1 above.)
3. **A code cannot be looked up after it is shown.** By design. If you lose it, create
   another — but there is no "show it again" and there never will be.
4. **A code cannot be sent to the worker by the system.** No SMS, no email. You read it out
   or message it yourself. There is no send button.
5. **The panel cannot tell you who used a code, or from where.** It records who created it
   and when, and when it was used, but not which phone or which person typed it. If a code
   reaches the wrong hands, deactivating the worker is the remedy — the panel will not
   identify the culprit for you.
6. **You cannot set how long a code lasts.** It is 15 minutes for everyone (decision-63).
7. **Codes cannot be created in bulk.** One worker at a time, one button each. With twenty
   staff this is fine; it would not be at two hundred.
8. **iPhone users cannot use a code instead of Apple**, even if the Apple route is annoying
   them. Deliberate, while the iPhone pilot is running — one live sign-in route, changed at
   one time, or a bad day becomes impossible to diagnose.

---

## What I verified, so you know how much to trust the above

Against a real Postgres database shaped like the live one (one Apple-enrolled worker, one
building, five shifts):

- The database upgrade applies cleanly over live-shaped data and **the existing iPhone worker
  still signs in afterwards.** Their record is untouched.
- **The iPhone app has zero changes** — not one file, including the project file. The Apple
  sign-in code is byte-for-byte identical to what is live today.
- A wrong code, an expired code, an already-used code, a blocked code, a nonsense code and a
  code belonging to a deactivated worker all produce **exactly the same answer**, down to the
  last byte and every header. I compared the real responses; there is nothing to learn from
  the difference, because there is no difference.
- **Sixteen simultaneous attempts to use the same code produced exactly one sign-in** and
  fifteen refusals. Two people cannot share one code.
- The attempt limits genuinely trip, including against someone changing their address to
  dodge them.
- **The real Android code, compiled and run, produced a request the real server accepted**,
  signing in the right worker — including when the code was typed sloppily in lower case with
  a space instead of the dash.
- The Android and server interpretations of a typed code were compared across **3,047
  different inputs** and agreed on every single one.
- The German and English wording match exactly: 493 phrases each, no gaps.
- Timing was measured: the server does not take measurably longer on a real-but-expired code
  than on one that never existed.

Two defects were found and fixed during this check: a telemetry test that had been silently
passing without actually testing anything, and a placeholder value in the Android tests that
tripped the secret scanner. Both are fixed and everything now passes.

**Not verified, because it cannot be here:** anything requiring an actual Android handset.
The sign-in screen has never been displayed, never been used with a real keyboard, never
tested with a screen reader or at large text sizes, and the app has never been built. That
gap closes only on a real device.
