/**
 * THE V0 OFFLINE BENCHMARK (ACD-021 "Suggested V0"): the seven metrics,
 * EACH REPORTED SEPARATELY. No metric is folded into another, and there is
 * no single overall score: a good copy score must not hide an invented EAN.
 *
 * Input: a JSON dataset of products, each with gold labels per field and the
 * candidate (Jev) output per field. No network, no database: the scorer is a
 * pure function, and `scripts/eval-product-enrichment.mjs` only reads a file.
 *
 * The real 30-50 product dataset is NOT in the repository. The only dataset
 * here is a synthetic fixture that tests the harness itself.
 */

import {
  FIELD_SPECS,
  isFieldKey,
  normalizeFieldValue,
  type FieldKey,
} from "./fields.js";
import { guardFieldResult } from "./guard.js";
import {
  FIELD_STATUSES,
  JEV_PROPOSAL,
  isBlank,
  isIsoTimestamp,
  isSourceType,
  type FieldResult,
  type FieldStatus,
  type SourcedValue,
} from "./provenance.js";

export const BENCHMARK_SCHEMA = "product-enrichment-benchmark@1";

export interface GoldField {
  status: FieldStatus;
  /** The correct value, for a VERIFIED gold field. */
  value?: string | null;
  /** Every value at least one source states (CONFLICTING_SOURCES: all of them). */
  supportedValues?: string[];
}

export interface CandidateField {
  status: FieldStatus;
  value?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  retrievedAt?: string | null;
  confidence?: number | null;
  conflicts?: unknown[];
}

export type HumanVerdict = "ACCEPTED" | "EDITED" | "REJECTED";
const HUMAN_VERDICTS: readonly HumanVerdict[] = [
  "ACCEPTED",
  "EDITED",
  "REJECTED",
];

export interface BenchmarkProduct {
  id: string;
  /** The source references that exist for this product (the source inventory). */
  sources?: string[];
  gold: Partial<Record<FieldKey, GoldField>>;
  candidate: Partial<Record<FieldKey, CandidateField>>;
  /** Human review of the candidate, per field (optional). */
  human?: Partial<Record<FieldKey, HumanVerdict>>;
  /** Human copy-quality rating, 1..5 (optional). */
  copyQuality?: number | null;
}

export interface BenchmarkDataset {
  schema: typeof BENCHMARK_SCHEMA;
  synthetic?: boolean;
  description?: string;
  products: BenchmarkProduct[];
}

export type ParseResult =
  { ok: true; dataset: BenchmarkDataset } | { ok: false; errors: string[] };

/** Validates the dataset shape. Every problem is named; nothing is skipped silently. */
export function parseBenchmarkDataset(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isObject(input))
    return { ok: false, errors: ["the dataset is not an object"] };
  if (input.schema !== BENCHMARK_SCHEMA)
    errors.push(`schema must be "${BENCHMARK_SCHEMA}"`);
  if (!Array.isArray(input.products) || input.products.length === 0)
    return {
      ok: false,
      errors: [...errors, "products must be a non-empty array"],
    };

  const ids = new Set<string>();
  input.products.forEach((p: unknown, i: number) => {
    const at = `products[${i}]`;
    if (!isObject(p)) return void errors.push(`${at} is not an object`);
    if (typeof p.id !== "string" || p.id === "")
      errors.push(`${at}.id is missing`);
    else if (ids.has(p.id)) errors.push(`${at}.id "${p.id}" is duplicated`);
    else ids.add(p.id);
    if (
      p.sources !== undefined &&
      !(
        Array.isArray(p.sources) &&
        p.sources.every((s) => typeof s === "string")
      )
    )
      errors.push(`${at}.sources must be an array of strings`);
    for (const part of ["gold", "candidate"] as const) {
      const fields = p[part];
      if (!isObject(fields)) {
        errors.push(`${at}.${part} must be an object`);
        continue;
      }
      for (const [key, f] of Object.entries(fields)) {
        const where = `${at}.${part}.${key}`;
        if (!isFieldKey(key)) errors.push(`${where}: unknown field`);
        if (
          !isObject(f) ||
          !(FIELD_STATUSES as readonly unknown[]).includes(f.status)
        )
          errors.push(`${where}.status is not a field status`);
        else if (
          part === "gold" &&
          f.status === "VERIFIED" &&
          typeof f.value !== "string"
        )
          errors.push(`${where}: a VERIFIED gold field needs a value`);
      }
    }
    if (p.human !== undefined) {
      if (!isObject(p.human)) errors.push(`${at}.human must be an object`);
      else
        for (const [key, v] of Object.entries(p.human)) {
          if (!isFieldKey(key))
            errors.push(`${at}.human.${key}: unknown field`);
          if (!HUMAN_VERDICTS.includes(v as HumanVerdict))
            errors.push(
              `${at}.human.${key} must be ACCEPTED, EDITED or REJECTED`,
            );
        }
    }
    if (
      p.copyQuality !== undefined &&
      p.copyQuality !== null &&
      !(
        typeof p.copyQuality === "number" &&
        p.copyQuality >= 1 &&
        p.copyQuality <= 5
      )
    )
      errors.push(`${at}.copyQuality must be 1..5`);
  });

  return errors.length
    ? { ok: false, errors }
    : { ok: true, dataset: input as unknown as BenchmarkDataset };
}

