/**
 * What a German/Austrian Excel actually reads out of a semicolon-separated CSV — plus an
 * RFC-4180 reader to get the cells out in the first place.
 *
 * WHY THIS EXISTS. /payroll/ exports the file the accountant keeps. It is semicolon
 * separated on purpose (an Austrian Windows list separator is `;`), and a semicolon file
 * is opened with the rest of the German locale conventions too: decimal `,`, group `.`.
 * So the bytes `Ana Ilic;10.500;;;;0;Kein Stundensatz` do not state ten and a half hours
 * on that machine. They state TEN THOUSAND FIVE HUNDRED — silently, right-aligned, and
 * summing perfectly. That is a thousandfold error in a payroll artefact, with no visible
 * symptom, so it is asserted rather than eyeballed.
 *
 * TWO HARNESSES, ONE ORACLE. web/scripts/check.mjs checks the ENCODING RULES with no
 * browser; demo/check-reports.mjs downloads the REAL file through the protocol and reads
 * it back. Two copies of this grammar would drift, and the drift would be invisible
 * exactly where it matters.
 *
 * HOW FAR THIS MODEL GOES, stated so nobody over-trusts it: number grammar first, then
 * German short-date grammar, then text. That order is only decidable because of what this
 * file actually contains — the hours column always carries exactly three decimals (a
 * WELL-FORMED German thousands group, never a date) and the euro column exactly two (never
 * a well-formed group, sometimes a date). A cell like `1.234` is genuinely ambiguous
 * between 1234 and 1 March and this model calls it a number; no cell in this export is
 * ever shaped like that, before or after the fix. `ORACLE_CASES` pins every shape that
 * does occur.
 *
 * No dependency: plain Node, imported by both harnesses.
 */

/**
 * RFC 4180, with the delimiter as a parameter because this file is not comma separated.
 * Quoted fields may contain the delimiter, CR, LF and doubled quotes. Returns rows of
 * raw cell strings; a leading UTF-8 BOM is stripped (Excel needs it, a parser does not).
 */
export function parseCsv(text, delimiter = ";") {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  // A file ending in CRLF has already flushed its last row; anything else has not.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** `1.234.567,89` and `1234,89` — group `.` in threes, decimal `,`. */
const DE_NUMBER = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
/** `12.5`, `12.05.2026` — German short date, day first. */
const DE_DATE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/;

/**
 * One cell, as a German Excel would type it.
 *
 *   { kind: 'number', value }  right-aligned, SUM adds it
 *   { kind: 'date' }           right-aligned, SUM adds a ~46 000 serial
 *   { kind: 'text' }           left-aligned, SUM SKIPS it — a column total of 0
 *
 * All three of the wrong ones are wrong in different, equally expensive ways, which is why
 * the assertions compare `kind` AND `value` rather than "did it parse".
 */
export function readsAsDe(cell) {
  const raw = String(cell);
  if (raw.trim() === "") return { kind: "empty" };
  if (DE_NUMBER.test(raw)) {
    return { kind: "number", value: Number(raw.replace(/\./g, "").replace(",", ".")) };
  }
  const date = DE_DATE.exec(raw);
  if (date !== null) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { kind: "date" };
  }
  return { kind: "text" };
}

/**
 * The shapes this export really produces, before and after, each with what an Austrian
 * Excel makes of it. Asserted by BOTH harnesses before either trusts `readsAsDe` — an
 * oracle nobody exercises is a comment, and the whole defect below was a silent misread.
 */
export const ORACLE_CASES = [
  // BEFORE — the hours column. Three decimals is a well-formed German thousands group, so
  // it is read as a number, cleanly, and is out by exactly 1000. This is the defect.
  ["10.500", { kind: "number", value: 10_500 }],
  ["0.750", { kind: "number", value: 750 }],
  // BEFORE — the euro column. Two decimals is never a well-formed group, so it is not a
  // number at all: mostly text (SUM skips it, the column totals 0)...
  ["3638.26", { kind: "text" }],
  ["701.56", { kind: "text" }],
  // ...and, when it happens to look like a day and a month, a DATE that SUM does add.
  ["12.05", { kind: "date" }],
  // AFTER — the same values with the Austrian decimal comma. Unambiguous, both columns.
  ["10,500", { kind: "number", value: 10.5 }],
  ["0,750", { kind: "number", value: 0.75 }],
  ["3638,26", { kind: "number", value: 3638.26 }],
  ["701,56", { kind: "number", value: 701.56 }],
  ["12,05", { kind: "number", value: 12.05 }],
  // Unchanged in both worlds: the integer cent columns carry no separator at all, so they
  // are the one thing in the file that reads the same in every locale.
  ["1480", { kind: "number", value: 1480 }],
  ["363826", { kind: "number", value: 363_826 }],
  ["0", { kind: "number", value: 0 }],
  ["-1250", { kind: "number", value: -1250 }],
  ["-12,50", { kind: "number", value: -12.5 }],
  // A blank money cell is the rate-less worker's row. It must stay blank, not become 0.
  ["", { kind: "empty" }],
  // Names and notes are text and must not be coerced into anything.
  ["Ana Ilic", { kind: "text" }],
  ["Kein Stundensatz", { kind: "text" }],
];

/** Runs ORACLE_CASES. Returns [] when the model still behaves, or a list of differences. */
export function oracleFailures() {
  return ORACLE_CASES.flatMap(([input, want]) => {
    const got = readsAsDe(input);
    const same = got.kind === want.kind && (want.value === undefined || got.value === want.value);
    return same ? [] : [`${JSON.stringify(input)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`];
  });
}
