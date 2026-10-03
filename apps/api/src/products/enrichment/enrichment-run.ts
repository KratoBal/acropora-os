import {
  fieldSpec,
  guardFieldResult,
  normalizeFieldValue,
  reconcileField,
  type FieldResult,
  type SourcedValue,
} from "@acropora/jev/product-enrichment";

import { extractMarineAquaticsStatement } from "./marine-aquatics-extract.js";
import {
  ENRICHED_FIELDS,
  extractPageStatement,
  type EnrichedField,
} from "./page-extract.js";
import {
  PoliteFetcher,
  RequestLimitReached,
  type EnrichmentFetch,
} from "./polite-fetcher.js";
import {
  SOURCE_EVIDENCE_TYPE,
  baseDomainOf,
  manufacturerSites,
  sourceUrlProblem,
  type EnrichmentSourceKind,
} from "./enrichment-sources.js";

/**
 * ONE MANUAL RUN OF THE FIRST LIVE ROUND, IN SHADOW (PD-013 items 3-4).
 *
 * For each product, in the order given: the source pages (the ones given by
 * hand, plus the manufacturer link UNAS holds), read politely, their
 * structured data extracted, and every field reconciled with the V0 model
 * against our own current value. The result is stored per field with its
 * sources, URLs, read times and evidence.
 *
 * THE PRODUCT IS NEVER WRITTEN. The store this run gets can only start and
 * finish a run and save a check; it has no product method at all, and
 * `enrichment-run.store.ts` only writes the four enrichment tables.
 *
 * LIMITS: a run has a product limit and a request limit. Reaching either ends
 * the run with status LIMIT_REACHED; the product being read when the request
 * limit hit is not stored half-done.
 */
export const DEFAULT_PRODUCT_LIMIT = 20;
export const MAX_PRODUCT_LIMIT = 50;
export const DEFAULT_REQUEST_LIMIT = 200;
export const MAX_REQUEST_LIMIT = 1000;

export interface RunSourceInput {
  kind: EnrichmentSourceKind;
  url: string;
  /** For a SUPPLIER source: whose website the URL must be on. */
  supplierId?: string;
}

export interface RunProductInput {
  productId: string;
  sources: readonly RunSourceInput[];
}

/** What we hold about a product, read before the run touches the network. */
export interface ProductFacts {
  productId: string;
  name: string;
  brandWebsiteUrl: string | null;
  unasManufacturerUrl: string | null;
  /** Our own current values, raw, per field. */
  current: Partial<Record<EnrichedField, string>>;
}

export interface StoredFetch {
  sourceKind: EnrichmentSourceKind;
  url: string;
  outcome: "FETCHED" | "UNAVAILABLE" | "REFUSED";
  reason: string | null;
  httpStatus: number | null;
  fetchedAt: Date;
  fieldCount: number;
}

export interface StoredEvidence {
  sourceType: string;
  sourceKind: EnrichmentSourceKind | "OS";
  sourceRef: string | null;
  retrievedAt: string | null;
  raw: string;
  excerpt: string | null;
  accepted: boolean;
  reason?: string;
}

export interface StoredField {
  field: EnrichedField;
  tier: "A" | "B" | "C";
  status: FieldResult["status"];
  value: string | null;
  sourceType: string | null;
  sourceRef: string | null;
  retrievedAt: Date | null;
  confidence: number | null;
  currentValue: string | null;
  evidence: StoredEvidence[];
  conflicts: unknown;
}

export interface StoredCheck {
  productId: string;
  checkedAt: Date;
  sourceCount: number;
  fieldCount: number;
  fetches: StoredFetch[];
  fields: StoredField[];
}

export type RunStatus = "COMPLETED" | "LIMIT_REACHED" | "FAILED";

export interface EnrichmentRunStore {
  startRun(input: {
    requestedById: string;
    productLimit: number;
    requestLimit: number;
  }): Promise<string>;
  saveCheck(runId: string, check: StoredCheck): Promise<void>;
  finishRun(
    runId: string,
    result: {
      status: RunStatus;
      productCount: number;
      requestCount: number;
      errorCode: string | null;
    },
  ): Promise<void>;
}

export interface EnrichmentFactsReader {
  productFacts(productId: string): Promise<ProductFacts | null>;
  supplierWebsite(supplierId: string): Promise<string | null>;
}

export interface RunOptions {
  requestedById: string;
  productLimit: number;
  requestLimit: number;
}

export interface RunDeps {
  store: EnrichmentRunStore;
  facts: EnrichmentFactsReader;
  fetch: EnrichmentFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  productCount: number;
  requestCount: number;
  /** Why the run stopped early, when it did. */
  limit: "PRODUCTS" | "REQUESTS" | null;
  checks: StoredCheck[];
}

