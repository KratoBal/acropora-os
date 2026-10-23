import {
  normaliseDoi,
  normaliseOpenAlexId,
  stricterLicence,
  type Licence,
} from "./identifiers.js";
import { mergeCandidates, type MergeResult } from "./merge.js";
import {
  crossrefLicence,
  crossrefNotices,
  fromEuropePmcResult,
  fromOpenAlexWork,
  type DiscoveredVia,
  type Mapped,
  type SourceCandidate,
  type VersionCandidate,
} from "./records.js";
import {
  RequestLimitReached,
  type ScholarlyApi,
  type ScholarlyClient,
} from "./scholarly-client.js";

/**
 * THE SOURCE DISCOVERY OF THE RESEARCH ENGINE (plan v4, 9.2 S2).
 *
 * Reads the three APIs for a fixed set of queries and turns the answers into
 * merged source candidates and their later versions. This file touches no
 * database: the CLI decides whether the result is only reported or stored.
 *
 * Order of work:
 *   1. the queries: OpenAlex title-and-abstract search, Europe PMC search,
 *      DOIs named by hand, and the OpenAlex citation graph of named seeds;
 *   2. merge by identifier (`merge.ts`);
 *   3. Europe PMC by DOI for the works it did not find itself, for the
 *      licence, the PMCID and the open full-text link;
 *   4. Crossref by DOI, one request per batch: does it know the DOI, its
 *      licence, and every notice that updates it (the work's `updated-by`):
 *      correction, retraction, concern.
 *
 * Step 4 is a gate, not an extra: a work is only storable when its DOI went
 * through the notice check (`checkedDois`). When the request limit or a
 * Crossref refusal stops the run before that, the CLI stores nothing.
 */
export const OPENALEX_BASE = "https://api.openalex.org";
export const CROSSREF_BASE = "https://api.crossref.org";
export const EUROPE_PMC_BASE =
  "https://www.ebi.ac.uk/europepmc/webservices/rest";

/** Only the fixed fields; the abstract and free text are never asked for. */
export const OPENALEX_SELECT =
  "id,doi,ids,title,display_name,publication_year,type,authorships,primary_location,best_oa_location,open_access,is_retracted,referenced_works";

export const OPENALEX_PAGE = 200;
export const EUROPE_PMC_PAGE = 100;
/** DOIs per batched lookup; the URL stays well under the servers' limits. */
export const DOI_BATCH = 20;
export const OPENALEX_ID_BATCH = 50;
export const MAX_RESULTS_PER_QUERY = 1_000;
export const DEFAULT_REQUEST_LIMIT = 150;
export const MAX_REQUEST_LIMIT = 1_000;
/** `on`: a run may store (CLI `--apply`, the start endpoint). Stage only. */
export const DISCOVERY_SWITCH_ENV = "KNOWLEDGE_DISCOVERY";

export interface DiscoveryInput {
  /** A name for the run; the report and the run record carry it. */
  label: string;
  openalex: { search: string; maxResults: number }[];
  europePmc: { query: string; maxResults: number }[];
  dois: string[];
  citations: {
    doi: string;
    direction: "references" | "citedBy";
    maxResults: number;
  }[];
}

/** One query as it ran: the reproducible part of the run (S2 acceptance 1). */
export interface QueryLog {
  api: ScholarlyApi;
  kind: "SEARCH" | "DOI" | "REFERENCES" | "CITED_BY";
  query: string;
  /** The first page's exact URL. */
  url: string;
  executedAt: string;
  /** What the API said it has; null when it did not answer. */
  hitCount: number | null;
  fetched: number;
  /** Why it stopped short, if it did. */
  stoppedBy: string | null;
}

export type DiscoveryStatus = "FINISHED" | "LIMIT_REACHED" | "INCOMPLETE";

export interface DiscoveryResult {
  status: DiscoveryStatus;
  queries: QueryLog[];
  candidates: SourceCandidate[];
  notices: VersionCandidate[];
  /** DOIs whose notice check ran; a candidate with a DOI outside it is not storable. */
  checkedDois: string[];
  /** DOIs Crossref does not know (often a DataCite DOI: reported, not an error). */
  crossrefUnknownDois: string[];
  /** Hand-named DOIs no API knew. */
  notFoundDois: string[];
  skipped: Record<string, number>;
  conflicts: MergeResult["conflicts"];
  unavailable: Partial<Record<ScholarlyApi, string>>;
  requestCount: number;
}

export interface DiscoveryDeps {
  client: ScholarlyClient;
  now: () => Date;
}

