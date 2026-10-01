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
  containsFactualClaims,
  isFieldKey,
  normalizeFieldValue,
  type FieldKey,
  type Tier,
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
  /**
   * Prose fields only (feature bullets, descriptions): the labeller found a
   * factual claim in the candidate's text that no source supports. V0 has no
   * sentence-level fact extraction, so this judgement is a label.
   */
  unsupportedClaim?: boolean;
}

/** One source inside a conflict entry: the same shape as `SourcedValue`. */
export interface BenchmarkConflictSource {
  value?: string;
  sourceType?: string | null;
  sourceRef?: string | null;
  retrievedAt?: string | null;
  confidence?: number | null;
}

/** One distinct value of a conflict set: the same shape as `ConflictEntry`. */
export interface BenchmarkConflictEntry {
  value: string | null;
  sources: BenchmarkConflictSource[];
  invalidReason?: string;
  invalidCode?: string;
  unsupportedReason?: string;
}

export interface CandidateField {
  status: FieldStatus;
  value?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  retrievedAt?: string | null;
  confidence?: number | null;
  conflicts?: BenchmarkConflictEntry[];
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

const DATASET_KEYS = ["schema", "synthetic", "description", "products"];
const PRODUCT_KEYS = [
  "id",
  "sources",
  "gold",
  "candidate",
  "human",
  "copyQuality",
];
const GOLD_KEYS = ["status", "value", "supportedValues", "unsupportedClaim"];
const CANDIDATE_KEYS = [
  "status",
  "value",
  "sourceType",
  "sourceRef",
  "retrievedAt",
  "confidence",
  "conflicts",
];
const CONFLICT_KEYS = [
  "value",
  "sources",
  "invalidReason",
  "invalidCode",
  "unsupportedReason",
];
const SOURCE_KEYS = [
  "value",
  "sourceType",
  "sourceRef",
  "retrievedAt",
  "confidence",
];

/**
 * Validates the WHOLE dataset before anything is scored. FAIL-FAST: every
 * problem is named with its exact path (product index and id, part, field,
 * property), and a dataset with any problem never reaches `scoreBenchmark`.
 *
 * Missing provenance is NOT a parse error: it is what metric 5 measures. A
 * property of the wrong type, an unknown property, an unknown source type or a
 * status whose invariant is broken IS one: the scorer would otherwise have to
 * guess what it meant.
 */
export function parseBenchmarkDataset(input: unknown): ParseResult {
  const errors: string[] = [];
  const err = (path: string, message: string) =>
    errors.push(`${path}: ${message}`);
  if (!isObject(input))
    return { ok: false, errors: ["the dataset is not an object"] };
  unknownKeys(input, DATASET_KEYS, "dataset", err);
  if (input.schema !== BENCHMARK_SCHEMA)
    err("dataset.schema", `schema must be "${BENCHMARK_SCHEMA}"`);
  if (input.synthetic !== undefined && typeof input.synthetic !== "boolean")
    err("dataset.synthetic", "must be a boolean");
  if (input.description !== undefined && typeof input.description !== "string")
    err("dataset.description", "must be a string");
  if (!Array.isArray(input.products) || input.products.length === 0)
    return {
      ok: false,
      errors: [...errors, "dataset.products: must be a non-empty array"],
    };

  const ids = new Set<string>();
  input.products.forEach((p: unknown, i: number) => {
    let at = `products[${i}]`;
    if (!isObject(p)) return void err(at, "is not an object");
    if (typeof p.id !== "string" || p.id.trim() === "")
      err(at, "id is missing");
    else {
      at = `products[${i}](${p.id})`;
      if (ids.has(p.id)) err(at, `id "${p.id}" is duplicated`);
      ids.add(p.id);
    }
    unknownKeys(p, PRODUCT_KEYS, at, err);
    if (
      p.sources !== undefined &&
      !(
        Array.isArray(p.sources) &&
        p.sources.every((s) => typeof s === "string" && s.trim() !== "")
      )
    )
      err(`${at}.sources`, "must be an array of non-empty strings");

    for (const part of ["gold", "candidate"] as const) {
      const fields = p[part];
      if (!isObject(fields)) {
        err(`${at}.${part}`, "must be an object");
        continue;
      }
      for (const [key, f] of Object.entries(fields)) {
        const where = `${at}.${part}.${key}`;
        if (!isFieldKey(key)) {
          err(where, "unknown field");
          continue;
        }
        if (!isObject(f)) {
          err(where, "must be an object");
          continue;
        }
        if (!(FIELD_STATUSES as readonly unknown[]).includes(f.status)) {
          err(`${where}.status`, "is not a field status");
          continue;
        }
        if (part === "gold") validateGold(key, f, where, err);
        else validateCandidate(f, where, err);
      }
    }

    if (p.human !== undefined) {
      if (!isObject(p.human)) err(`${at}.human`, "must be an object");
      else
        for (const [key, v] of Object.entries(p.human)) {
          if (!isFieldKey(key)) err(`${at}.human.${key}`, "unknown field");
          if (!HUMAN_VERDICTS.includes(v as HumanVerdict))
            err(`${at}.human.${key}`, "must be ACCEPTED, EDITED or REJECTED");
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
      err(`${at}.copyQuality`, "copyQuality must be 1..5");
  });

  return errors.length
    ? { ok: false, errors }
    : { ok: true, dataset: input as unknown as BenchmarkDataset };
}

type Err = (path: string, message: string) => void;

function validateGold(
  field: FieldKey,
  f: Record<string, unknown>,
  where: string,
  err: Err,
): void {
  unknownKeys(f, GOLD_KEYS, where, err);
  const status = f.status as FieldStatus;
  const { value, supportedValues, unsupportedClaim } = f;

  if (value !== undefined && value !== null && !nonEmptyString(value))
    err(`${where}.value`, "must be a non-empty string or null");
  if (
    supportedValues !== undefined &&
    !(Array.isArray(supportedValues) && supportedValues.every(nonEmptyString))
  ) {
    err(`${where}.supportedValues`, "must be an array of non-empty strings");
    return;
  }
  const supported = (supportedValues as string[] | undefined) ?? [];
  if (unsupportedClaim !== undefined) {
    if (typeof unsupportedClaim !== "boolean")
      err(`${where}.unsupportedClaim`, "must be a boolean");
    else if (FIELD_SPECS[field].claims !== "prose")
      err(
        `${where}.unsupportedClaim`,
        "only applies to a prose field (feature bullets, descriptions)",
      );
  }

  // Every gold value must be a valid value of its field, or nothing can ever match it.
  const normalized: string[] = [];
  const check = (raw: unknown, path: string) => {
    if (!nonEmptyString(raw)) return;
    const n = normalizeFieldValue(field, raw);
    if (n.ok) normalized.push(n.value);
    else err(path, `"${raw}" is not a valid ${field} value: ${n.reason}`);
  };
  check(value, `${where}.value`);
  supported.forEach((v, i) => check(v, `${where}.supportedValues[${i}]`));

  switch (status) {
    case "VERIFIED":
      // A prose field is copy, not an extracted value: VERIFIED there means
      // "the facts in the text are supported", and it carries no value.
      if (FIELD_SPECS[field].claims === "prose") break;
      if (!nonEmptyString(value))
        err(`${where}.value`, "a VERIFIED gold field needs a value");
      else if (
        supported.length &&
        !supported.some((s) => s === value || sameValue(field, s, value))
      )
        err(`${where}.supportedValues`, "must include the VERIFIED value");
      break;
    case "CONFLICTING_SOURCES":
      if (value !== undefined && value !== null)
        err(
          `${where}.value`,
          "a CONFLICTING_SOURCES gold field has no single value; use supportedValues",
        );
      if (new Set(normalized).size < 2)
        err(
          `${where}.supportedValues`,
          "a CONFLICTING_SOURCES gold field needs at least two distinct supported values",
        );
      break;
    case "MISSING":
    case "UNVERIFIED":
      if (value !== undefined && value !== null)
        err(`${where}.value`, `a ${status} gold field has no value`);
      if (supported.length)
        err(
          `${where}.supportedValues`,
          `a ${status} gold field has no supported values`,
        );
      break;
    case "SUGGESTED":
      err(
        `${where}.status`,
        "SUGGESTED is a candidate status, not a gold label",
      );
      break;
    case "POSSIBLE_WRONG_VALUE":
      break;
  }
}

function validateCandidate(
  f: Record<string, unknown>,
  where: string,
  err: Err,
): void {
  unknownKeys(f, CANDIDATE_KEYS, where, err);
  const status = f.status as FieldStatus;
  validateProvenanceProps(f, where, err);
  if (f.value !== undefined && f.value !== null && typeof f.value !== "string")
    err(`${where}.value`, "must be a string or null");

  if (status === "VERIFIED" || status === "SUGGESTED") {
    if (!nonEmptyString(f.value))
      err(`${where}.value`, `a ${status} candidate needs a value`);
  } else if (f.value !== undefined && f.value !== null)
    err(
      `${where}.value`,
      `a ${status} candidate carries no value (FieldResult invariant)`,
    );

  if (status === "CONFLICTING_SOURCES" && f.conflicts === undefined)
    err(
      `${where}.conflicts`,
      "a CONFLICTING_SOURCES candidate needs a conflicts array",
    );
  if (f.conflicts === undefined) return;
  if (status !== "CONFLICTING_SOURCES" && status !== "POSSIBLE_WRONG_VALUE")
    err(`${where}.conflicts`, `a ${status} candidate has no conflict set`);
  if (!Array.isArray(f.conflicts))
    return void err(`${where}.conflicts`, "must be an array");

  f.conflicts.forEach((c: unknown, i: number) => {
    const at = `${where}.conflicts[${i}]`;
    if (!isObject(c)) return void err(at, "must be an object");
    unknownKeys(c, CONFLICT_KEYS, at, err);
    if (c.value !== null && typeof c.value !== "string")
      err(`${at}.value`, "must be a string or null");
    for (const k of ["invalidReason", "invalidCode", "unsupportedReason"])
      if (c[k] !== undefined && typeof c[k] !== "string")
        err(`${at}.${k}`, "must be a string");
    if (!Array.isArray(c.sources))
      return void err(`${at}.sources`, "must be an array");
    c.sources.forEach((s: unknown, j: number) => {
      const sp = `${at}.sources[${j}]`;
      if (!isObject(s)) return void err(sp, "must be an object");
      unknownKeys(s, SOURCE_KEYS, sp, err);
      if (s.value !== undefined && typeof s.value !== "string")
        err(`${sp}.value`, "must be a string");
      validateProvenanceProps(s, sp, err);
    });
  });
}

/**
 * The provenance properties: ABSENT is allowed (metric 5 counts it), a WRONG
 * TYPE or an unknown source type is not.
 */
function validateProvenanceProps(
  o: Record<string, unknown>,
  where: string,
  err: Err,
): void {
  if (
    o.sourceType !== undefined &&
    o.sourceType !== null &&
    !isSourceType(o.sourceType)
  )
    err(
      `${where}.sourceType`,
      `unknown source type ${JSON.stringify(o.sourceType)}`,
    );
  for (const k of ["sourceRef", "retrievedAt"])
    if (o[k] !== undefined && o[k] !== null && typeof o[k] !== "string")
      err(`${where}.${k}`, "must be a string or null");
  const c = o.confidence;
  if (
    c !== undefined &&
    c !== null &&
    !(typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1)
  )
    err(`${where}.confidence`, "must be a number in 0..1 or null");
}

function unknownKeys(
  o: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  err: Err,
): void {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) err(`${where}.${k}`, "unknown property");
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
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
  tier: Tier;
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
  /**
   * 4. Asserted factual claims not backed by a source, IN ANY TIER: every
   * field whose `claims` policy is not "none" (all Tier C, compatibility,
   * application, dosing text, feature bullets, descriptions). Editorial
   * fields (SEO title, keywords, ...) are outside it. HARD GATE: must be zero.
   */
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
  let assertedFactual = 0;
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

      // 1. Field extraction accuracy (not prose: copy is not an extracted value).
      if (
        gold?.status === "VERIFIED" &&
        typeof gold.value === "string" &&
        FIELD_SPECS[field].claims !== "prose"
      ) {
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

      // 4. Unsupported factual claims, whatever the tier.
      if (asserted && containsFactualClaims(field)) {
        assertedFactual++;
        const reasons = unsupportedReasons(field, cand, gold, product.sources);
        if (reasons.length) {
          unsupported.push({
            productId: product.id,
            field,
            tier: FIELD_SPECS[field].tier,
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
      rate: ratio(unsupported.length, assertedFactual),
      gate:
        assertedFactual === 0
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
  const policy = FIELD_SPECS[field].claims;

  // The same guard production code would run, applied to the candidate as a
  // result. It is the Tier C rule, so it passes every other tier unchanged.
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

  // The inventory lists EVIDENCE sources. A Jev proposal's reference names its
  // run, not a source, so it is not looked up there; whether its content is
  // supported is the gold label's question below.
  if (
    sources &&
    cand.sourceType !== JEV_PROPOSAL &&
    !isBlank(cand.sourceRef) &&
    !sources.includes(cand.sourceRef!)
  )
    reasons.push(
      `source "${cand.sourceRef}" is not in the product's source inventory`,
    );
  if (gold && (gold.status === "MISSING" || gold.status === "UNVERIFIED"))
    reasons.push(`gold says ${gold.status}: no source supports any value`);
  else if (gold && policy === "prose") {
    // No sentence-level extraction in V0: the labeller's judgement decides.
    if (gold.unsupportedClaim === true)
      reasons.push(
        "the labeller marked an unsupported factual claim in the text",
      );
  } else if (gold) {
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

export function provenanceComplete(cand: CandidateField): boolean {
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
    return conflictProvenanceComplete(cand.conflicts);
  return true;
}

/**
 * A conflict set is provenance-complete only when, for EVERY entry and EVERY
 * source behind it, the value, the source type, the source reference and the
 * retrieval timestamp can be told. Top-level provenance on the candidate does
 * not stand in for it, and neither does the mere count of entries.
 */
export function conflictProvenanceComplete(
  conflicts: BenchmarkConflictEntry[] | undefined,
): boolean {
  if (!Array.isArray(conflicts) || conflicts.length < 2) return false;
  return conflicts.every(
    (entry) =>
      Array.isArray(entry.sources) &&
      entry.sources.length > 0 &&
      entry.sources.every(
        (src) =>
          (typeof entry.value === "string" || nonEmptyString(src.value)) &&
          isSourceType(src.sourceType) &&
          !isBlank(src.sourceRef) &&
          isIsoTimestamp(src.retrievedAt),
      ),
  );
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
    "## 4. Unsupported factual claims (hallucination) rate, every tier",
    `- rate: ${pct(r.unsupportedFacts.rate)}`,
    `- hard gate (must be zero): **${r.unsupportedFacts.gate}**`,
    ...r.unsupportedFacts.items.map(
      (u) =>
        `  - \`${u.productId}\` ${u.field} (Tier ${u.tier}) = "${u.value}": ${u.reasons.join("; ")}`,
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