export interface Ratio {
  numerator: number;
  denominator: number;
  /** `null` when the denominator is zero: "nothing to measure" is not 0% or 100%. */
  rate: number | null;
}

export interface UnsupportedFact {
  productId: string;
  field: FieldKey;
  value: string;
  reasons: string[];
}

export interface BenchmarkReport {
  schema: typeof BENCHMARK_SCHEMA;
  synthetic: boolean;
  products: number;
  /** 1. Gold VERIFIED fields the candidate asserted with the correct value. */
  fieldExtraction: Ratio;
  /** 2. Conflict flag (CONFLICTING_SOURCES) vs gold, over every gold-labelled field. */
  conflictDetection: {
    accuracy: Ratio;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
    precision: number | null;
    recall: number | null;
  };
  /** 3. Gold MISSING fields the candidate left without a value (MISSING/UNVERIFIED). */
  missingDetection: {
    recall: Ratio;
    /** Gold has a value, the candidate said MISSING. */
    falseMissing: number;
  };
  /** 4. Asserted Tier C values not backed by a source. HARD GATE: must be zero. */
  unsupportedFacts: {
    rate: Ratio;
    gate: "PASS" | "FAIL" | "NO_DATA";
    items: UnsupportedFact[];
  };
  /** 5. Asserted values (and conflict outputs) carrying complete provenance. */
  provenanceCompleteness: Ratio;
  /** 6. Human review verdicts, when the dataset has them. */
  humanAcceptance: {
    accepted: Ratio;
    edited: number;
    rejected: number;
  } | null;
  /** 7. Copy quality, scored ONLY on products that passed the factual checks. */
  copyQuality: {
    scored: number;
    gatedOut: number;
    meanScore: number | null;
  } | null;
}

