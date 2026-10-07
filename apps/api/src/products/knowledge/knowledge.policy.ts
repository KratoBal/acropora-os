import {
  INDEPENDENT_SOURCES,
  comparisonKey,
  fieldSpec,
  isFieldKey,
  isSourceType,
  normalizeFieldValue,
  type FieldKey,
} from "@acropora/jev/product-enrichment";
import {
  PRODUCT_COPY_BLOCKS,
  PRODUCT_KNOWLEDGE_ACCEPTABLE_STATUSES,
  PRODUCT_KNOWLEDGE_PUBLIC_STATUSES,
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
  sources?: {
    sourceType?: string;
    sourceRef?: string | null;
    retrievedAt?: string | null;
  }[];
  invalidReason?: string;
  unsupportedReason?: string;
}

/** The conflict group a human may pick: stated by a source, valid, supported. */
function pickableEntry(
  field: FieldKey,
  conflicts: unknown,
  normalized: string,
): StoredConflictEntry | null {
  const entries = Array.isArray(conflicts)
    ? (conflicts as StoredConflictEntry[])
    : [];
  const key = comparisonKey(field, normalized);
  return (
    entries.find(
      (e) =>
        typeof e.value === "string" &&
        comparisonKey(field, e.value) === key &&
        !e.invalidReason &&
        !e.unsupportedReason,
    ) ?? null
  );
}

/** The reconciler's primary source: the first independent one, in precedence order. */
function firstIndependent(entry: StoredConflictEntry) {
  return (
    (entry.sources ?? []).find(
      (source) =>
        isSourceType(source.sourceType) &&
        INDEPENDENT_SOURCES.has(source.sourceType),
    ) ?? null
  );
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

  const entry = pickableEntry(result.field, result.conflicts, normal.value);
  if (!entry || entry.value === null)
    return {
      ok: false,
      reason: "value: not one of the values the sources state",
    };
  if (!firstIndependent(entry))
    return {
      ok: false,
      reason:
        "value: no independent source states it, so it cannot be verified",
    };
  // The group's own spelling, as the reconciler stores it: a value picked in
  // another letter case is the same value (`comparisonKey`).
  return {
    ok: true,
    status: "VERIFIED",
    ...splitUnit({ field: result.field, value: entry.value }),
  };
}

export interface FactSource {
  sourceType: string | null;
  sourceRef: string | null;
  retrievedAt: string | null;
}

/**
 * WHERE AN ACCEPTED FACT'S VALUE CAME FROM, READ THROUGH ITS POINTER.
 *
 * Accepted from a VERIFIED / SUGGESTED result (or as a conflict): the
 * result's own primary source, as before. RESOLVED from a conflict: the
 * result the fact points at is the conflict, whose own source is null
 * (`reconcileField` names no source for a conflict). The source is then the
 * one the reconciler would have named for the chosen group: its first
 * independent source, the same one `resolvedFact` required. KZ Amino stage
 * run (#1431 comment 5972125293, finding 4): `application` and
 * `packageContents` projected with `source_type: null`.
 *
 * Derived on read, like the rest of the source, so nothing about the
 * conflict is copied onto the fact.
 */
