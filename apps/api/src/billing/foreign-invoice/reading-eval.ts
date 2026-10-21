import type {
  IncomingReadingField,
  IncomingReadingValues,
  SupplierInvoiceImportResult,
} from "@acropora/types";

import {
  readForeignInvoice,
  type ForeignReadingInput,
} from "./foreign-invoice-reading.js";

/**
 * A KULFOLDI SZAMLAOLVASO PONTOSSAGA, ROGZITETT MINTAKESZLETEN (kartya dbab22cd,
 * "szamlaolvaso-autoresearch"; Balazs 2026-10-21 19:17 UTC: mehet).
 *
 * Az olvaso (`readForeignInvoice`) tiszta fuggveny, ezert az ertekeles helyben
 * fut a mentett bemeneteken: adatbazis es PDF-nyitas nelkul (a PDF szovegsorait a
 * CLI szedi ki, lasd `reading-eval.cli.ts`). Ez a fajl a PONTOZAS: mezonkent
 * HELYES / ROSSZ / URES, es a ket szazalek, amit a kiserletek merik.
 *
 * KET SZABALY, AMIT A SZAM MIATT KIMONDUNK:
 * - a KEZZEL JAVITOTT (MANUAL) mezok kulon csoport: az "elvart" ertek ott egy ember
 *   javitasa, tehat az olvaso nem azt mondta, es a szamuk nem keveredhet a fo
 *   szazalekba (az kisebbre festene a pontossagot, amit az olvaso a SAJAT
 *   mezoin ert el). Van egy "mindenre egyben" sor is.
 * - a ROSSZ nem URES: "egy rossz szam rosszabb, mint egy ures" (az olvaso 2.
 *   szabalya), ezert a precizio (a kiolvasott ertekek hany szazaleka helyes) kulon
 *   szam, nem a helyes% masodik neve.
 */

export const EVAL_FIELDS: readonly IncomingReadingField[] = [
  "supplierName",
  "supplierTaxNumber",
  "supplierEuTaxNumber",
  "documentNumber",
  "issueDate",
  "fulfillmentDate",
  "dueDate",
  "currency",
  "netAmount",
  "vatAmount",
  "grossAmount",
];

/** Egy mintaszamla: a bemenet, es amit az ember jovahagyott. */
export interface EvalSample {
  /** tetszoleges kulcs; NEM szamlaszam */
  id: string;
  /** a PDF szovegsorai; `null`, ha szkennelt (nincs szovegreteg) */
  lines: readonly string[] | null;
  adapter: SupplierInvoiceImportResult | null;
  /** a banki parositas, ha van (a B modhoz); az A mod nem hasznalja */
  pairing: ForeignReadingInput["pairing"] | null;
  /** az IncomingDocumentReading VERIFIED sorbol: a helyes ertekek */
  expected: IncomingReadingValues;
  /** azok a mezok, ahol a jovahagyott ertek kezzel javitott (sources = MANUAL) */
  manualFields: readonly IncomingReadingField[];
  /**
   * A MINTA CSOPORTJA (pl. "feed", "nav", "verified"): a helyes ertek forrasa. A
   * jelentes csoportonkent is ad szazalekot, mert a forrasok mas-mas szamlakat
   * fednek (a Szamlazz.hu feed magyar kiallitok, a VERIFIED kulfoldi is).
   */
  group?: string;
}

export type EvalMode = "A" | "B";
export type Verdict = "CORRECT" | "WRONG" | "EMPTY";

/** Az olvaso ures parositasa: az A mod ezt kapja, tehat a parositas semmit nem tolthet ki. */
export const BLANK_PAIRING: ForeignReadingInput["pairing"] = {
  number: "",
  supplierName: "",
  date: "",
  gross: null,
  currency: "",
  debits: [],
};

// ---- egyezes ---------------------------------------------------------------

const AMOUNT_FIELDS = new Set<IncomingReadingField>([
  "netAmount",
  "vatAmount",
  "grossAmount",
]);
const TAX_FIELDS = new Set<IncomingReadingField>([
  "supplierTaxNumber",
  "supplierEuTaxNumber",
]);

/**
 * Egyezik-e a kiolvasott ertek az elvarttal. Az osszegek szamszeruen, ket
 * tizedesre; az adoszam szokoz, kotojel es pont nelkul, nagybetuvel; a szallito
 * neve kisbetuvel, a szokozok egysegesitve; minden mas (szam, deviza, datum)
 * pontosan.
 */
