# Tasks 351-358 delivery

Worktree: `E:/nfc/.worktrees/351-358`; branch `codex/tasks-351-358`.
Base: `72632892cf325ec45b7a3f2bbefe8e7b816d6691`. No production deployment, migration,
push, or merge. The concurrent agent's checkout and index remain separate.

## Owner's scope update, 23 September 2026

- 351: weekly forecast and live assignment preview.
- 352: bilingual Book a call CTA pointing to an explicit booking-unavailable section.
- 353: live booking deferred, superseded by new owner-requested TASK-361.
- 354: inert, keyboard-reachable Microsoft sign-in placeholder on product and login.
- 355: deferred by owner; no Google Calendar transfer implemented.
- 356: real XLSX from payroll with typed values and translated headings.
- 357: owner replaced zone-accounting scope with Export as filters and section selection.
  Decision-43 remains unchanged; zones contain area, never invented costs.
- 358: planned Microsoft 365, Outlook and Google Workspace/Calendar cards.

## Calculation and export rules

Forecast uses current hourly rates, elapsed milliseconds and the Vienna week interval.
Assignments crossing the week boundary are clipped; cancelled rows are excluded. Sum time
per employee first, then round once to cents. Unknown rates make the total unavailable.
The form preview covers the complete assignment, not only the visible week. Forecast is
client-side and does not create actual shifts, wages, revenue, or P&L entries.

Export uses the existing authenticated `/admin/data` and `/admin/pl` readers. Period,
employee and building are the same URL filters used by the payroll screen. Export sections
are employees, building costs and optional zone details. Preview and workbook share one
table model. The workbook also records selected filters, dates and calculation limitations.
Open/unconfirmed shifts are excluded and counted. The period follows the existing start-time
attribution rule, not forecast clipping. Building labour/materials use existing P&L values;
the material pool is never recomputed after selecting a building. An employee filter makes
building material and total costs unknown rather than reassigning building materials to a
person. Payroll and building report rounding can differ slightly, as stated in both outputs.

Incomplete row-limited exports are blocked. Loading, range mismatches, failures, empty
selections and missing data do not permit a misleading download. Text cells are explicitly
strings, including names starting with `=`. XLSX generation is browser-local and lazy-loaded
using exact dependency `write-excel-file@4.0.1`; no new server dependency or endpoint.

## Verification evidence and limits

- `pnpm verify`: project invariants/localization, arithmetic/XLSX tests, Biome, TypeScript,
  static production build. Windows source-path normalization fixed in the existing gate.
  Existing root bookmark forwarding and public invitation login exception are recognized.
- `node ops/check-branding.mjs`: all checks pass, no TODO lines.
- `web/scripts/check-report-export.mjs`: spring/fall DST, clipping, cancellation, absent rate,
  rounding, report filters/exclusions, unknown costs, DE/EN workbook generation.
- Independent openpyxl reopen: numeric hours/money, date cells, formula-like names as text,
  and no formula cells. A library default-style warning is non-fatal.
- Dedicated real-browser feature runs with fixture APIs are in `tmp/verify-landing`,
  `tmp/verify-schedule`, and `tmp/verify-export`. They drive controls and downloaded files,
  not just source inspection. Contrast and crowded export controls were found and corrected.

These are local UI and calculation checks. They do not prove live database persistence,
cross-company authorization at runtime, real invitation delivery, desktop Microsoft Excel
rendering, or production operation. Existing authorization routes are reused without server
changes. Native apps are untouched; no iOS/Android checks are represented as having run.

Final decision/code-review evidence is recorded in `tmp/verify-landing` and the PDF report.
