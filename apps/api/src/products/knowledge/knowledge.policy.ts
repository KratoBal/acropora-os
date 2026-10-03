import {
  INDEPENDENT_SOURCES,
  fieldSpec,
  isFieldKey,
  isSourceType,
  normalizeFieldValue,
  type FieldKey,
} from "@acropora/jev/product-enrichment";
import {
  PRODUCT_COPY_BLOCKS,
  PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES,
  PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES,
  type ProductCopyBlock,
  type ProductManualEvidenceSourceType,
} from "@acropora/types";

import {
  fieldOutcome,
  type FieldStatement,
  type ProductFacts,
  type StoredCheck,
  type StoredEvidence,
} from "../enrichment/enrichment-run.js";

/**
 * PRODUCT KNOWLEDGE, THE RULES (KZ Amino slice, owner approval on #1431).
 *
 * Pure: rows in, decisions out. The repository reads and writes, the service
 * wires the two; every rule a test should be able to break lives here.
 *
 * THE THREE RULES THAT DO NOT BEND, AND WHERE EACH ONE IS HELD:
 *   1. A fact holds the ACCEPTED STATE only (`factFromResult`): a conflict is
 *      accepted with a null value; its values stay in the JEV result.
 *   2. The status comes from the EXISTING reconciler (`manualEvidenceCheck`
 *      goes through `fieldOutcome` -> `reconcileField`), never from new logic.
 *   3. OS -> Medusa only (`knowledgeProjection`): nothing here reads from the
 *      shop.
 */

// ---------------------------------------------------------------------------
// Manual evidence

