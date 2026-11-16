import {
  fieldSpec,
  guardFieldResult,
  normalizeFieldValue,
  reconcileField,
  type FieldKey,
  type FieldResult,
  type SourcedValue,
} from "@acropora/jev/product-enrichment";

import { withBulkReefSupplyTable } from "./bulk-reef-supply-extract.js";
import {
  dosingStatement,
  visiblePageText,
  type DosingExtractor,
} from "./dosing-extraction.js";
import { confirmPackSize, nameSize } from "./pack-size-confirm.js";
import {
  productFieldStatement,
  type ProductFieldAnswer,
  type ProductFieldExtractor,
} from "./product-field-extraction.js";
import { extractMarineAquaticsStatement } from "./marine-aquatics-extract.js";
import {
  ENRICHED_FIELDS,
  extractPageStatement,
  type EnrichedField,
  type PageStatement,
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
  pageKey,
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
  /**
   * A MANUFACTURER source that is the brand's imprint (its legal notice), not a product page (acrobot 52559, T4.4 pilot
   * fifth run): the maker block comes from here only, and nothing else does. A product page's company is incidental,
   * and two sources gave two blocks (Korallen-Zucht) and a different one from run to run (Grotech, Blue Life). With no
   * imprint in the input the maker stays missing and goes to a person; a product page is never the fallback.
   */
  imprint?: true;
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
  /** The manufacturer domains the product's brand category names (`brandSitesFromCategories`). */
  categoryBrandSites?: readonly string[];
  /** Our own current values, raw, per field. */
  current: Partial<Record<EnrichedField, string>>;
  /**
   * Where a current value comes from, when it is not the product master: the
   * water-effects category rule is our UNAS tree's statement (`UNAS_CURRENT`,
   * card 2b3983e1). Both are our own catalogue, so neither can VERIFY alone.
   */
  currentSource?: Partial<
    Record<EnrichedField, { sourceType: "UNAS_CURRENT"; sourceRef: string }>
  >;
}

export interface StoredFetch {
  sourceKind: EnrichmentSourceKind | "MANUAL";
  url: string;
  outcome: "FETCHED" | "UNAVAILABLE" | "REFUSED";
  reason: string | null;
  httpStatus: number | null;
  fetchedAt: Date;
  fieldCount: number;
}

/**
 * Where an evidence entry came from: a page read by a run, our own value, or
 * a reviewer who entered it by hand (`products/knowledge/manual-evidence.ts`).
 */
export type EvidenceSourceKind = EnrichmentSourceKind | "OS" | "MANUAL";

export interface StoredEvidence {
  sourceType: string;
  sourceKind: EvidenceSourceKind;
  sourceRef: string | null;
  retrievedAt: string | null;
  raw: string;
  excerpt: string | null;
  accepted: boolean;
  reason?: string;
  /** Entered by a reviewer, not read by a run; who entered it. */
  manual?: true;
  enteredById?: string;
}

/** A page's (or a reviewer's) statement of one field, before reconciliation. */
export interface FieldStatement {
  candidate: SourcedValue;
  excerpt: string;
  kind: EnrichmentSourceKind | "MANUAL";
  manual?: { enteredById: string };
}

export interface StoredField {
  field: FieldKey;
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
  /** A product the run could not check or store: its row with the error, nothing else. */
  saveFailure(runId: string, failure: ProductFailure): Promise<void>;
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
  /**
   * The manufacturer's dosing through Acropora AI (`dosing-extraction.ts`);
   * absent: not called. Only a MANUFACTURER page is sent.
   */
  dosingExtractor?: DosingExtractor;
  /**
   * What the product is for and who makes it, through Acropora AI (`product-field-extraction.ts`, T4.4 S1b); absent:
   * not called. Only a MANUFACTURER page is sent: the product page gives the use, the brand's imprint page the maker.
   */
  productFieldExtractor?: ProductFieldExtractor;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  productCount: number;
  requestCount: number;
  /** Why the run stopped early, when it did. */
  limit: "PRODUCTS" | "REQUESTS" | null;
  checks: StoredCheck[];
  /** The products the run could not check or store; it went on past each one. */
  failures: ProductFailure[];
}

