---
description: Decision compliance gate — run before committing code changes
---
Read all decision records in `backlog/decisions/` and verify that staged changes (`git diff --cached`) do not contradict any accepted decision. Check specifically:

- No Docker usage (decision-1)
- Data persistence uses Postgres, not JSON files (decision-2)
- Web stack is Next.js + pnpm + Biome, no ESLint/Prettier (decision-3)
- AASA served from exe.xyz, not GitHub Pages (decision-4)
- NFC location identified by URI-encoded ID, not hardware UID (decision-5)
- Material costs pro-rata by labor hours (decision-6)
- Web admin desktop-only with mobile blocker (decision-7)
- All user-visible strings externalized for i18n (decision-8)
- All npm dependency versions pinned exact (decision-9)
- Shift auto-timeout: 8h cron + notification + mandatory resolution (decision-10)

If any violation found: list it with the decision ID and the offending code. Do NOT proceed with commit.
If clean: report "Decision compliance: ✅ all clear" and proceed.