export interface ManualEvidence {
  field: FieldKey;
  raw: string;
  /** Already normalized by the field's normalizer. */
  normalized: string;
  /** As the reviewer typed it; the candidate value the reconciler reads. */
  value: string;
  url: string;
  sourceType: ProductManualEvidenceSourceType;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const MAX_RAW = 4000;
const MAX_VALUE = 2000;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The request body of `POST .../knowledge/evidence`, checked in words. */
export function parseManualEvidence(body: unknown): Parsed<ManualEvidence> {
  const input = (body ?? {}) as Record<string, unknown>;
  if (!isFieldKey(input.field))
    return { ok: false, reason: `unknown field "${String(input.field)}"` };
  const field = input.field;

  const raw = text(input.raw);
  if (!raw)
    return {
      ok: false,
      reason: "raw: the source's own words are required, verbatim",
    };
  if (raw.length > MAX_RAW)
    return { ok: false, reason: `raw: longer than ${MAX_RAW} characters` };

  const value = text(input.value);
  if (!value) return { ok: false, reason: "value: required" };
  if (value.length > MAX_VALUE)
    return { ok: false, reason: `value: longer than ${MAX_VALUE} characters` };
  const normal = normalizeFieldValue(field, value);
  if (!normal.ok)
    return {
      ok: false,
      reason: `value: not a valid ${field}: ${normal.reason}`,
    };

  const url = text(input.url);
  if (!url || !isHttpUrl(url))
    return { ok: false, reason: "url: an http(s) address is required" };

  if (
    !(PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES as readonly unknown[]).includes(
      input.sourceType,
    )
  )
    return {
      ok: false,
      reason: `sourceType: one of ${PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES.join(", ")}`,
    };

  return {
    ok: true,
    value: {
      field,
      raw,
      normalized: normal.value,
      value,
      url,
      sourceType: input.sourceType as ProductManualEvidenceSourceType,
    },
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The statements an earlier result of the field already holds, so a new
 * manual entry is ADDED to what is known instead of replacing it. Our own
 * value is left out: `fieldOutcome` adds the current one itself, so an old
 * copy of it would be counted twice.
 */
export function earlierStatements(evidence: unknown): FieldStatement[] {
  if (!Array.isArray(evidence)) return [];
  return (evidence as Partial<StoredEvidence>[]).flatMap(
    (entry): FieldStatement[] => {
      if (
        entry.sourceKind === "OS" ||
        typeof entry.raw !== "string" ||
        !isSourceType(entry.sourceType) ||
        entry.sourceKind === undefined
      )
        return [];
      return [
        {
          candidate: {
            value: entry.raw,
            sourceType: entry.sourceType,
            sourceRef: entry.sourceRef ?? null,
            retrievedAt: entry.retrievedAt ?? null,
            confidence: null,
          },
          excerpt: entry.excerpt ?? "",
          kind: entry.sourceKind,
          ...(entry.manual && entry.enteredById
            ? { manual: { enteredById: entry.enteredById } }
            : {}),
        },
      ];
    },
  );
}

/**
 * ONE MANUAL ENTRY AS AN ORDINARY JEV CHECK.
 *
 * The check holds one field and one fetch (the entered URL, FETCHED). The
 * field is reconciled from everything the field's latest result already
 * holds plus the new statement, through the same `fieldOutcome` a crawl run
 * uses, so two manual entries with different normalized values come out as
 * CONFLICTING_SOURCES by the existing rule, not by a new one.
 */
export function manualEvidenceCheck(input: {
  evidence: ManualEvidence;
  earlier: readonly FieldStatement[];
  facts: ProductFacts;
  enteredById: string;
  now: Date;
}): StoredCheck {
  const { evidence, facts, now } = input;
  const at = now.toISOString();
  const statement: FieldStatement = {
    candidate: {
      value: evidence.value,
      sourceType: evidence.sourceType,
      sourceRef: evidence.url,
      retrievedAt: at,
      confidence: null,
    },
    excerpt: evidence.raw,
    kind: "MANUAL",
    manual: { enteredById: input.enteredById },
  };
  const field = fieldOutcome(
    evidence.field,
    facts,
    [...input.earlier, statement],
    at,
  );
  return {
    productId: facts.productId,
    checkedAt: now,
    sourceCount: 1,
    fieldCount: 1,
    fetches: [
      {
        sourceKind: "MANUAL",
        url: evidence.url,
        outcome: "FETCHED",
        reason: "MANUAL_EVIDENCE",
        httpStatus: null,
        fetchedAt: now,
        fieldCount: 1,
      },
    ],
    fields: [field],
  };
}

// ---------------------------------------------------------------------------
// Accepting a result

export interface AcceptableResult {
  field: string;
  status: string;
  value: string | null;
}

export type FactDecision =
  | { ok: true; value: string | null; unit: string | null; status: string }
  | { ok: false; reason: string };

/**
 * WHAT A FACT HOLDS WHEN A RESULT IS ACCEPTED.
 *
 * VERIFIED / SUGGESTED: the result's value. CONFLICTING_SOURCES: NO value,
 * the status kept; the values and their sources stay in the JEV result the
 * fact points at, and nothing of the conflict is copied (owner, #1431
 * 16:33 UTC). Any other status has nothing to accept.
 */
export function factFromResult(result: AcceptableResult): FactDecision {
  if (!isFieldKey(result.field))
    return { ok: false, reason: `unknown field "${result.field}"` };
  if (
    !(PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES as readonly string[]).includes(
      result.status,
    )
  )
    return {
      ok: false,
      reason: `a ${result.status} result has nothing to accept`,
    };
  if (result.status === "CONFLICTING_SOURCES")
    return {
      ok: true,
      value: null,
      unit: null,
      status: "CONFLICTING_SOURCES",
    };
  if (result.value === null)
    return { ok: false, reason: `a ${result.status} result without a value` };
  return { ok: true, status: result.status, ...splitUnit(result) };
}

/** A quantity travels as its number and its canonical unit; the rest as is. */
function splitUnit(result: { field: string; value: string | null }): {
  value: string | null;
  unit: string | null;
} {
  const value = result.value;
  if (
    value !== null &&
    isFieldKey(result.field) &&
    fieldSpec(result.field).kind.kind === "quantity"
  ) {
    const space = value.indexOf(" ");
    if (space > 0)
      return { value: value.slice(0, space), unit: value.slice(space + 1) };
  }
  return { value, unit: null };
}

interface StoredConflictEntry {
  value: string | null;
  sources?: { sourceType?: string }[];
  invalidReason?: string;
  unsupportedReason?: string;
}

/**
 * A HUMAN PICKS ONE VALUE OF A CONFLICT.
 *
 * The chosen value must be one the sources actually stated (one of the
 * conflict's accepted groups), and at least one INDEPENDENT source must
 * state it: a value backed only by our own catalogue cannot become VERIFIED
 * by a click. The losing value stays in the JEV result, nowhere else.
 */
export function resolvedFact(
  result: AcceptableResult & { conflicts: unknown },
  chosen: unknown,
): FactDecision {
  if (!isFieldKey(result.field))
    return { ok: false, reason: `unknown field "${result.field}"` };
  if (result.status !== "CONFLICTING_SOURCES")
    return {
      ok: false,
      reason: `only a conflict can be resolved, this result is ${result.status}`,
    };
  const raw = text(chosen);
  if (!raw) return { ok: false, reason: "value: required" };
  const normal = normalizeFieldValue(result.field, raw);
  if (!normal.ok)
    return { ok: false, reason: `value: not a valid ${result.field}` };

  const entries = Array.isArray(result.conflicts)
    ? (result.conflicts as StoredConflictEntry[])
    : [];
  const entry = entries.find(
    (e) => e.value === normal.value && !e.invalidReason && !e.unsupportedReason,
  );
  if (!entry)
    return {
      ok: false,
      reason: "value: not one of the values the sources state",
    };
  const independent = (entry.sources ?? []).some(
    (source) =>
      isSourceType(source.sourceType) &&
      INDEPENDENT_SOURCES.has(source.sourceType),
  );
  if (!independent)
    return {
      ok: false,
      reason:
        "value: no independent source states it, so it cannot be verified",
    };
  return {
    ok: true,
    status: "VERIFIED",
    ...splitUnit({ field: result.field, value: normal.value }),
  };
}

// ---------------------------------------------------------------------------
// Copy

export function isCopyBlock(value: unknown): value is ProductCopyBlock {
  return (PRODUCT_COPY_BLOCKS as readonly unknown[]).includes(value);
}

const MAX_COPY: Record<ProductCopyBlock, number> = {
  lead: 2000,
  body: 20000,
  seoTitle: 300,
  metaDescription: 1000,
};

/** The copy body as saved: trimmed, `\r\n` as `\n`; one line for SEO. */
export function parseCopyBody(
  block: ProductCopyBlock,
  body: unknown,
): Parsed<string> {
  if (typeof body !== "string") return { ok: false, reason: "body: required" };
  const value = body.replace(/\r\n?/g, "\n").trim();
  if (value === "") return { ok: false, reason: "body: empty" };
  if (value.length > MAX_COPY[block])
    return {
      ok: false,
      reason: `body: longer than ${MAX_COPY[block]} characters`,
    };
  if ((block === "seoTitle" || block === "metaDescription") && /\n/.test(value))
    return { ok: false, reason: `${block} is a single line` };
  return { ok: true, value };
}

export type Revisions = Record<string, number>;

export function currentRevisions(
  facts: readonly { field: string; revision: number }[],
): Revisions {
  return Object.fromEntries(facts.map((fact) => [fact.field, fact.revision]));
}

/**
 * STALE: THE FACTS ARE NOT THE ONES THE COPY WAS WRITTEN AGAINST.
 *
 * Any difference counts: a revision moved, a fact was accepted after the
 * save, or one went away. Computed on every read from `basedOn`, never
 * stored, so it cannot drift from the facts.
 */
export function copyIsStale(basedOn: unknown, current: Revisions): boolean {
  if (!basedOn || typeof basedOn !== "object" || Array.isArray(basedOn))
    return true;
  const saved = basedOn as Record<string, unknown>;
  const keys = new Set([...Object.keys(saved), ...Object.keys(current)]);
  for (const key of keys) if (saved[key] !== current[key]) return true;
  return false;
}

export interface CopyRow {
  block: ProductCopyBlock;
  body: string;
  status: "DRAFT" | "APPROVED";
  revision: number;
  basedOn: unknown;
}

function publishable(row: CopyRow | undefined, revisions: Revisions): boolean {
  return (
    row !== undefined &&
    row.status === "APPROVED" &&
    !copyIsStale(row.basedOn, revisions)
  );
}

/** Plain-text paragraphs (blank-line separated) as the shop's HTML. */
export function copyToHtml(paragraphs: readonly string[]): string {
  return paragraphs
    .flatMap((text) => text.split(/\n{2,}/))
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ProjectedCopy {
  /** HTML for the shop's `description`, or `null`: today's stays. */
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

/**
 * WHAT OF THE COPY GOES INTO THE NORMAL PRODUCT PROJECTION.
 *
 * Only for a product WE master (`ACROPORA`): while UNAS owns the master data
 * it also owns the description, and an OS text would fight its sync.
 *
 * The description is all or nothing over `lead` and `body`: if every one of
 * them that exists is approved and not stale, they replace today's text;
 * if any is a draft or stale, today's description stays exactly as it is.
 * A partial swap would shrink a live page to its lead while the body waits.
 * The SEO title and meta description go one by one: each replaces today's
 * value only when it is approved and not stale.
 */
export function projectedCopy(
  rows: readonly CopyRow[],
  revisions: Revisions,
  catalogAuthority: string | null,
): ProjectedCopy | null {
  if (catalogAuthority !== "ACROPORA") return null;
  const by = new Map(rows.map((row) => [row.block, row]));
  const textBlocks = (["lead", "body"] as const)
    .map((block) => by.get(block))
    .filter((row): row is CopyRow => row !== undefined);
  const description =
    textBlocks.length > 0 &&
    textBlocks.every((row) => publishable(row, revisions))
      ? copyToHtml(textBlocks.map((row) => row.body))
      : null;
  const seoTitle = by.get("seoTitle");
  const meta = by.get("metaDescription");
  const result: ProjectedCopy = {
    description,
    seoTitle: publishable(seoTitle, revisions) ? seoTitle!.body : null,
    seoDescription: publishable(meta, revisions) ? meta!.body : null,
  };
  return result.description || result.seoTitle || result.seoDescription
    ? result
    : null;
}

// ---------------------------------------------------------------------------
// The projection payload (the PR A / PR B contract)

export interface KnowledgeProjectionFact {
  field: string;
  value: string | null;
  unit: string | null;
  status: string;
  source_type: string | null;
  revision: number;
}

export interface KnowledgeProjectionCopy {
  block: "lead" | "body";
  body: string;
  revision: number;
}

export interface KnowledgeProjection {
  facts: KnowledgeProjectionFact[];
  copy: KnowledgeProjectionCopy[];
}

export interface FactRow {
  field: string;
  value: string | null;
  unit: string | null;
  status: string;
  revision: number;
  /** Read through the pointer: the JEV result's primary source. */
  sourceType: string | null;
}

/**
 * THE BODY OF `PUT /admin/product-knowledge/:product_id`, sorted so that two
 * builds of the same state are equal. Every accepted fact goes, its status
 * unchanged (never flattened). The copy carries the APPROVED, NOT STALE
 * `lead` and `body` only; SEO goes through the normal product projection.
 */
export function knowledgeProjection(
  facts: readonly FactRow[],
  copy: readonly CopyRow[],
): KnowledgeProjection {
  const revisions = currentRevisions(facts);
  return {
    facts: [...facts]
      .sort((a, b) => a.field.localeCompare(b.field))
      .map((fact) => ({
        field: fact.field,
        value: fact.status === "CONFLICTING_SOURCES" ? null : fact.value,
        unit: fact.status === "CONFLICTING_SOURCES" ? null : fact.unit,
        status: fact.status,
        // A conflict has no single source to name.
        source_type:
          fact.status === "CONFLICTING_SOURCES" ? null : fact.sourceType,
        revision: fact.revision,
      })),
    copy: copy
      .filter(
        (row): row is CopyRow & { block: "lead" | "body" } =>
          (row.block === "lead" || row.block === "body") &&
          publishable(row, revisions),
      )
      .sort((a, b) => (a.block === b.block ? 0 : a.block === "lead" ? -1 : 1))
      .map((row) => ({
        block: row.block,
        body: row.body,
        revision: row.revision,
      })),
  };
}

/**
 * DOES THE SHOP ALREADY HOLD EXACTLY THIS? The comparison is on the contract
 * fields only, order-free, so the answer is "already so" versus "set now",
 * which is what the report says (the shipping-attributes pattern).
 */
export function knowledgeProjectionDiffers(
  current: KnowledgeProjection | null,
  wanted: KnowledgeProjection,
): boolean {
  if (!current) return wanted.facts.length > 0 || wanted.copy.length > 0;
  return canonical(current) !== canonical(wanted);
}

function canonical(value: KnowledgeProjection): string {
  const facts = (value.facts ?? [])
    .map((f) => [
      f.field,
      f.value ?? null,
      f.unit ?? null,
      f.status,
      f.source_type ?? null,
      f.revision,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const copy = (value.copy ?? [])
    .map((c) => [c.block, c.body, c.revision])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({ facts, copy });
}