export function sameValue(
  field: IncomingReadingField,
  expected: string,
  actual: string,
): boolean {
  if (AMOUNT_FIELDS.has(field)) {
    const a = Number(expected);
    const b = Number(actual);
    return (
      Number.isFinite(a) && Number.isFinite(b) && a.toFixed(2) === b.toFixed(2)
    );
  }
  if (TAX_FIELDS.has(field)) {
    const clean = (value: string) => value.replace(/[\s.-]/g, "").toUpperCase();
    return clean(expected) === clean(actual);
  }
  if (field === "supplierName") {
    const clean = (value: string) =>
      value.trim().replace(/\s+/g, " ").toLowerCase();
    return clean(expected) === clean(actual);
  }
  return expected.trim() === actual.trim();
}

// ---- egy minta olvasasa ----------------------------------------------------

/** Az olvaso kimenete egy mintan, az adott modban. */
export function readSample(
  sample: EvalSample,
  mode: EvalMode,
): IncomingReadingValues {
  const pairing =
    mode === "B" && sample.pairing ? sample.pairing : BLANK_PAIRING;
  return readForeignInvoice({
    lines: sample.lines,
    adapter: sample.adapter,
    pairing,
  }).values;
}

// ---- pontozas --------------------------------------------------------------

export interface FieldCounts {
  /** hol volt elvart ertek */
  expected: number;
  correct: number;
  wrong: number;
  empty: number;
  /** hol NEM volt elvart ertek (a mezo ures a jovahagyott soron), es mit olvasott az olvaso */
  blankExpected: number;
  extra: number;
}

export type Group = "AUTO" | "MANUAL" | "ALL";

export interface EvalReport {
  mode: EvalMode;
  samples: number;
  /** a mintak, aminek nem volt szovegrétege */
  scanned: number;
  /** B modban: hany mintanak nem volt parositasa (azok A-kent mennek) */
  withoutPairing: number;
  groups: Record<Group, Record<IncomingReadingField, FieldCounts>>;
  /** a dokumentumok szazaleka, ahol minden elvart mezo helyes (AUTO: a kezzel javitottak nelkul) */
  documentsAllCorrect: Record<Group, { all: number; correct: number }>;
}

const emptyCounts = (): FieldCounts => ({
  expected: 0,
  correct: 0,
  wrong: 0,
  empty: 0,
  blankExpected: 0,
  extra: 0,
});

const emptyGroup = () =>
  Object.fromEntries(
    EVAL_FIELDS.map((field) => [field, emptyCounts()]),
  ) as Record<IncomingReadingField, FieldCounts>;

/** Egy mezo itelete; `null`, ha nincs elvart ertek (akkor csak a felesleges szamit). */
export function judge(
  field: IncomingReadingField,
  expected: string | null,
  actual: string | null,
): Verdict | null {
  if (expected === null || expected === "") return null;
  if (actual === null || actual === "") return "EMPTY";
  return sameValue(field, expected, actual) ? "CORRECT" : "WRONG";
}

export function evaluate(
  samples: readonly EvalSample[],
  mode: EvalMode,
): EvalReport {
  const report: EvalReport = {
    mode,
    samples: samples.length,
    scanned: samples.filter((s) => !s.lines || s.lines.length === 0).length,
    withoutPairing: mode === "B" ? samples.filter((s) => !s.pairing).length : 0,
    groups: { AUTO: emptyGroup(), MANUAL: emptyGroup(), ALL: emptyGroup() },
    documentsAllCorrect: {
      AUTO: { all: 0, correct: 0 },
      MANUAL: { all: 0, correct: 0 },
      ALL: { all: 0, correct: 0 },
    },
  };
  for (const sample of samples) {
    const read = readSample(sample, mode);
    const manual = new Set(sample.manualFields);
    const allRight: Record<Group, boolean | null> = {
      AUTO: null,
      MANUAL: null,
      ALL: null,
    };
    for (const field of EVAL_FIELDS) {
      const expected = sample.expected[field];
      const actual = read[field];
      const verdict = judge(field, expected, actual);
      const groups: Group[] = ["ALL", manual.has(field) ? "MANUAL" : "AUTO"];
      for (const group of groups) {
        const counts = report.groups[group][field];
        if (verdict === null) {
          counts.blankExpected += 1;
          if (actual !== null && actual !== "") counts.extra += 1;
          continue;
        }
        counts.expected += 1;
        if (verdict === "CORRECT") counts.correct += 1;
        else if (verdict === "WRONG") counts.wrong += 1;
        else counts.empty += 1;
        allRight[group] = (allRight[group] ?? true) && verdict === "CORRECT";
      }
    }
    for (const group of ["AUTO", "MANUAL", "ALL"] as Group[]) {
      if (allRight[group] === null) continue;
      report.documentsAllCorrect[group].all += 1;
      if (allRight[group]) report.documentsAllCorrect[group].correct += 1;
    }
  }
  return report;
}