export function scoreBenchmark(dataset: BenchmarkDataset): BenchmarkReport {
  let extractionHit = 0;
  let extractionTotal = 0;
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  let missingHit = 0;
  let missingTotal = 0;
  let falseMissing = 0;
  let assertedTierC = 0;
  const unsupported: UnsupportedFact[] = [];
  let provenanceOk = 0;
  let provenanceTotal = 0;
  let accepted = 0,
    edited = 0,
    rejected = 0;
  const copyScores: number[] = [];
  let copyGated = 0;
  let copyLabelled = 0;

  for (const product of dataset.products) {
    let factualOk = true;
    const keys = new Set<FieldKey>(
      [...Object.keys(product.gold), ...Object.keys(product.candidate)].filter(
        isFieldKey,
      ),
    );

    for (const field of keys) {
      const gold = product.gold[field];
      const cand = product.candidate[field];
      const asserted =
        cand !== undefined &&
        (cand.status === "VERIFIED" || cand.status === "SUGGESTED") &&
        typeof cand.value === "string";

      // 1. Field extraction accuracy.
      if (gold?.status === "VERIFIED" && typeof gold.value === "string") {
        extractionTotal++;
        if (asserted && sameValue(field, cand.value!, gold.value))
          extractionHit++;
        else factualOk = false;
      }

      // 2. Conflict detection.
      if (gold) {
        const g = gold.status === "CONFLICTING_SOURCES";
        const c = cand?.status === "CONFLICTING_SOURCES";
        if (g && c) tp++;
        else if (!g && c) fp++;
        else if (g && !c) {
          fn++;
          factualOk = false;
        } else tn++;
      }

      // 3. Missing-field detection.
      if (gold?.status === "MISSING") {
        missingTotal++;
        if (
          !asserted &&
          (cand === undefined ||
            cand.status === "MISSING" ||
            cand.status === "UNVERIFIED")
        )
          missingHit++;
      }
      if (gold?.status === "VERIFIED" && cand?.status === "MISSING")
        falseMissing++;

      // 4. Unsupported facts (Tier C only: the "never invent" set).
      if (asserted && FIELD_SPECS[field].tier === "C") {
        assertedTierC++;
        const reasons = unsupportedReasons(field, cand, gold, product.sources);
        if (reasons.length) {
          unsupported.push({
            productId: product.id,
            field,
            value: cand.value!,
            reasons,
          });
          factualOk = false;
        }
      }

      // 5. Provenance completeness.
      if (asserted || cand?.status === "CONFLICTING_SOURCES") {
        provenanceTotal++;
        if (provenanceComplete(cand!)) provenanceOk++;
      }
    }

    // 6. Human acceptance.
    for (const verdict of Object.values(product.human ?? {})) {
      if (verdict === "ACCEPTED") accepted++;
      else if (verdict === "EDITED") edited++;
      else if (verdict === "REJECTED") rejected++;
    }

    // 7. Copy quality, after factual correctness.
    if (typeof product.copyQuality === "number") {
      copyLabelled++;
      if (factualOk) copyScores.push(product.copyQuality);
      else copyGated++;
    }
  }

  const humanTotal = accepted + edited + rejected;
  return {
    schema: BENCHMARK_SCHEMA,
    synthetic: dataset.synthetic === true,
    products: dataset.products.length,
    fieldExtraction: ratio(extractionHit, extractionTotal),
    conflictDetection: {
      accuracy: ratio(tp + tn, tp + fp + fn + tn),
      truePositive: tp,
      falsePositive: fp,
      falseNegative: fn,
      trueNegative: tn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    },
    missingDetection: { recall: ratio(missingHit, missingTotal), falseMissing },
    unsupportedFacts: {
      rate: ratio(unsupported.length, assertedTierC),
      gate:
        assertedTierC === 0
          ? "NO_DATA"
          : unsupported.length === 0
            ? "PASS"
            : "FAIL",
      items: unsupported,
    },
    provenanceCompleteness: ratio(provenanceOk, provenanceTotal),
    humanAcceptance: humanTotal
      ? { accepted: ratio(accepted, humanTotal), edited, rejected }
      : null,
    copyQuality: copyLabelled
      ? {
          scored: copyScores.length,
          gatedOut: copyGated,
          meanScore: copyScores.length
            ? copyScores.reduce((a, b) => a + b, 0) / copyScores.length
            : null,
        }
      : null,
  };
}

function unsupportedReasons(
  field: FieldKey,
  cand: CandidateField,
  gold: GoldField | undefined,
  sources: string[] | undefined,
): string[] {
  const reasons: string[] = [];

  // The same guard production code would run, applied to the candidate as a result.
  const sourceType = isSourceType(cand.sourceType) ? cand.sourceType : null;
  const asResult: FieldResult = {
    field,
    value: cand.value ?? null,
    sourceType,
    sourceRef: cand.sourceRef ?? null,
    retrievedAt: cand.retrievedAt ?? null,
    confidence: cand.confidence ?? null,
    status: cand.status,
    evidence:
      sourceType && sourceType !== JEV_PROPOSAL
        ? [
            {
              value: cand.value!,
              sourceType,
              sourceRef: cand.sourceRef ?? null,
              retrievedAt: cand.retrievedAt ?? null,
            } satisfies SourcedValue,
          ]
        : [],
    rejected: [],
    reconciledAt: null,
  };
  const guarded = guardFieldResult(field, asResult);
  if (!guarded.ok) reasons.push(...guarded.violations.map((v) => v.reason));

  if (sources && !isBlank(cand.sourceRef) && !sources.includes(cand.sourceRef!))
    reasons.push(
      `source "${cand.sourceRef}" is not in the product's source inventory`,
    );
  if (gold && (gold.status === "MISSING" || gold.status === "UNVERIFIED"))
    reasons.push(`gold says ${gold.status}: no source supports any value`);
  else if (gold) {
    const supported =
      gold.supportedValues ??
      (typeof gold.value === "string" ? [gold.value] : []);
    if (
      supported.length &&
      !supported.some((s) => sameValue(field, cand.value!, s))
    )
      reasons.push("no source states this value");
  }
  return [...new Set(reasons)];
}