export function factSource(
  fact: {
    field: string;
    status: string;
    value: string | null;
    unit: string | null;
  },
  pointer: {
    status: string;
    sourceType: string | null;
    sourceRef: string | null;
    retrievedAt: string | null;
    conflicts: unknown;
  },
): FactSource {
  const own: FactSource = {
    sourceType: pointer.sourceType,
    sourceRef: pointer.sourceRef,
    retrievedAt: pointer.retrievedAt,
  };
  if (
    pointer.status !== "CONFLICTING_SOURCES" ||
    fact.status === "CONFLICTING_SOURCES" ||
    fact.value === null ||
    !isFieldKey(fact.field)
  )
    return own;
  const whole = fact.unit ? `${fact.value} ${fact.unit}` : fact.value;
  const entry = pickableEntry(fact.field, pointer.conflicts, whole);
  const source = entry ? firstIndependent(entry) : null;
  if (!source) return own;
  return {
    sourceType: source.sourceType ?? null,
    sourceRef: source.sourceRef ?? null,
    retrievedAt: source.retrievedAt ?? null,
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
 * Computed on every read from `basedOn`, never stored, so it cannot drift
 * from the facts.
 *
 * WHICH FACTS COUNT (SEO P0 PR 1b, Balázs 2026-10-07): a block names the facts
 * it is built on (`usedFields`), and only those count. A used fact whose
 * revision moved, or that went away, makes the block stale; a change to any
 * other fact does not. With an EMPTY list (every block saved before PR 1b,
 * until it is saved again) the old product-wide rule stands: any difference
 * counts, a fact accepted after the save included.
 */
export function copyIsStale(
  basedOn: unknown,
  current: Revisions,
  usedFields: readonly string[] = [],
): boolean {
  if (!basedOn || typeof basedOn !== "object" || Array.isArray(basedOn))
    return true;
  const saved = basedOn as Record<string, unknown>;
  const keys =
    usedFields.length > 0
      ? new Set(usedFields)
      : new Set([...Object.keys(saved), ...Object.keys(current)]);
  for (const key of keys)
    if (saved[key] === undefined || saved[key] !== current[key]) return true;
  return false;
}

/**
 * THE `basedOn` A SAVE STORES: the revisions of the used facts, or, with an
 * empty list, of all of them (the product-wide rule).
 */
export function savedRevisions(
  facts: readonly { field: string; revision: number }[],
  usedFields: readonly string[],
): Revisions {
  const all = currentRevisions(facts);
  if (usedFields.length === 0) return all;
  return Object.fromEntries(usedFields.map((field) => [field, all[field]!]));
}

/**
 * THE FIELDS A SAVE NAMES: optional (absent = empty, the product-wide rule), a
 * list of distinct strings, each a fact this product has NOW. A block cannot
 * be built on a fact that is not there; naming one would make it stale (or
 * unpublishable) from the first read, without saying why.
 */
export function parseUsedFields(
  value: unknown,
  facts: readonly { field: string }[],
): Parsed<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    return { ok: false, reason: "usedFields: a list of field keys" };
  const present = new Set(facts.map((fact) => fact.field));
  const unknown = (value as string[]).filter((field) => !present.has(field));
  if (unknown.length > 0)
    return {
      ok: false,
      reason: `usedFields: no accepted fact for ${unknown.join(", ")}`,
    };
  return { ok: true, value: Array.from(new Set(value as string[])).sort() };
}

export interface CopyRow {
  block: ProductCopyBlock;
  body: string;
  status: "DRAFT" | "APPROVED";
  revision: number;
  basedOn: unknown;
  /**
   * The facts the block is built on, by fact key (`ProductKnowledgeFact.field`,
   * no variant part); empty = the product-wide rule. REQUIRED, not optional:
   * a reader whose select forgot the column would otherwise fall back to the
   * product-wide rule without a sound, and the shop and the panel would
   * count differently (barracuda, PR 1b preview, point A). The compiler now
   * names such a reader.
   */
  usedFields: readonly string[];
}

/** The facts as they are now: what the copy is measured against. */
export interface FactState {
  field: string;
  revision: number;
  status: string;
  /**
   * The fact's definition is `public` (SEO P0 PR 2): the buyer may see this
   * kind of fact at all. REQUIRED, so a reader that forgot to bind the
   * definitions does not compile (decision 10); a fact with no definition is
   * `false`.
   */
  public: boolean;
}

/** May the buyer see this fact (D5)? Only VERIFIED. */
export function isPublicFact(fact: { status: string }): boolean {
  return (PRODUCT_KNOWLEDGE_PUBLIC_STATUSES as readonly string[]).includes(
    fact.status,
  );
}

/**
 * MAY THIS FACT LEAVE THE OS (SEO P0 PR 2): VERIFIED (D5) AND its definition is
 * `public` (C8, the second line). Both gates sit on the OUTPUT, never on the
 * input of `copyIsStale` (decision 7).
 */
export function canLeave(fact: { status: string; public: boolean }): boolean {
  return isPublicFact(fact) && fact.public;
}

/**
 * EVERY FACT THE COPY IS BUILT ON IS VERIFIED NOW (D5, card 4622f1ac).
 *
 * Prose can state a value, so an approved text built on a SUGGESTED or an
 * unresolved conflicting fact would publish what the fact gate holds back.
 *
 * PER BLOCK (SEO P0 PR 1b, Balázs 2026-10-07): a block with `usedFields`
 * depends only on those facts, so a conflicting `dosing` no longer holds back
 * a lead that states no dosing. With an empty list `basedOn` holds ALL the
 * product's facts at save time, and the old product-wide rule stands: one
 * non-VERIFIED fact holds the block back.
 */
function basedOnVerified(
  basedOn: unknown,
  facts: readonly FactState[],
  usedFields: readonly string[] = [],
): boolean {
  if (!basedOn || typeof basedOn !== "object" || Array.isArray(basedOn))
    return false;
  // decision 6: a VERIFIED fact the buyer may not see (`public = false`)
  // does not appear in prose either
  const verified = new Set(
    facts.filter((fact) => canLeave(fact)).map((fact) => fact.field),
  );
  const fields = usedFields.length > 0 ? usedFields : Object.keys(basedOn);
  return fields.every((field) => verified.has(field));
}

function publishable(
  row: CopyRow | undefined,
  facts: readonly FactState[],
): boolean {
  return (
    row !== undefined &&
    row.status === "APPROVED" &&
    !copyIsStale(row.basedOn, currentRevisions(facts), row.usedFields) &&
    basedOnVerified(row.basedOn, facts, row.usedFields)
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
 * value only when it is approved, not stale, and written against VERIFIED
 * facts only (`basedOnVerified`).
 */
export function projectedCopy(
  rows: readonly CopyRow[],
  facts: readonly FactState[],
  catalogAuthority: string | null,
): ProjectedCopy | null {
  if (catalogAuthority !== "ACROPORA") return null;
  const by = new Map(rows.map((row) => [row.block, row]));
  const textBlocks = (["lead", "body"] as const)
    .map((block) => by.get(block))
    .filter((row): row is CopyRow => row !== undefined);
  const description =
    textBlocks.length > 0 && textBlocks.every((row) => publishable(row, facts))
      ? copyToHtml(textBlocks.map((row) => row.body))
      : null;
  const seoTitle = by.get("seoTitle");
  const meta = by.get("metaDescription");
  const result: ProjectedCopy = {
    description,
    seoTitle: publishable(seoTitle, facts) ? seoTitle!.body : null,
    seoDescription: publishable(meta, facts) ? meta!.body : null,
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
  /**
   * The definition's `public` flag (decision 5): the commerce store route
   * filters on it a second time, as it does on the status. Every fact that
   * leaves carries `true`; the field is there for that second gate.
   */
  public: boolean;
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
  /** The definition's `public` flag; `false` with no definition (PR 2). */
  public: boolean;
  /** Read through the pointer: the JEV result's primary source. */
  sourceType: string | null;
}

/**
 * THE BODY OF `PUT /admin/product-knowledge/:product_id`, sorted so that two
 * builds of the same state are equal. Only the facts the buyer may see go
 * (D5: VERIFIED, and since PR 2 a `public` definition: `canLeave`); the others
 * stay in the OS. The copy carries the APPROVED,
 * NOT STALE `lead` and `body` written against VERIFIED facts only; SEO goes
 * through the normal product projection.
 *
 * THE GATE IS ON THE OUTPUT, NOT THE INPUT (nautilus, review point 1). The
 * copy's staleness is measured against the facts as they are (all of them for
 * a block without `usedFields`, the used ones otherwise): `copyIsStale` counts
 * a missing fact as a change, so filtering the input would make a text built
 * on (or, product-wide, beside) a SUGGESTED fact look stale. Only the list
 * handed out is filtered.
 */
export function knowledgeProjection(
  facts: readonly FactRow[],
  copy: readonly CopyRow[],
): KnowledgeProjection {
  return {
    facts: facts
      .filter((fact) => canLeave(fact))
      .sort((a, b) => a.field.localeCompare(b.field))
      .map((fact) => ({
        field: fact.field,
        value: fact.value,
        unit: fact.unit,
        status: fact.status,
        source_type: fact.sourceType,
        revision: fact.revision,
        public: fact.public,
      })),
    copy: copy
      .filter(
        (row): row is CopyRow & { block: "lead" | "body" } =>
          (row.block === "lead" || row.block === "body") &&
          publishable(row, facts),
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
      // a shop row written before PR 2c has no flag: that is a difference, and
      // the next projection writes it
      f.public ?? null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const copy = (value.copy ?? [])
    .map((c) => [c.block, c.body, c.revision])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({ facts, copy });
}
