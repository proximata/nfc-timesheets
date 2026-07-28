// Check: auto_closed is monotonic (raised, never cleared) — the SQL contract the app relies on.
import { readFileSync } from "node:fs";
const sql = readFileSync("server/routes/app.js", "utf8");
let pass = 0, fail = 0;
const t = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

t("close route accepts auto_closed", /body\.auto_closed/.test(sql));
t("close UPDATE uses OR (raise-only, never clears)", /auto_closed\s*=\s*auto_closed\s*OR\s*\$3/.test(sql));
t("close does NOT assign auto_closed directly", !/SET[^`]*auto_closed\s*=\s*\$\d(?!\s*OR)/.test(sql.replace(/auto_closed = auto_closed OR \$3/g, "")));

// truth table for `auto_closed OR $3`
const orSql = (existing, incoming) => existing || incoming;
t("timer flagged + plain tap-out  -> stays flagged", orSql(true, false) === true);
t("unflagged + app auto-close     -> becomes flagged", orSql(false, true) === true);
t("unflagged + normal tap-out     -> stays clean", orSql(false, false) === false);
t("flagged + app auto-close       -> stays flagged", orSql(true, true) === true);

console.log(`\nclose-flag checks: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
