import {
  ANONYMIZATION_KINDS,
  type AnonymizationKind,
} from "../anonymization-register.js";
import type { FieldDecision } from "../anonymization-register-check.js";
import { createJsonScrubber, type JsonScrubOptions } from "./json-scrubber.js";
import { createPseudonymizer, type Pseudonymizer } from "./pseudonymizer.js";
import {
  createResidualDictionary,
  scanRowsAsync,
  type ResidualKind,
} from "./residual-scan.js";
import { createRowTransformer, isNaturalPersonRow } from "./row-transformer.js";
import { createTextScrubber } from "./text-scrubber.js";
import {
  buildGateReport,
  checkFormats,
  checkReferentialIntegrity,
  compareAggregates,
  compareRowCounts,
  residualSection,
  trialSection,
  type FormatKind,
  type GateReport,
  type GateSection,
} from "./verification-gate.js";

/**
 * THE ANONYMIZATION RUNNER (stage anonymization chain, slice S5; card 07b56a1f; plan 2026-10-12 section 3.1 point 1: "minden a
 * masolas kozben tortenik, nem a futo stage-en"). The ORCHESTRATION of the earlier slices over an abstract database, in the
 * order the plan lists: measure the source, build the residual dictionary, transform every row IN THE TEMPORARY DATABASE, measure
 * again, scan for residual personal data, run the gate. It never swaps anything: it returns the gate's report, and a swap is the
 * host's step after a passed report.
 *
 * WHAT THIS MODULE DOES NOT DO, so nobody assumes it: it does not connect to a database (the adapter does: `RunnerDatabase`), it
 * does not take the dump, create the temporary database or swap it in (host steps, which touch the production dump and the
 * stage host), and it does not run the working trial (a script step; the caller passes its result, and without one the gate
 * does not pass).
 *
 * THE GUARD (`assertTemporaryDatabase`): the run refuses any database whose name is not a temporary anonymization name
 * (`stage_anon_tmp_...`). The production database, the stage database and a developer's database can never match it, so the
 * runner cannot be pointed at them by a wrong argument. It is the first thing `runAnonymization` does.
 *
 * UNIQUE COLUMNS: a pseudonymized or replaced `@unique` column must stay unique. The runner records every new value of such a
 * column and, if one repeats, the run FAILS (a section of the report names the column and the count) instead of writing a
 * collision into the swap candidate.
 */

export type Row = Record<string, unknown>;

export interface RunnerDatabase {
  /** The database's name, checked by the guard before anything is read. */
  readonly name: string;
  models(): readonly string[];
  countRows(model: string): Promise<number>;
  /** Every row of a model, all columns, streamed (called more than once). */
  rows(model: string): AsyncIterable<Row>;
  /** Replaces a row's columns (the row is found by its key). */
  replaceRow(model: string, original: Row, replacement: Row): Promise<void>;
  deleteRow(model: string, original: Row): Promise<void>;
  /** Orphan count per foreign key, `Model.field -> Target`. */
  orphanCounts(): Promise<Readonly<Record<string, number>>>;
  /** Business aggregates (monthly sums, stock balances, status distributions) and pairing counts. */
  invariants(): Promise<Readonly<Record<string, number | string>>>;
  correlations(): Promise<Readonly<Record<string, number | string>>>;
  migrationsClean(): Promise<boolean>;
  healthOk(): Promise<boolean>;
}

const TEMPORARY_NAME = /^stage_anon_tmp_[a-z0-9_]{1,40}$/;

export function assertTemporaryDatabase(name: string): void {
  if (!TEMPORARY_NAME.test(name)) {
    throw new Error(
      "the anonymization runner works only on a temporary database named stage_anon_tmp_<letters, digits, underscores>; this name is refused",
    );
  }
}

export interface RunnerOptions {
  database: RunnerDatabase;
  decisions: ReadonlyMap<string, FieldDecision>;
  requiredFields: ReadonlySet<string>;
  knownFields: ReadonlySet<string>;
  uniqueFields: ReadonlySet<string>;
  /** The pseudonymization key (at least 32 bytes): the fakes of this run. Stays in the stage process. */
  pseudonymizationKey: string;
  /** The residual-scan key (at least 32 bytes), for one run only. */
  scanKey: string;
  stagePasswordHash: string;
  /** The working trial's result, run by the caller after the transform; absent means it did not run, and the gate fails. */
  trial?: () => Promise<{ passed: boolean }>;
  kinds?: Readonly<Record<string, AnonymizationKind>>;
  jsonOptions?: JsonScrubOptions;
  /** How many fakes per kind the format check samples. */
  sampleSize?: number;
  /** A test passes a stub engine; production leaves it out. */
  engine?: Pseudonymizer;
}

export interface RunnerResult {
  report: GateReport;
  /** True only when the gate passed: the host may then swap. */
  swapAllowed: boolean;
  rowsTransformed: number;
  rowsDropped: number;
  transformStats: Readonly<Record<string, number>>;
  dictionarySizes: Readonly<Record<ResidualKind, number>>;
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
};

const sameRow = (a: Row, b: Row): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((key) => sameValue(a[key], b[key]));

/** Which format check a changed value of a register kind belongs to (the rest is not sampled). */
function formatKindOf(kind: string, value: string): FormatKind | null {
  if (kind === "email") return "fakeEmail";
  if (kind === "phone") return "phone";
  if (kind === "bankAccount")
    return /^[A-Za-z]{2}\d{2}/.test(value.replace(/\s+/g, "")) ? "iban" : null;
  if (kind === "partyTaxNumber") {
    const digits = value.replace(/\D/g, "");
    if (/^8\d{9}$/.test(digits)) return "personalTaxId";
    if (/^\d{11}$/.test(digits)) return "companyTaxNumber";
  }
  return null;
}

