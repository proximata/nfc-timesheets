// W5 — SMS login. LAST, and alone: it replaces the mechanism every worker currently uses.
export const meta = {
  name: 'w5_twilio_sms',
  description: 'Phone-number sign-in by SMS one-time code, replacing enrolment codes, with the cost and lockout risks made explicit.',
  phases: [{ title: 'Design' }, { title: 'Build' }, { title: 'Verify' }]
};

const MODEL = 'anthropic/claude-opus-5';
const REPO = '/Users/gerhardgustav/Desktop/ai-automations/hoiv/cleaning-timesheets';

const BASE = `
PROJECT: NFC TimeSheets, Vienna cleaning company. REPO: ${REPO}.
API + admin: https://schimmer-glanz.exe.xyz. W1-W4 have shipped: operators and workers are
identified by phone in one namespace, the app updates itself, tags are onboarded from the phone,
and a building owner has read-only access.

READ FIRST: AGENTS.md · backlog/decisions/ (decision-26 chose admin-issued enrolment codes and
explains WHY Google sign-in was rejected) · OPERATOR-MODEL.md · tasks 119-126, which already plan
this work — read them before designing, and say where you diverge.

STYLE: terse and technical. Lazy-senior-dev ladder. Mark shortcuts \`ponytail:\`. Never simplify
away validation at trust boundaries, error handling that prevents data loss, security, or
accessibility. No time estimates.

CREDENTIALS: psst holds TWILIO_SID, but it is an SK-prefixed API Key — TWILIO_ACCOUNT_SID (AC...)
plus either TWILIO_FROM (an Austrian number) or TWILIO_MESSAGING_SID (MG...) are still MISSING.
Secrets reach the VM only via ops/sync-secrets.sh, which enumerates the psst tag 'server' ONLY:
an untagged secret is silently skipped. \`psst export --tag\` is BROKEN and dumps the whole vault.

AUSTRIA: a Twilio trial texts only verified numbers; Austrian carriers filter US long codes, so a
local number or a registered alphanumeric sender is needed. An unthrottled OTP endpoint spends the
owner's money.

CONSTRAINTS: no new npm dependency — Twilio is one HTTPS POST, do NOT add the SDK · COMMIT AS YOU
GO · a check whose negative case cannot fail is not a check · </dev/null on backlog commands ·
absolute /usr/bin/grep, /bin/ls, /usr/bin/git · stage EXPLICIT paths.
`;

phase('Design');
const design = await agent(`${BASE}

Design SMS sign-in, and be honest about what it replaces.

 - Enrolment codes WORK today and are the only way an Android cleaner gets in. This change can
   lock out every worker at once. Design the transition: do both mechanisms run side by side, and
   for how long? What happens to a worker mid-shift when it ships?
 - The OTP is an expiring secret sent over a channel the owner pays for. Size the code, the
   expiry, the attempts, and the per-phone and per-IP limits with real arithmetic. State the cost
   of an attacker looping the endpoint for an hour.
 - A phone number is now an identity AND a login. W1 made operator and worker phones unique in
   one namespace; confirm that still holds and that a phone change does not orphan a session.
 - Delivery fails: wrong number, roaming, carrier filtering, Twilio down, no credit. A cleaner
   standing at a door at 06:00 needs a way in. Voice fallback is in the existing tasks — say
   whether it is worth it or whether a fallback enrolment code is the lazy correct answer.
 - What does the owner have to buy, register or verify before ANY of this works? Name it as a
   prerequisite list, since an Austrian sender ID is not instant.

DELIVER: a decision record (PROPOSED) explicitly stating what supersedes decision-26 and what
survives, backlog/docs/SMS-DESIGN.md, tasks (</dev/null). Name what the owner must decide and buy
before build. COMMIT. Do NOT build in this phase.`,
  { label: 'w5-design', phase: 'Design', model: MODEL });

phase('Build');
const build = await agent(`${BASE}

DESIGN: ${design}

Build it, gated: if TWILIO_ACCOUNT_SID and a sender are still missing, build everything EXCEPT
live sending, keep it behind a flag that is OFF, and make the missing-credential path fail
closed and legible rather than pretending to send.
 - Phone normalisation reuses W1's E.164 boundary. Two spellings of one number are one identity.
 - The code is hashed at rest like every other token here, single-use, expiring, revocable,
   rate-limited per phone AND per IP AND globally, and NEVER logged.
 - Failure responses are byte-identical for unknown number, wrong code and expired code.
 - Both mechanisms coexist per the design phase. Do not delete enrolment codes in this workflow.
 - Twilio is one HTTPS POST with basic auth. No SDK.
Extend server/check-api.js: every refusal, the rate limits, the byte-identical failures, and a
16-way concurrent redemption yielding exactly one session. Commit as you go.`,
  { label: 'w5-build', phase: 'Build', model: MODEL });

phase('Verify');
const verify = await agent(`${BASE}

DESIGN: ${design}
BUILD: ${build}

Verify. Assume every claim is optimistic.
 - Prove no code appears in any log line. Grep the journal, not the source.
 - Prove the failure responses are byte-identical and the timing difference is inside jitter.
 - Prove the rate limits actually bind, per phone, per IP and globally, and state what an hour of
   abuse would cost the owner in euros.
 - Prove existing enrolment codes STILL WORK and that a live worker session survives.
 - Prove the disabled-credential path fails closed and says so.
 - Standing battery: pnpm verify · check-api · check-close-flag · check-guards · android/checks/.
 - Mutation-test every NEW assertion: RED, restore, GREEN.
Write backlog/docs/W5-VERIFY.md, update the backlog (</dev/null), COMMIT, end with ONE LINE:
SAFE TO DEPLOY or NOT, naming what blocks it.`, { label: 'w5-verify', phase: 'Verify', model: MODEL });

return { design, build, verify };