export class UnknownProductError extends Error {
  constructor(readonly productId: string) {
    super(`UNKNOWN_PRODUCT ${productId}`);
    this.name = "UnknownProductError";
  }
}

const OS_REF = (productId: string) => `os:product:${productId}`;

export async function runEnrichment(
  products: readonly RunProductInput[],
  options: RunOptions,
  deps: RunDeps,
): Promise<RunSummary> {
  // Every product must exist before anything is fetched or stored.
  const facts: ProductFacts[] = [];
  for (const product of products) {
    const found = await deps.facts.productFacts(product.productId);
    if (!found) throw new UnknownProductError(product.productId);
    facts.push(found);
  }

  const runId = await deps.store.startRun(options);
  const fetcher = new PoliteFetcher({
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
    requestLimit: options.requestLimit,
  });
  const checks: StoredCheck[] = [];
  let limit: RunSummary["limit"] = null;

  try {
    for (const [index, product] of products.entries()) {
      if (checks.length >= options.productLimit) {
        limit = "PRODUCTS";
        break;
      }
      try {
        const check = await checkProduct(product, facts[index]!, fetcher, deps);
        await deps.store.saveCheck(runId, check);
        checks.push(check);
      } catch (error) {
        if (error instanceof RequestLimitReached) {
          limit = "REQUESTS";
          break;
        }
        throw error;
      }
    }
  } catch (error) {
    await deps.store.finishRun(runId, {
      status: "FAILED",
      productCount: checks.length,
      requestCount: fetcher.requestCount,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
    });
    throw error;
  }

  const status: RunStatus = limit ? "LIMIT_REACHED" : "COMPLETED";
  await deps.store.finishRun(runId, {
    status,
    productCount: checks.length,
    requestCount: fetcher.requestCount,
    errorCode: limit ? `${limit}_LIMIT_REACHED` : null,
  });
  return {
    runId,
    status,
    productCount: checks.length,
    requestCount: fetcher.requestCount,
    limit,
    checks,
  };
}

