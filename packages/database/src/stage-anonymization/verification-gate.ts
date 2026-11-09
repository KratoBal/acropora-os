import type { ResidualReport } from "./residual-scan.js";

/**
 * THE VERIFICATION GATE (stage anonymization chain, slice S4; card 07b56a1f; plan 2026-10-12 section 3.5: "a stage-csere csak akkor
 * tortenik meg, ha mind atment"). PURE: the numbers and samples a runner (S5) measured on the temporary database go in, a pass or
 * fail with the reasons comes out. Nothing here reads a database; the runner does the measuring and this decides.
 *
 * THE REPORT NAMES, NEVER SHOWS: a problem line holds a table, a column, a kind and numbers (counts, aggregate sums). It never
 * holds a personal value, a row or a position, so the report can be posted to the board without a second review.
 *
 * SEVEN CHECKS, as the plan lists them: (1) row counts per table against the source (an intentionally emptied table, and the rows
 * the transformer dropped, are accounted for), (2) referential integrity (no orphan foreign key), (3) ZERO residual personal data
 * (the S4 scan), (4) format validity of the fakes (written independently of the engine and calibrated on a published example),
 * (5) business invariants (monthly order and invoice sums, stock balances, status distributions) equal to the source,
 * (6) correlations (the customer-order and customer-invoice pairings) equal to the source, (7) the working trial on the stage,
 * which is a human or a script step outside this module and enters as a boolean the runner sets after it ran.
 */

export interface GateSection {
  name: string;
  passed: boolean;
  /** Table, column, kind and numbers only. */
  problems: string[];
}

export interface GateReport {
  passed: boolean;
  sections: GateSection[];
}

const section = (name: string, problems: string[]): GateSection => ({
  name,
  passed: problems.length === 0,
  problems,
});

type Counts = Readonly<Record<string, number>>;

/** (1) Row counts. `emptied`: tables the plan empties on purpose (they must be 0). `dropped`: rows the transformer removed per table. */
export function compareRowCounts(
  source: Counts,
  target: Counts,
  options: { emptied?: ReadonlySet<string>; dropped?: Counts } = {},
): GateSection {
  const problems: string[] = [];
  const emptied = options.emptied ?? new Set<string>();
  for (const [table, sourceCount] of Object.entries(source)) {
    if (!(table in target)) {
      problems.push(
        `${table}: missing from the target (source ${sourceCount})`,
      );
      continue;
    }
    const targetCount = target[table]!;
    if (emptied.has(table)) {
      if (targetCount !== 0)
        problems.push(`${table}: should be emptied, target ${targetCount}`);
      continue;
    }
    const expected = sourceCount - (options.dropped?.[table] ?? 0);
    if (targetCount !== expected) {
      problems.push(
        `${table}: source ${sourceCount}, dropped ${options.dropped?.[table] ?? 0}, expected ${expected}, target ${targetCount}`,
      );
    }
  }
  for (const table of Object.keys(target)) {
    if (!(table in source))
      problems.push(`${table}: in the target, not in the source`);
  }
  return section("rowCounts", problems);
}

/** (2) Referential integrity: the orphan count per foreign key must be 0 (`Model.field -> Target`). */
export function checkReferentialIntegrity(
  orphans: Counts,
  migrationsApplied: boolean,
  healthOk: boolean,
): GateSection {
  const problems = Object.entries(orphans)
    .filter(([, count]) => count !== 0)
    .map(([key, count]) => `${key}: ${count} orphan row(s)`);
  if (!migrationsApplied)
    problems.push("migrations: the migration state is not clean");
  if (!healthOk) problems.push("health: the application health check failed");
  return section("referentialIntegrity", problems);
}

/** (3) Residual personal data: nothing found. The S4 scan's report, as a section. */
export function residualSection(
  report: ResidualReport,
  expectedRows: number,
): GateSection {
  const problems = report.findings.map((f) =>
    f.kind === "credentialKey"
      ? `${f.model}.${f.field}: ${f.count} credential or network key(s) left in the JSON`
      : `${f.model}.${f.field}: ${f.count} value(s) with a real ${f.kind}`,
  );
  // a scan that read nothing proves nothing: the number of rows it saw must be the number of rows the target has
  if (report.rowsScanned !== expectedRows) {
    problems.push(
      `scan coverage: ${report.rowsScanned} row(s) scanned, ${expectedRows} expected`,
    );
  }
  return section("residualPersonalData", problems);
}