/** The input file, checked: every problem is listed, nothing is guessed. */
export function parseDiscoveryInput(
  text: string,
): { ok: true; input: DiscoveryInput } | { ok: false; problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["A bemenet nem érvényes JSON."] };
  }
  const raw = (json ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label || label.length > 120)
    problems.push("label: 1-120 jeles név kell.");
  const max = (value: unknown, where: string): number => {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_RESULTS_PER_QUERY
    ) {
      problems.push(
        `${where}.maxResults: 1 és ${MAX_RESULTS_PER_QUERY} közötti egész kell.`,
      );
      return 0;
    }
    return value;
  };
  const list = (key: string): Record<string, unknown>[] => {
    const value = raw[key] ?? [];
    if (!Array.isArray(value)) {
      problems.push(`${key}: lista kell.`);
      return [];
    }
    return value as Record<string, unknown>[];
  };
  const openalex = list("openalex").map((q, i) => {
    const search = typeof q?.search === "string" ? q.search.trim() : "";
    // a comma or a pipe in an OpenAlex filter value is an OR, not text
    if (!search || /[,|]/.test(search))
      problems.push(`openalex[${i}].search: nem üres, vessző és | nélkül.`);
    return { search, maxResults: max(q?.maxResults, `openalex[${i}]`) };
  });
  const europePmc = list("europePmc").map((q, i) => {
    const query = typeof q?.query === "string" ? q.query.trim() : "";
    if (!query) problems.push(`europePmc[${i}].query: nem üres.`);
    return { query, maxResults: max(q?.maxResults, `europePmc[${i}]`) };
  });
  const dois = list("dois").map((d, i) => {
    const doi = normaliseDoi(d);
    if (!doi) problems.push(`dois[${i}]: nem DOI.`);
    return doi ?? "";
  });
  const citations = list("citations").map((c, i) => {
    const doi = normaliseDoi(c?.doi);
    if (!doi) problems.push(`citations[${i}].doi: nem DOI.`);
    const direction = c?.direction;
    if (direction !== "references" && direction !== "citedBy")
      problems.push(`citations[${i}].direction: references vagy citedBy.`);
    return {
      doi: doi ?? "",
      direction:
        direction === "citedBy"
          ? ("citedBy" as const)
          : ("references" as const),
      maxResults: max(c?.maxResults, `citations[${i}]`),
    };
  });
  if (
    !openalex.length &&
    !europePmc.length &&
    !dois.length &&
    !citations.length
  )
    problems.push(
      "Nincs egy lekérdezés sem (openalex, europePmc, dois, citations).",
    );
  return problems.length
    ? { ok: false, problems }
    : { ok: true, input: { label, openalex, europePmc, dois, citations } };
}

/** A DOI in a URL: escaped, but its slash kept, as the APIs write it. */
const encodeDoi = (doi: string): string =>
  encodeURIComponent(doi).replace(/%2F/gi, "/");

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

const meta = (json: unknown): Record<string, unknown> =>
  (((json ?? {}) as Record<string, unknown>).meta ?? {}) as Record<
    string,
    unknown
  >;
const results = (json: unknown): unknown[] => {
  const r = ((json ?? {}) as Record<string, unknown>).results;
  return Array.isArray(r) ? r : [];
};