function provenanceComplete(cand: CandidateField): boolean {
  if (!isSourceType(cand.sourceType)) return false;
  if (isBlank(cand.sourceRef)) return false;
  if (!isIsoTimestamp(cand.retrievedAt)) return false;
  if (
    typeof cand.confidence !== "number" ||
    cand.confidence < 0 ||
    cand.confidence > 1
  )
    return false;
  if (cand.status === "CONFLICTING_SOURCES")
    return Array.isArray(cand.conflicts) && cand.conflicts.length >= 2;
  return true;
}

function sameValue(field: FieldKey, a: string, b: string): boolean {
  const na = normalizeFieldValue(field, a);
  const nb = normalizeFieldValue(field, b);
  return na.ok && nb.ok && na.value === nb.value;
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    rate: denominator ? numerator / denominator : null,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const pct = (r: Ratio) =>
  r.rate === null
    ? "n/a (nothing to measure)"
    : `${(r.rate * 100).toFixed(1)}% (${r.numerator}/${r.denominator})`;
const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(3));

/** The human-readable report. Seven sections, in the decision's order. */
export function benchmarkReportMarkdown(r: BenchmarkReport): string {
  const lines = [
    "# Product enrichment V0 benchmark",
    "",
    r.synthetic
      ? "> **SYNTHETIC DATASET.** These numbers test the harness, not Jev."
      : "> Dataset is not marked synthetic.",
    "",
    `Products: ${r.products}`,
    "",
    "## 1. Field extraction accuracy",
    `- ${pct(r.fieldExtraction)}`,
    "",
    "## 2. Conflict detection accuracy",
    `- accuracy: ${pct(r.conflictDetection.accuracy)}`,
    `- TP ${r.conflictDetection.truePositive}, FP ${r.conflictDetection.falsePositive}, FN ${r.conflictDetection.falseNegative}, TN ${r.conflictDetection.trueNegative}`,
    `- precision ${num(r.conflictDetection.precision)}, recall ${num(r.conflictDetection.recall)}`,
    "",
    "## 3. Missing-field detection",
    `- recall: ${pct(r.missingDetection.recall)}`,
    `- false MISSING (gold has a value): ${r.missingDetection.falseMissing}`,
    "",
    "## 4. Unsupported-fact (hallucination) rate, Tier C",
    `- rate: ${pct(r.unsupportedFacts.rate)}`,
    `- hard gate (must be zero): **${r.unsupportedFacts.gate}**`,
    ...r.unsupportedFacts.items.map(
      (u) =>
        `  - \`${u.productId}\` ${u.field} = "${u.value}": ${u.reasons.join("; ")}`,
    ),
    "",
    "## 5. Provenance completeness",
    `- ${pct(r.provenanceCompleteness)}`,
    "",
    "## 6. Human acceptance rate",
    r.humanAcceptance
      ? `- accepted ${pct(r.humanAcceptance.accepted)}, edited ${r.humanAcceptance.edited}, rejected ${r.humanAcceptance.rejected}`
      : "- n/a (no human labels in the dataset)",
    "",
    "## 7. Copy quality (only after factual correctness)",
    r.copyQuality
      ? `- mean ${num(r.copyQuality.meanScore)} over ${r.copyQuality.scored} product(s); ${r.copyQuality.gatedOut} not scored (failed the factual checks)`
      : "- n/a (no copy-quality labels in the dataset)",
    "",
  ];
  return lines.join("\n");
}