// ---- (4) formats: validators written here, independent of the engine ----

const mod97 = (iban: string): boolean => {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  const numeric = [...moved]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
    .join("");
  return BigInt(numeric) % 97n === 1n;
};

/** Weights 9-7-3-1 repeated: the weighted sum of the digits must be a multiple of ten. */
const blockOk = (digits: string): boolean => {
  const weights = [9, 7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1)
    sum += Number(digits[i]) * weights[i % 4]!;
  return sum % 10 === 0;
};

const huBbanOk = (bban: string): boolean =>
  /^\d{24}$/.test(bban) &&
  blockOk(bban.slice(0, 8)) &&
  (/^0{8}$/.test(bban.slice(16))
    ? blockOk(bban.slice(8, 16))
    : blockOk(bban.slice(8)));

const companyCoreOk = (core: string): boolean => {
  if (!/^\d{8}$/.test(core)) return false;
  const weights = [9, 7, 3, 1, 9, 7, 3];
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += Number(core[i]) * weights[i]!;
  return (10 - (sum % 10)) % 10 === Number(core[7]);
};

const personalTaxIdOk = (value: string): boolean => {
  const digits = value.replace(/\D/g, "");
  if (!/^8\d{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (i + 1) * Number(digits[i]);
  return sum % 11 === Number(digits[9]) && sum % 11 !== 10;
};

export const FORMAT_VALIDATORS = {
  email: (value: string) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value),
  /** The fake e-mail domain is undeliverable on purpose (plan 3.2): a stage mail must never leave. */
  fakeEmail: (value: string) =>
    /^[^\s@]+@teszt\.acropora\.invalid$/.test(value),
  companyTaxNumber: (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && companyCoreOk(digits.slice(0, 8));
  },
  personalTaxId: personalTaxIdOk,
  iban: (value: string) => {
    if (!mod97(value)) return false;
    const compact = value.replace(/\s+/g, "").toUpperCase();
    return compact.startsWith("HU") ? huBbanOk(compact.slice(4)) : true;
  },
  phone: (value: string) =>
    /^\+?[\d\s().-]{6,}$/.test(value) && value.replace(/\D/g, "").length >= 6,
} as const;

export type FormatKind = keyof typeof FORMAT_VALIDATORS;

/** (4) Format validity of a sample of fakes, per kind: 100% must pass. Reports counts only. */
export function checkFormats(
  samples: Partial<Record<FormatKind, readonly string[]>>,
): GateSection {
  const problems: string[] = [];
  for (const [kind, values] of Object.entries(samples) as [
    FormatKind,
    readonly string[],
  ][]) {
    const validate = FORMAT_VALIDATORS[kind];
    if (!validate) {
      problems.push(`${kind}: no validator for this kind`);
      continue;
    }
    if (values.length === 0) {
      problems.push(`${kind}: the sample is empty, so nothing was checked`);
      continue;
    }
    const bad = values.filter((value) => !validate(value)).length;
    if (bad > 0)
      problems.push(
        `${kind}: ${bad} of ${values.length} sampled value(s) fail the check`,
      );
  }
  return section("formats", problems);
}

/** (5) and (6) Aggregates (monthly sums, stock balances, status distributions, pairing counts) equal to the source, key by key. */
export function compareAggregates(
  name: "invariants" | "correlations",
  source: Readonly<Record<string, number | string>>,
  target: Readonly<Record<string, number | string>>,
): GateSection {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target))
      problems.push(`${key}: missing from the target (source ${value})`);
    else if (target[key] !== value)
      problems.push(`${key}: source ${value}, target ${target[key]}`);
  }
  for (const key of Object.keys(target)) {
    if (!(key in source))
      problems.push(`${key}: in the target, not in the source`);
  }
  if (Object.keys(source).length === 0)
    problems.push("no aggregate was measured, so nothing was compared");
  return section(name, problems);
}

/** (7) The working trial on the stage (a stub invoice, an order flow, a work sheet, a ticket) ran, and passed. */
export function trialSection(ran: boolean, passed: boolean): GateSection {
  return section(
    "workingTrial",
    ran
      ? passed
        ? []
        : ["the working trial ran and failed"]
      : ["the working trial did not run"],
  );
}

/** The gate: every section must pass for the stage swap to proceed. An empty list of sections never passes. */
export function buildGateReport(sections: readonly GateSection[]): GateReport {
  return {
    passed: sections.length > 0 && sections.every((s) => s.passed),
    sections: [...sections],
  };
}