/** The sources of a product: the given ones and the UNAS manufacturer link. */
export function sourcesFor(
  input: RunProductInput,
  facts: ProductFacts,
): RunSourceInput[] {
  const all: RunSourceInput[] = [...input.sources];
  if (facts.unasManufacturerUrl && baseDomainOf(facts.unasManufacturerUrl))
    all.push({ kind: "MANUFACTURER", url: facts.unasManufacturerUrl });
  const seen = new Set<string>();
  return all.filter((source) => {
    const key = `${source.kind} ${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function checkProduct(
  input: RunProductInput,
  facts: ProductFacts,
  fetcher: PoliteFetcher,
  deps: RunDeps,
): Promise<StoredCheck> {
  const checkedAt = deps.now();
  const manufacturer = manufacturerSites(
    facts.brandWebsiteUrl,
    facts.unasManufacturerUrl,
  );
  const fetches: StoredFetch[] = [];
  const pageCandidates: {
    field: EnrichedField;
    candidate: SourcedValue;
    excerpt: string;
    kind: EnrichmentSourceKind;
  }[] = [];

  for (const source of sourcesFor(input, facts)) {
    const supplier =
      source.kind === "SUPPLIER" && source.supplierId
        ? baseDomainOf(await deps.facts.supplierWebsite(source.supplierId))
        : null;
    const sites = { manufacturer, supplier };
    const refusal = sourceUrlProblem(source.kind, source.url, sites);
    if (refusal) {
      fetches.push({
        sourceKind: source.kind,
        url: source.url,
        outcome: "REFUSED",
        reason: refusal,
        httpStatus: null,
        fetchedAt: deps.now(),
        fieldCount: 0,
      });
      continue;
    }
    const page = await fetcher.page(
      source.url,
      (next) => sourceUrlProblem(source.kind, next, sites) === null,
    );
    if (!page.ok) {
      fetches.push({
        sourceKind: source.kind,
        url: source.url,
        outcome: "UNAVAILABLE",
        reason: page.reason,
        httpStatus: page.httpStatus,
        fetchedAt: page.fetchedAt,
        fieldCount: 0,
      });
      continue;
    }
    const structured = extractPageStatement(page.html);
    // marine-aquatics.eu states its data in labelled rows, not JSON-LD.
    const statement =
      source.kind === "MARINE_AQUATICS" && structured.values.length === 0
        ? extractMarineAquaticsStatement(page.html)
        : structured;
    fetches.push({
      sourceKind: source.kind,
      url: page.url,
      outcome: "FETCHED",
      reason: statement.note,
      httpStatus: page.httpStatus,
      fetchedAt: page.fetchedAt,
      fieldCount: statement.values.length,
    });
    for (const value of statement.values)
      pageCandidates.push({
        field: value.field,
        kind: source.kind,
        excerpt: value.excerpt,
        candidate: {
          value: value.raw,
          sourceType: SOURCE_EVIDENCE_TYPE[source.kind],
          sourceRef: page.url,
          retrievedAt: page.fetchedAt.toISOString(),
          confidence: null,
        },
      });
  }

  const reconciledAt = checkedAt.toISOString();
  const fields = ENRICHED_FIELDS.map((field) =>
    fieldOutcome(
      field,
      facts,
      pageCandidates.filter((c) => c.field === field),
      reconciledAt,
    ),
  );
  return {
    productId: facts.productId,
    checkedAt,
    sourceCount: fetches.filter((f) => f.outcome === "FETCHED").length,
    fieldCount: fields.filter((f) =>
      f.evidence.some((e) => e.sourceKind !== "OS"),
    ).length,
    fetches,
    fields,
  };
}

function normalised(field: EnrichedField, raw: string): string | null {
  const result = normalizeFieldValue(field, raw);
  return result.ok ? result.value : null;
}

/**
 * One field: reconciled with the V0 model when a page stated it; otherwise
 * our own value alone is UNVERIFIED (it cannot verify itself), and no value
 * at all is MISSING. Tier C goes through the V0 guard as well.
 */
export function fieldOutcome(
  field: EnrichedField,
  facts: ProductFacts,
  fromPages: readonly {
    candidate: SourcedValue;
    excerpt: string;
    kind: EnrichmentSourceKind;
  }[],
  reconciledAt: string,
): StoredField {
  const tier = fieldSpec(field).tier;
  const currentRaw = facts.current[field] ?? null;
  const currentValue =
    currentRaw === null ? null : (normalised(field, currentRaw) ?? currentRaw);
  const own: SourcedValue | null =
    currentRaw === null
      ? null
      : {
          value: currentRaw,
          sourceType: "OS_PRODUCT_MASTER",
          sourceRef: OS_REF(facts.productId),
          retrievedAt: reconciledAt,
          confidence: null,
        };

  if (fromPages.length === 0) {
    return {
      field,
      tier,
      status: own ? "UNVERIFIED" : "MISSING",
      value: null,
      sourceType: null,
      sourceRef: null,
      retrievedAt: null,
      confidence: null,
      currentValue,
      evidence: own ? [ownEvidence(own, true)] : [],
      conflicts: null,
    };
  }

  // Our title is Hungarian and editorial, a page's is the shop's own (mostly
  // English) name: comparing the two always "conflicts" (first live round,
  // 2026-10-03). So the title is checked page against page only; our value is
  // still stored as the current one.
  const compareOwn = own !== null && field !== "title";
  const candidates = [
    ...(compareOwn ? [own] : []),
    ...fromPages.map((p) => p.candidate),
  ];
  let result = reconcileField(field, candidates, { reconciledAt });
  if (tier === "C") result = guardFieldResult(field, result).result;

  const excerptOf = (candidate: SourcedValue) =>
    fromPages.find(
      (p) =>
        p.candidate === candidate ||
        (p.candidate.sourceRef === candidate.sourceRef &&
          p.candidate.value === candidate.value),
    );
  const evidence: StoredEvidence[] = [
    ...result.evidence.map((candidate) => {
      const page = excerptOf(candidate);
      return page
        ? pageEvidence(candidate, page.kind, page.excerpt, true)
        : ownEvidence(candidate, true);
    }),
    ...result.rejected.map((rejected) => {
      const page = excerptOf(rejected.candidate);
      return {
        ...(page
          ? pageEvidence(rejected.candidate, page.kind, page.excerpt, false)
          : ownEvidence(rejected.candidate, false)),
        reason: rejected.code ?? rejected.kind,
      };
    }),
  ];
  return {
    field,
    tier,
    status: result.status,
    value: result.value,
    sourceType: result.sourceType,
    sourceRef: result.sourceRef,
    retrievedAt: result.retrievedAt ? new Date(result.retrievedAt) : null,
    confidence: result.confidence,
    currentValue,
    evidence,
    conflicts: result.conflicts ?? null,
  };
}

function ownEvidence(
  candidate: SourcedValue,
  accepted: boolean,
): StoredEvidence {
  return {
    sourceType: candidate.sourceType,
    sourceKind: "OS",
    sourceRef: candidate.sourceRef,
    retrievedAt: candidate.retrievedAt,
    raw: candidate.value,
    excerpt: null,
    accepted,
  };
}

function pageEvidence(
  candidate: SourcedValue,
  kind: EnrichmentSourceKind,
  excerpt: string,
  accepted: boolean,
): StoredEvidence {
  return {
    sourceType: candidate.sourceType,
    sourceKind: kind,
    sourceRef: candidate.sourceRef,
    retrievedAt: candidate.retrievedAt,
    raw: candidate.value,
    excerpt,
    accepted,
  };
}