async function* tables(database: RunnerDatabase, models: readonly string[]) {
  for (const model of models) {
    for await (const row of database.rows(model)) yield { model, row };
  }
}

export async function runAnonymization(
  options: RunnerOptions,
): Promise<RunnerResult> {
  const { database, decisions } = options;
  assertTemporaryDatabase(database.name);
  const models = database.models();
  const kinds = options.kinds ?? ANONYMIZATION_KINDS;
  const sampleSize = options.sampleSize ?? 200;
  const engine =
    options.engine ?? createPseudonymizer(options.pseudonymizationKey);

  // 1. MEASURE THE SOURCE and build the residual dictionary from NATURAL PERSONS' values (a company's kept values would be false hits)
  const sourceCounts: Record<string, number> = {};
  const dictionary = createResidualDictionary(options.scanKey);
  const realNames = new Set<string>();
  for (const model of models)
    sourceCounts[model] = await database.countRows(model);
  for await (const { model, row } of tables(database, models)) {
    const natural = isNaturalPersonRow(model, row, decisions);
    for (const [field, value] of Object.entries(row)) {
      if (typeof value !== "string" || value === "") continue;
      const kind = decisions.get(`${model}.${field}`)?.kind;
      if (kind === "email") dictionary.add("email", value);
      else if (kind === "phone") dictionary.add("phone", value);
      else if (kind === "personName") {
        dictionary.add("name", value);
        realNames.add(value);
      } else if (kind === "partyName" && natural) {
        dictionary.add("name", value);
        realNames.add(value);
      } else if (kind === "partyTaxNumber" && natural)
        dictionary.add("taxNumber", value);
      else if (kind === "bankAccount") dictionary.add("iban", value);
    }
  }
  const sourceInvariants = await database.invariants();
  const sourceCorrelations = await database.correlations();
  const realDictionary = dictionary.build();

  // 2. TRANSFORM every row in the temporary database
  const text = createTextScrubber(engine, [...realNames]);
  const json = createJsonScrubber(engine, text, options.jsonOptions);
  const transformer = createRowTransformer({
    decisions,
    requiredFields: options.requiredFields,
    knownFields: options.knownFields,
    uniqueFields: options.uniqueFields,
    engine,
    text,
    json,
    stagePasswordHash: options.stagePasswordHash,
    kinds,
  });
  const dropped: Record<string, number> = {};
  const seenUnique = new Map<string, Set<string>>();
  const collisions = new Map<string, number>();
  const samples: Partial<Record<FormatKind, string[]>> = {};
  let rowsTransformed = 0;
  let rowsDropped = 0;

  for (const model of models) {
    for await (const original of database.rows(model)) {
      const result = transformer.transformRow(model, original);
      if (result.dropped) {
        await database.deleteRow(model, original);
        dropped[model] = (dropped[model] ?? 0) + 1;
        rowsDropped += 1;
        continue;
      }
      for (const [field, value] of Object.entries(result.row)) {
        const key = `${model}.${field}`;
        const kindName = decisions.get(key)?.kind;
        if (
          kindName === undefined ||
          typeof value !== "string" ||
          value === original[field]
        )
          continue;
        if (options.uniqueFields.has(key)) {
          const seen = seenUnique.get(key) ?? new Set<string>();
          if (seen.has(value))
            collisions.set(key, (collisions.get(key) ?? 0) + 1);
          seen.add(value);
          seenUnique.set(key, seen);
        }
        const format = formatKindOf(kindName, value);
        if (format && (samples[format]?.length ?? 0) < sampleSize)
          (samples[format] ??= []).push(value);
      }
      if (!sameRow(original, result.row)) {
        await database.replaceRow(model, original, result.row);
        rowsTransformed += 1;
      }
    }
  }

  // 3. MEASURE THE TARGET and SCAN it for residual personal data
  const targetCounts: Record<string, number> = {};
  for (const model of models)
    targetCounts[model] = await database.countRows(model);
  const totalRows = Object.values(targetCounts).reduce((sum, n) => sum + n, 0);
  const residual = await scanRowsAsync(
    realDictionary,
    tables(database, models),
  );

  // 4. THE GATE
  const collisionSection: GateSection = {
    name: "uniqueColumns",
    passed: collisions.size === 0,
    problems: [...collisions].map(
      ([key, count]) =>
        `${key}: ${count} repeated fake value(s) in a unique column`,
    ),
  };
  const sections: GateSection[] = [
    compareRowCounts(sourceCounts, targetCounts, { dropped }),
    checkReferentialIntegrity(
      await database.orphanCounts(),
      await database.migrationsClean(),
      await database.healthOk(),
    ),
    residualSection(residual, totalRows),
    checkFormats(samples),
    compareAggregates(
      "invariants",
      sourceInvariants,
      await database.invariants(),
    ),
    compareAggregates(
      "correlations",
      sourceCorrelations,
      await database.correlations(),
    ),
    collisionSection,
    options.trial
      ? trialSection(true, (await options.trial()).passed)
      : trialSection(false, false),
  ];
  const report = buildGateReport(sections);
  return {
    report,
    swapAllowed: report.passed,
    rowsTransformed,
    rowsDropped,
    transformStats: transformer.stats,
    dictionarySizes: realDictionary.sizes,
  };
}