/** A mintak csoportonkent; a csoport nelkuliak a "(nincs csoport)" alatt. */
export function evaluateByGroup(
  samples: readonly EvalSample[],
  mode: EvalMode,
): Map<string, EvalReport> {
  const byGroup = new Map<string, EvalSample[]>();
  for (const sample of samples) {
    const key = sample.group?.trim() || "(nincs csoport)";
    byGroup.set(key, [...(byGroup.get(key) ?? []), sample]);
  }
  return new Map(
    [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => [key, evaluate(group, mode)]),
  );
}

// ---- osszesites ------------------------------------------------------------

export interface Percentages {
  /** helyes / elvart */
  correct: number | null;
  wrong: number | null;
  empty: number | null;
  /** a kiolvasott (nem ures) ertekek hany szazaleka helyes */
  precision: number | null;
  /** hol nem volt elvart ertek, hanyszor olvasott mégis valamit */
  extra: number | null;
  /** hany elvart ertek volt */
  expected: number;
}

const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

export function percentages(counts: FieldCounts): Percentages {
  const read = counts.correct + counts.wrong;
  return {
    correct: pct(counts.correct, counts.expected),
    wrong: pct(counts.wrong, counts.expected),
    empty: pct(counts.empty, counts.expected),
    precision: pct(counts.correct, read),
    extra: pct(counts.extra, counts.blankExpected),
    expected: counts.expected,
  };
}

/** Egy csoport osszes mezojenek osszege (mikro-atlag az osszesitett szazalekhoz). */
export function total(
  group: Record<IncomingReadingField, FieldCounts>,
): FieldCounts {
  const sum = emptyCounts();
  for (const counts of Object.values(group))
    for (const key of Object.keys(sum) as (keyof FieldCounts)[])
      sum[key] += counts[key];
  return sum;
}

const show = (value: number | null) =>
  value === null ? "   - " : `${value.toFixed(1).padStart(5)}`;

/**
 * A kimenet: CSAK mezonev es szazalek (+ az elvart ertekek darabszama, ami nem
 * szamla-adat). Mintankenti ertek, szallitonev, szam sehol nincs benne.
 */
export function formatReport(report: EvalReport): string {
  const title =
    report.mode === "A"
      ? "A mod: banki parositas NELKUL (ez a celszam)"
      : `B mod: a mintaban levo parositassal (csak osszevetes; parositas nelkuli minta: ${report.withoutPairing})`;
  const lines = [
    `== ${title} ==`,
    `minta: ${report.samples}, ebbol szkennelt (nincs szovegreteg): ${report.scanned}`,
  ];
  const block = (name: string, group: Group) => {
    const counts = report.groups[group];
    lines.push("", name);
    lines.push(
      "  mezo                  helyes%  rossz%   ures%  precizio%  felesleges%  (elvart db)",
    );
    for (const field of EVAL_FIELDS) {
      const p = percentages(counts[field]);
      if (p.expected === 0 && counts[field].blankExpected === 0) continue;
      lines.push(
        `  ${field.padEnd(20)} ${show(p.correct)}  ${show(p.wrong)}  ${show(p.empty)}  ${show(p.precision)}     ${show(p.extra)}      (${p.expected})`,
      );
    }
    const t = percentages(total(counts));
    const docs = report.documentsAllCorrect[group];
    lines.push(
      `  ${"OSSZESEN".padEnd(20)} ${show(t.correct)}  ${show(t.wrong)}  ${show(t.empty)}  ${show(t.precision)}     ${show(t.extra)}      (${t.expected})`,
      `  teljesen helyes dokumentum: ${show(pct(docs.correct, docs.all))} % (${docs.all} dokumentumbol)`,
    );
  };
  block("Automatikus mezok (a kezzel javitottak nelkul)", "AUTO");
  block("Kezzel javitott (MANUAL) mezok, kulon", "MANUAL");
  block("Mindenre egyben", "ALL");
  return lines.join("\n");
}