export async function runDiscovery(
  input: DiscoveryInput,
  deps: DiscoveryDeps,
): Promise<DiscoveryResult> {
  const { client } = deps;
  const queries: QueryLog[] = [];
  const found: SourceCandidate[] = [];
  const skipped: Record<string, number> = {};
  const notices: VersionCandidate[] = [];
  const checked = new Set<string>();
  const crossrefUnknown = new Set<string>();
  let status: DiscoveryStatus = "FINISHED";

  const take = (mapped: Mapped): SourceCandidate | null => {
    if (mapped.ok) {
      found.push(mapped.candidate);
      return mapped.candidate;
    }
    const key = `${mapped.skipped.api} ${mapped.skipped.reason}`;
    skipped[key] = (skipped[key] ?? 0) + 1;
    return null;
  };
  const log = (entry: Omit<QueryLog, "executedAt">): QueryLog => {
    const full = { ...entry, executedAt: deps.now().toISOString() };
    queries.push(full);
    return full;
  };

  const openAlexPages = async (
    entry: QueryLog,
    filter: string,
    maxResults: number,
    via: DiscoveredVia,
  ) => {
    for (let page = 1; entry.fetched < maxResults; page += 1) {
      const perPage = Math.min(OPENALEX_PAGE, maxResults - entry.fetched);
      const url = `${OPENALEX_BASE}/works?filter=${filter}&per_page=${perPage}&page=${page}&select=${OPENALEX_SELECT}`;
      if (page === 1) entry.url = url;
      const answer = await client.getJson("OPENALEX", url);
      if (!answer.ok) {
        entry.stoppedBy = answer.reason;
        return;
      }
      const count = meta(answer.json).count;
      if (page === 1) entry.hitCount = typeof count === "number" ? count : null;
      const works = results(answer.json);
      for (const work of works) {
        take(fromOpenAlexWork(work, via));
        entry.fetched += 1;
      }
      if (works.length < perPage) return;
    }
  };

  try {
    // 1a. OpenAlex search, title and abstract
    for (const q of input.openalex) {
      const entry = log({
        api: "OPENALEX",
        kind: "SEARCH",
        query: q.search,
        url: "",
        hitCount: null,
        fetched: 0,
        stoppedBy: null,
      });
      await openAlexPages(
        entry,
        `title_and_abstract.search:${encodeURIComponent(q.search)}`,
        q.maxResults,
        "OPENALEX",
      );
    }

    // 1b. Europe PMC search, cursor paging
    for (const q of input.europePmc) {
      const entry = log({
        api: "EUROPE_PMC",
        kind: "SEARCH",
        query: q.query,
        url: "",
        hitCount: null,
        fetched: 0,
        stoppedBy: null,
      });
      let cursor = "*";
      while (entry.fetched < q.maxResults) {
        const pageSize = Math.min(
          EUROPE_PMC_PAGE,
          q.maxResults - entry.fetched,
        );
        const url = `${EUROPE_PMC_BASE}/search?query=${encodeURIComponent(q.query)}&resultType=core&format=json&pageSize=${pageSize}&cursorMark=${encodeURIComponent(cursor)}`;
        if (cursor === "*") entry.url = url;
        const answer = await client.getJson("EUROPE_PMC", url);
        if (!answer.ok) {
          entry.stoppedBy = answer.reason;
          break;
        }
        const body = (answer.json ?? {}) as Record<string, unknown>;
        if (cursor === "*")
          entry.hitCount =
            typeof body.hitCount === "number" ? body.hitCount : null;
        const list = ((body.resultList ?? {}) as Record<string, unknown>)
          .result;
        const page = Array.isArray(list) ? list : [];
        for (const result of page) {
          take(fromEuropePmcResult(result));
          entry.fetched += 1;
        }
        const next =
          typeof body.nextCursorMark === "string" ? body.nextCursorMark : null;
        if (page.length < pageSize || !next || next === cursor) break;
        cursor = next;
      }
    }

    // 1c. DOIs named by hand, through OpenAlex in batches
    for (const batch of chunks(input.dois, OPENALEX_ID_BATCH)) {
      const entry = log({
        api: "OPENALEX",
        kind: "DOI",
        query: batch.join("|"),
        url: "",
        hitCount: null,
        fetched: 0,
        stoppedBy: null,
      });
      await openAlexPages(
        entry,
        `doi:${batch.map(encodeDoi).join("|")}`,
        batch.length,
        "MANUAL",
      );
    }

    // 1d. the citation graph of named seeds
    for (const c of input.citations) {
      const seedUrl = `${OPENALEX_BASE}/works/doi:${encodeDoi(c.doi)}?select=id,referenced_works`;
      const entry = log({
        api: "OPENALEX",
        kind: c.direction === "references" ? "REFERENCES" : "CITED_BY",
        query: c.doi,
        url: seedUrl,
        hitCount: null,
        fetched: 0,
        stoppedBy: null,
      });
      const seed = await client.getJson("OPENALEX", seedUrl);
      if (!seed.ok) {
        entry.stoppedBy = seed.reason;
        continue;
      }
      const seedWork = (seed.json ?? {}) as Record<string, unknown>;
      const seedId = normaliseOpenAlexId(seedWork.id);
      if (!seedId) {
        entry.stoppedBy = "NO_SEED_ID";
        continue;
      }
      if (c.direction === "citedBy") {
        await openAlexPages(
          entry,
          `cites:${seedId}`,
          c.maxResults,
          "CITATION_GRAPH",
        );
        continue;
      }
      const references = (
        Array.isArray(seedWork.referenced_works)
          ? seedWork.referenced_works
          : []
      )
        .map(normaliseOpenAlexId)
        .filter((id): id is string => !!id);
      entry.hitCount = references.length;
      for (const batch of chunks(
        references.slice(0, c.maxResults),
        OPENALEX_ID_BATCH,
      )) {
        const batchEntry: QueryLog = { ...entry, fetched: 0 };
        await openAlexPages(
          batchEntry,
          `openalex:${batch.join("|")}`,
          batch.length,
          "CITATION_GRAPH",
        );
        entry.fetched += batchEntry.fetched;
        if (batchEntry.stoppedBy) {
          entry.stoppedBy = batchEntry.stoppedBy;
          break;
        }
      }
    }

    // 3. Europe PMC by DOI for the works it did not bring itself
    let merged = mergeCandidates(found).candidates;
    const fromEuropePmc = new Set(
      found
        .filter((c) => c.discoveredVia === "EUROPE_PMC")
        .flatMap((c) => (c.doi ? [c.doi] : [])),
    );
    const askEuropePmc = merged
      .map((c) => c.doi)
      .filter((doi): doi is string => !!doi && !fromEuropePmc.has(doi));
    for (const batch of chunks(askEuropePmc, DOI_BATCH)) {
      const query = batch.map((doi) => `DOI:"${doi}"`).join(" OR ");
      const url = `${EUROPE_PMC_BASE}/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=${EUROPE_PMC_PAGE}`;
      const answer = await client.getJson("EUROPE_PMC", url);
      if (!answer.ok) break; // enrichment only: the run goes on without it, the report says so
      const list = (
        ((answer.json ?? {}) as Record<string, unknown>).resultList as
          Record<string, unknown> | undefined
      )?.result;
      for (const result of Array.isArray(list) ? list : []) {
        const mapped = fromEuropePmcResult(result);
        // only the asked works; a search by DOI is still a search
        if (
          mapped.ok &&
          mapped.candidate.doi &&
          batch.includes(mapped.candidate.doi)
        )
          found.push(mapped.candidate);
      }
    }
    const mergeResult = mergeCandidates(found);
    merged = mergeResult.candidates;

    // 4. Crossref: the DOI, its licence, and every notice that updates it
    const dois = merged.map((c) => c.doi).filter((doi): doi is string => !!doi);
    const licenceByDoi = new Map<string, Licence>();
    for (const batch of chunks(dois, DOI_BATCH)) {
      const asked = new Set(batch);
      const known = await client.getJson(
        "CROSSREF",
        `${CROSSREF_BASE}/works?filter=${batch.map((d) => `doi:${encodeDoi(d)}`).join(",")}&rows=${batch.length * 2}&select=DOI,license,type,updated-by`,
      );
      if (!known.ok) break;
      const knownItems = (
        (known.json as Record<string, unknown>)?.message as
          Record<string, unknown> | undefined
      )?.items;
      const seen = new Set<string>();
      for (const item of Array.isArray(knownItems) ? knownItems : []) {
        const doi = normaliseDoi((item as Record<string, unknown>)?.DOI);
        if (!doi || !asked.has(doi)) continue;
        seen.add(doi);
        licenceByDoi.set(doi, crossrefLicence(item));
      }
      for (const doi of batch) if (!seen.has(doi)) crossrefUnknown.add(doi);
      notices.push(...crossrefNotices(knownItems, asked));
      for (const doi of batch) checked.add(doi);
    }
    // the Crossref licence joins as one more statement: the stricter one stays
    const withCrossref = merged.map((c) => {
      const licence = c.doi ? licenceByDoi.get(c.doi) : undefined;
      return licence
        ? { ...c, licence: stricterLicence(c.licence, licence) }
        : c;
    });

    if (client.unavailable.has("CROSSREF") || dois.some((d) => !checked.has(d)))
      status = "INCOMPLETE";
    const foundDois = new Set(dois);
    return {
      status,
      queries,
      candidates: withCrossref,
      notices,
      checkedDois: [...checked],
      crossrefUnknownDois: [...crossrefUnknown],
      notFoundDois: input.dois.filter((d) => !foundDois.has(d)),
      skipped,
      conflicts: mergeResult.conflicts,
      unavailable: Object.fromEntries(client.unavailable),
      requestCount: client.requestCount,
    };
  } catch (error) {
    if (!(error instanceof RequestLimitReached)) throw error;
    const mergeResult = mergeCandidates(found);
    return {
      status: "LIMIT_REACHED",
      queries,
      candidates: mergeResult.candidates,
      notices,
      checkedDois: [...checked],
      crossrefUnknownDois: [...crossrefUnknown],
      notFoundDois: [],
      skipped,
      conflicts: mergeResult.conflicts,
      unavailable: Object.fromEntries(client.unavailable),
      requestCount: client.requestCount,
    };
  }
}