export interface ProductFailure {
  productId: string;
  checkedAt: Date;
  /** The Prisma error code when there is one (P2000), else the error's name. */
  errorCode: string;
}

/**
 * ONE PRODUCT'S ERROR DOES NOT STOP THE BATCH (water-effects run, 2026-10-12: a
 * value too long for its column stopped batch 3 of 9 at its first bad product).
 * It is recorded and the run goes on. So many in a row that it cannot be the
 * product (the database is gone, a code error on every product) still stops
 * the run as FAILED.
 */
export const MAX_CONSECUTIVE_PRODUCT_FAILURES = 5;

function productErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^P\d{4}$/.test(code)) return code;
  return error instanceof Error ? error.name : "UNKNOWN";
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
  const failures: ProductFailure[] = [];
  // ONE AI ANSWER PER IMPRINT PER RUN (pilot-20, sixth and seventh runs, 2026-11-14): one brand's imprint asked once per
  // product gave "Felelős" for one Aquaforest product and "Gyártó" for two, and the Grotech block for one product and
  // none for the other, the same way in both runs: the product's name in the request steered it. Asked once, every
  // product of the brand gets the same block, and the run makes fewer calls. Only an answer that gave a maker block is
  // kept: an unavailable service, a refused whole answer, or an answer with no block (a company refused, none named) is
  // asked again at the next product, so a first bad answer does not take the brand's other chances (barracuda on #2567).
  // Two sound, different blocks still cannot arise: the first sound one is kept.
  const imprintAnswers = new Map<string, ProductFieldAnswer>();
  let consecutiveFailures = 0;
  let limit: RunSummary["limit"] = null;

  try {
    for (const [index, product] of products.entries()) {
      if (checks.length >= options.productLimit) {
        limit = "PRODUCTS";
        break;
      }
      try {
        const check = await checkProduct(
          product,
          facts[index]!,
          fetcher,
          deps,
          imprintAnswers,
        );
        await deps.store.saveCheck(runId, check);
        checks.push(check);
        consecutiveFailures = 0;
      } catch (error) {
        if (error instanceof RequestLimitReached) {
          limit = "REQUESTS";
          break;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_PRODUCT_FAILURES)
          throw error;
        const failure: ProductFailure = {
          productId: product.productId,
          checkedAt: deps.now(),
          errorCode: productErrorCode(error),
        };
        // a check is stored in one write, so a failed one left nothing behind
        await deps.store.saveFailure(runId, failure);
        failures.push(failure);
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
    errorCode: limit
      ? `${limit}_LIMIT_REACHED`
      : failures.length
        ? `${failures.length}_PRODUCTS_FAILED`
        : null,
  });
  return {
    runId,
    status,
    productCount: checks.length,
    requestCount: fetcher.requestCount,
    limit,
    checks,
    failures,
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
  const unique = all.filter((source) => {
    const key = `${source.kind} ${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // the manufacturer's pages first (barracuda, #1821): when a supplier link
  // and a manufacturer link lead to one final page, the page is read once, and
  // it is read as the manufacturer's
  return [
    ...unique.filter((source) => source.kind === "MANUFACTURER"),
    ...unique.filter((source) => source.kind !== "MANUFACTURER"),
  ];
}

async function checkProduct(
  input: RunProductInput,
  facts: ProductFacts,
  fetcher: PoliteFetcher,
  deps: RunDeps,
  imprintAnswers: Map<string, ProductFieldAnswer>,
): Promise<StoredCheck> {
  const checkedAt = deps.now();
  const manufacturer = manufacturerSites(
    facts.brandWebsiteUrl,
    facts.unasManufacturerUrl,
    facts.categoryBrandSites,
  );
  const fetches: StoredFetch[] = [];
  const pageCandidates: {
    field: EnrichedField;
    candidate: SourcedValue;
    excerpt: string;
    kind: EnrichmentSourceKind;
  }[] = [];

  // THE SAME PAGE ONCE (second test round, 2026-10-23): a given URL and the
  // UNAS link can lead to one final page (a redirect). Read twice, it was two
  // AI calls and two sources, and the two answers' guidance "conflicted" with
  // itself. A product reads a final page once; the second is named, not used.
  const readPages = new Set<string>();
  // A NO_DATA IS ABOUT THE MANUFACTURER, NOT ONE PAGE (card 85c38ab1, second
  // Fauna Marin run): the brand's info page had no dose and said NO_DATA, the
  // shop page of the same product had one (its AI answer refused) or answered
  // 404, and the one NO_DATA went through as the product's verified state.
  // Counted here: a manufacturer source not read, or read without a NO_DATA.
  let manufacturerWithoutNoData = 0;
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
      if (source.kind === "MANUFACTURER" && !source.imprint)
        manufacturerWithoutNoData += 1;
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
    const key = pageKey(page.url);
    if (readPages.has(key)) {
      fetches.push({
        sourceKind: source.kind,
        url: page.url,
        outcome: "REFUSED",
        reason: "SAME_PAGE_ALREADY_READ",
        httpStatus: page.httpStatus,
        fetchedAt: page.fetchedAt,
        fieldCount: 0,
      });
      continue;
    }
    readPages.add(key);
    const structured = extractPageStatement(page.html);
    // the pack size: our name's size, confirmed where the manufacturer's page names its own product (S1a)
    const ownSize = nameSize(facts.name);
    // the imprint is not a product page: no pack, no dose, no use from it, only the maker block
    const imprint = source.kind === "MANUFACTURER" && source.imprint === true;
    const sizeConfirmed =
      source.kind === "MANUFACTURER" &&
      !imprint &&
      ownSize &&
      !structured.values.some((v) => v.field === "packSize")
        ? confirmPackSize(page.html, ownSize)
        : null;
    // marine-aquatics.eu states its data in labelled rows, not JSON-LD.
    // bulkreefsupply.com states its barcode only in a labelled table.
    // An imprint page gives no structured value either: a shop's legal notice may carry a Product JSON-LD with a dose
    // or a size, and it is not this product's page (barracuda on #2565). Nor a "no product" note: none is expected.
    const statement: PageStatement = imprint
      ? { values: [], note: null }
      : source.kind === "MARINE_AQUATICS" && structured.values.length === 0
        ? extractMarineAquaticsStatement(page.html)
        : source.kind === "BULK_REEF_SUPPLY"
          ? withBulkReefSupplyTable(structured, page.html)
          : structured;
    // the three dosing states, from the manufacturer's own page only
    const dosingAi =
      source.kind === "MANUFACTURER" && !imprint && deps.dosingExtractor
        ? await (async () => {
            const pageText = visiblePageText(page.html);
            return dosingStatement(
              await deps.dosingExtractor!.extract({
                productName: facts.name,
                pageText,
              }),
              pageText,
              statement.values.find((v) => v.field === "dosing")?.raw ?? null,
              statement.descriptionDoseOnPage ?? false,
            );
          })()
        : null;
    const fieldsAi =
      source.kind === "MANUFACTURER" && deps.productFieldExtractor
        ? await (async () => {
            const pageText = visiblePageText(page.html);
            const kept = imprint ? imprintAnswers.get(page.url) : undefined;
            const answer =
              kept ??
              (await deps.productFieldExtractor!.extract({
                productName: facts.name,
                pageText,
                fields: imprint ? ["manufacturerInfo"] : ["application"],
              }));
            // checked against this page's text again: the kept answer is no exception to the guard
            const checked = productFieldStatement(answer, pageText);
            if (
              imprint &&
              !kept &&
              checked.values.some((v) => v.field === "manufacturerInfo")
            )
              imprintAnswers.set(page.url, answer);
            return kept
              ? {
                  ...checked,
                  notes: [
                    "termékmezők (AI): az impresszum válasza a futás korábbi hívásából",
                    ...checked.notes,
                  ],
                }
              : checked;
          })()
        : null;
    if (
      source.kind === "MANUFACTURER" &&
      !imprint &&
      !dosingAi?.values.some(
        (v) => v.field === "dosingMode" && v.raw === "NO_DATA",
      )
    )
      manufacturerWithoutNoData += 1;
    fetches.push({
      sourceKind: source.kind,
      url: page.url,
      outcome: "FETCHED",
      // a szótár megjegyzései (tagadott találat, kétirányú kód) a lap mellé
      reason:
        [
          statement.note,
          ...(statement.lexiconNotes ?? []),
          ...(dosingAi?.notes ?? []),
          ...(fieldsAi?.notes ?? []),
        ]
          .filter(Boolean)
          .join("; ") || null,
      httpStatus: page.httpStatus,
      fetchedAt: page.fetchedAt,
      fieldCount:
        statement.values.length +
        (dosingAi?.values.length ?? 0) +
        (sizeConfirmed ? 1 : 0) +
        (fieldsAi?.values.length ?? 0),
    });
    for (const value of [
      ...statement.values,
      ...(dosingAi?.values ?? []),
      ...(sizeConfirmed ? [sizeConfirmed] : []),
      ...(fieldsAi?.values ?? []),
    ])
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

  // ...so a NO_DATA stands only when every manufacturer source was read and
  // said it; otherwise it is no value, and its page says why
  if (manufacturerWithoutNoData > 0)
    for (let i = pageCandidates.length - 1; i >= 0; i--) {
      const c = pageCandidates[i]!;
      if (c.field !== "dosingMode" || c.candidate.value !== "NO_DATA") continue;
      pageCandidates.splice(i, 1);
      const fetch = fetches.find(
        (f) => f.outcome === "FETCHED" && f.url === c.candidate.sourceRef,
      );
      if (fetch) {
        fetch.fieldCount -= 1;
        fetch.reason = [
          fetch.reason,
          `adagolás (AI): a nincs-adat csak erre a lapra igaz, ${manufacturerWithoutNoData} másik gyártói forrás nem ezt mondja vagy nem olvasható`,
        ]
          .filter(Boolean)
          .join("; ");
      }
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

function normalised(field: FieldKey, raw: string): string | null {
  const result = normalizeFieldValue(field, raw);
  return result.ok ? result.value : null;
}

/**
 * One field: reconciled with the V0 model when a page stated it; otherwise
 * our own value alone is UNVERIFIED (it cannot verify itself), and no value
 * at all is MISSING. Tier C goes through the V0 guard as well.
 */
export function fieldOutcome(
  field: FieldKey,
  facts: ProductFacts,
  fromPages: readonly FieldStatement[],
  reconciledAt: string,
): StoredField {
  const tier = fieldSpec(field).tier;
  // Only the run's fields have a current value; any other field has none.
  const currentRaw =
    (facts.current as Partial<Record<FieldKey, string>>)[field] ?? null;
  const currentValue =
    currentRaw === null ? null : (normalised(field, currentRaw) ?? currentRaw);
  const own: SourcedValue | null =
    currentRaw === null
      ? null
      : {
          value: currentRaw,
          sourceType:
            facts.currentSource?.[field as EnrichedField]?.sourceType ??
            "OS_PRODUCT_MASTER",
          sourceRef:
            facts.currentSource?.[field as EnrichedField]?.sourceRef ??
            OS_REF(facts.productId),
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
        ? pageEvidence(candidate, page, true)
        : ownEvidence(candidate, true);
    }),
    ...result.rejected.map((rejected) => {
      const page = excerptOf(rejected.candidate);
      return {
        ...(page
          ? pageEvidence(rejected.candidate, page, false)
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
  statement: FieldStatement,
  accepted: boolean,
): StoredEvidence {
  return {
    sourceType: candidate.sourceType,
    sourceKind: statement.kind,
    sourceRef: candidate.sourceRef,
    retrievedAt: candidate.retrievedAt,
    raw: candidate.value,
    excerpt: statement.excerpt,
    accepted,
    ...(statement.manual
      ? { manual: true as const, enteredById: statement.manual.enteredById }
      : {}),
  };
}
