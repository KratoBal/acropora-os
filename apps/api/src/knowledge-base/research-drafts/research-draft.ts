import type {
  DiscoveryInput,
  DiscoveryResult,
} from "../discovery/discovery-run.js";
import type { SourceCandidate } from "../discovery/records.js";
import type { CheckedClaim } from "../extraction/claim-check.js";
import {
  emptyOutcome,
  type FullTextReading,
  type SourceOutcome,
} from "../extraction/extraction-run.js";
import type {
  QueriesAnswer,
  ResearchAsker,
  SummaryClaimInput,
} from "./research-draft-client.js";

/**
 * MODE B OF THE RESEARCH PILOT, THE OS SIDE (plan v4, 7 and 9.2 S6, slice 4b;
 * Balázs approved the stage pilot 2026-10-23, Discord 1563157803726798859).
 * An editor's research draft: model text from external sources, marked as
 * such, never a claim by itself (research-draft-isolation.test.ts).
 *
 *   1. the editor's question -> at most three English search expressions
 *      (AI `/v1/research-queries`);
 *   2. the S2 discovery, database-free, on Europe PMC's open-access works only,
 *      with a small request budget; no abstract is asked for (B7);
 *   3. the open full texts (Europe PMC JATS) of the first sources that have
 *      one, in the draft's reading order (no abstract book, the title's
 *      words against the search's), through the S3 reading and the OS's own claim check, IN MEMORY:
 *      nothing goes to KnowledgeClaim or KnowledgePassage. A retracted work is
 *      not read, and neither is one whose DOI the Crossref check did not reach;
 *   4. a summary written ONLY from those checked candidate claims (AI
 *      `/v1/research-summaries`), checked again here: every sentence ends with
 *      markers of claims sent, and a number in it is a number of a claim it
 *      cites. What fails is dropped with its code;
 *   5. the result: a DRAFT with its summary, or FAILED with the reason; the
 *      sources and the candidate claims are kept either way.
 *
 * Pure apart from the injected calls. The report carries codes and counts,
 * never a source's text; the text stays in the draft's own columns.
 */
export const MAX_RESEARCH_QUESTION = 1000;
export const RESULTS_PER_QUERY = 10;
export const DRAFT_REQUEST_LIMIT = 30;
/** Sources read in full; one more is tried for each that has no open text. */
export const MAX_SOURCES_READ = 3;
export const MAX_SOURCES_TRIED = 6;
export const MAX_CHUNKS_PER_DRAFT_SOURCE = 3;
/** The AI side takes at most 30 claims for a summary. */
export const MAX_SUMMARY_CLAIMS = 30;
const MAX_CLAIM_TEXT = 1000;
const MAX_SOURCE_REF = 200;

export type DraftFailure =
  | "AI_QUERIES_UNAVAILABLE"
  | "AI_QUERIES_REFUSED"
  | "NO_QUERIES"
  | "NO_SOURCES"
  | "NO_OPEN_FULL_TEXT"
  | "NO_RELEVANT_TITLE"
  | "NO_CLAIMS"
  | "AI_SUMMARY_UNAVAILABLE"
  | "AI_SUMMARY_REFUSED"
  | "SUMMARY_EMPTY";

export interface DraftSource {
  doi: string | null;
  pmcid: string | null;
  pmid: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  licence: string;
  /**
   * READ, or why not: ABSTRACT_BOOK, NO_QUERY_TERM_IN_TITLE, RETRACTED, RETRACTION_UNCHECKED,
   * NO_OPEN_FULL_TEXT, a fetch or AI code, NOT_TRIED.
   */
  read: string;
  claims: number;
  /**
   * No DOI, so the Crossref retraction check never covered it; only the API's own signals did. Read
   * anyway, as the S3 extraction reads such a source, and marked so the editor's screen can say so
   * (barracuda on #1930).
   */
  retractionUnchecked: boolean;
}

export interface DraftClaim extends CheckedClaim {
  /** The marker id in the summary: c1, c2, ... */
  id: string;
  /** Index into the draft's sources. */
  source: number;
}

export interface DraftResult {
  status: "DRAFT" | "FAILED";
  reason: DraftFailure | null;
  sources: DraftSource[];
  candidateClaims: DraftClaim[];
  summary: string | null;
  summaryModel: string | null;
  report: DraftReport;
}

export interface DraftReport {
  reason?: DraftFailure;
  queries: string[];
  queriesBy?: string;
  queriesRefused: string[];
  discovery?: {
    status: string;
    requestCount: number;
    found: number;
    unavailable: Record<string, string>;
    /** Where the search looked: the title and abstract, or the full text after they found nothing. */
    fieldScope: FieldScope;
    /** On a fallback: what the title-and-abstract search said before it. */
    titleAbstract?: { found: number; unavailable: Record<string, string> };
  };
  read: Pick<
    SourceOutcome,
    | "sections"
    | "calls"
    | "unavailable"
    | "refusedClaims"
    | "refusedFields"
    | "chunksDropped"
  >[];
  extractedBy?: string;
  claims: number;
  claimsSent: number;
  summaryKept?: number;
  summaryDroppedByAi: string[];
  summaryDroppedHere: SummaryDrop[];
}

export interface DraftDeps {
  ask: ResearchAsker;
  /** `runDiscovery` with its client, the request limit set by the caller. */
  discover: (input: DiscoveryInput) => Promise<DiscoveryResult>;
  /** `readFullTextClaims` with the extractor, the fetch and the vocabulary. */
  read: (pmcid: string, outcome: SourceOutcome) => Promise<FullTextReading>;
}

export class ResearchQuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchQuestionError";
  }
}

export function parseResearchQuestion(body: unknown): string {
  const raw = (body ?? {}) as Record<string, unknown>;
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (
    !question ||
    question.length > MAX_RESEARCH_QUESTION ||
    /\[\[|\]\]/.test(question)
  )
    throw new ResearchQuestionError(
      `question: egy legfeljebb ${MAX_RESEARCH_QUESTION} karakteres kérdés, [[ és ]] nélkül`,
    );
  return question;
}

/**
 * The discovery's input for the question's search expressions: Europe PMC, open access only, and
 * in the title and the abstract only. Without a field Europe PMC searches the open full text, and a
 * conference's abstract book holds every word somewhere: acrobot's stage run (2026-10-28, 37189)
 * read two gerontology abstract books and a natural-products symposium first, while the coral works
 * stayed NOT_TRIED. The field narrows the search on Europe PMC's side; no abstract is asked for (B7).
 * FULLTEXT_FALLBACK is the search as it was before, for when the field finds nothing.
 */
export type FieldScope = "TITLE_ABS" | "FULLTEXT_FALLBACK";

export function discoveryInputFor(
  label: string,
  queries: string[],
  scope: FieldScope = "TITLE_ABS",
): DiscoveryInput {
  return {
    label,
    openalex: [],
    europePmc: queries.map((q) => ({
      query:
        scope === "TITLE_ABS"
          ? `(TITLE_ABS:(${q})) AND OPEN_ACCESS:y`
          : `(${q}) AND OPEN_ACCESS:y`,
      maxResults: RESULTS_PER_QUERY,
    })),
    dois: [],
    citations: [],
  };
}

/** Europe PMC answered, or refused this query only (a 4xx other than 429): not an API that is down. */
const refusedOnlyTheQuery = (result: DiscoveryResult) => {
  const why = result.unavailable.EUROPE_PMC;
  return why === undefined || (/^HTTP_4\d\d$/.test(why) && why !== "HTTP_429");
};

/**
 * THE READING ORDER. The discovery's order is Europe PMC's relevance, and on the full text a
 * conference's abstract book ranks first: it holds every word somewhere (acrobot's two stage runs,
 * 2026-10-28, 37189 and 37198, read the same symposium and two gerontology abstract books, while
 * the coral works stayed NOT_TRIED). So the draft reads by its own count instead: an abstract book
 * is never read, and the rest go by how many of the search expressions' words their title carries;
 * a title with none of them is not read. A count, not a parse: the key is a word's first six
 * letters, a plural's s dropped ("corals" and "coral", "aquaria" and "aquarium" meet).
 */
const ABSTRACT_BOOK =
  /\b(?:abstracts?|symposium|congress|conference|meeting|proceedings)\b/iu;
const QUERY_WORDS_SKIPPED = new Set([
  "and",
  "or",
  "not",
  "the",
  "of",
  "in",
  "on",
  "for",
  "with",
  "to",
  "by",
  "at",
  "from",
  "an",
]);
const termKey = (word: string) => {
  const w = word.toLowerCase();
  return (w.length > 4 ? w.replace(/s$/u, "") : w).slice(0, 6);
};
const wordsOf = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function queryTerms(queries: readonly string[]): Set<string> {
  return new Set(
    queries
      .flatMap(wordsOf)
      .filter((w) => w.length >= 3 && !QUERY_WORDS_SKIPPED.has(w.toLowerCase()))
      .map(termKey),
  );
}

/** -1 for an abstract book, else the number of distinct query terms the title carries. */
export function titleScore(title: string, terms: ReadonlySet<string>): number {
  if (ABSTRACT_BOOK.test(title)) return -1;
  return new Set(
    wordsOf(title)
      .map(termKey)
      .filter((k) => terms.has(k)),
  ).size;
}

const retracted = (c: SourceCandidate, result: DiscoveryResult) =>
  c.versionSignals.some((v) => v.versionKind === "RETRACTION") ||
  (!!c.doi &&
    result.notices.some(
      (n) => n.doi === c.doi && n.versionKind === "RETRACTION",
    ));

const clip = (text: string, max: number) =>
  text
    .replace(/\[\[|\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** "Koop et al., 2001", the reference a summary sentence may name. */
export function sourceRef(
  s: Pick<DraftSource, "authors" | "year" | "title">,
): string {
  const first = s.authors[0]?.split(/[ ,]/)[0];
  const who = first
    ? `${first}${s.authors.length > 1 ? " et al." : ""}`
    : clip(s.title, 80);
  return clip(`${who}, ${s.year ?? "év nélkül"}`, MAX_SOURCE_REF) || "forrás";
}

/** A checked claim's fields as one line, the form the summary call takes. */
export function claimFields(c: CheckedClaim): string {
  const q = c.quantity;
  const parts: [string, unknown][] = [
    ["species", c.species],
    ["environment", c.environment],
    ["effect", c.effect],
    ["direction", c.direction],
    [
      "quantity",
      q
        ? `${q.min ?? ""}-${q.max ?? ""} ${q.unit}${q.basis ? ` ${q.basis}` : ""}`
        : null,
    ],
    ["studyType", c.studyType],
    [
      "sampleSize",
      c.sampleSize
        ? `${c.sampleSize.value}${c.sampleSize.unit ? ` ${c.sampleSize.unit}` : ""}`
        : null,
    ],
    ["uncertainty", c.uncertainty],
  ];
  return clip(
    parts
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k} ${String(v)}`)
      .join("; "),
    MAX_CLAIM_TEXT,
  );
}

// ---------------------------------------------------------------------------
// The OS's own check of the summary (the AI side checks it too; this one is the authority)

export type SummaryDrop =
  "UNMARKED" | "MARKER_NOT_AT_END" | "UNKNOWN_MARKER" | "NUMBER_NOT_IN_CLAIMS";

const MARKER = /\[\[claim:([A-Za-z0-9_-]{1,64})\]\]/gu;
const MARKERS_AT_END =
  /^([\s\S]*?)((?:\s*\[\[claim:[A-Za-z0-9_-]{1,64}\]\])+)\s*(?:[.!?…]+["”»)]?)?$/u;
/** Chemical formulas are names, not numbers (the AI side's list). */
const FORMULA =
  /(?<![\p{L}\d])(?:CaCO3|HCO3|PO4|NO3|NO2|NH3|NH4|CO2|CO3|SO4|SiO2|H2O)(?:3-|³⁻|2-|-)?(?![\p{L}\d])/gu;
const NUMBER = /(?<![\d.,])\d+(?:[.,]\d+)?/gu;
const numbers = (text: string) =>
  [...text.replace(MARKER, " ").replace(FORMULA, " ").matchAll(NUMBER)].map(
    (m) => Number(m[0].replace(",", ".")),
  );
const sentencesOf = (text: string) =>
  text
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=["„«(]?[\p{Lu}\d])/u))
    .map((s) => s.replace(/\s+/gu, " ").trim())
    .filter(Boolean);

export function checkSummary(
  summary: string,
  claims: readonly { id: string; fields: string; passage: string }[],
): { text: string; kept: number; dropped: SummaryDrop[] } {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const kept: string[] = [];
  const dropped: SummaryDrop[] = [];
  for (const sentence of sentencesOf(summary)) {
    if (!sentence.match(MARKER)) {
      dropped.push("UNMARKED");
      continue;
    }
    const end = MARKERS_AT_END.exec(sentence);
    if (!end || /\[\[|\]\]/.test(end[1]!)) {
      dropped.push("MARKER_NOT_AT_END");
      continue;
    }
    const ids = [...end[2]!.matchAll(MARKER)].map((m) => m[1]!);
    if (ids.some((id) => !byId.has(id))) {
      dropped.push("UNKNOWN_MARKER");
      continue;
    }
    const allowed = new Set(
      ids.flatMap((id) =>
        numbers(`${byId.get(id)!.fields} ${byId.get(id)!.passage}`),
      ),
    );
    if (numbers(sentence).some((n) => !allowed.has(n))) {
      dropped.push("NUMBER_NOT_IN_CLAIMS");
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" "), kept: kept.length, dropped };
}

// ---------------------------------------------------------------------------

export async function runResearchDraft(
  question: string,
  label: string,
  deps: DraftDeps,
): Promise<DraftResult> {
  const report: DraftReport = {
    queries: [],
    queriesRefused: [],
    read: [],
    claims: 0,
    claimsSent: 0,
    summaryDroppedByAi: [],
    summaryDroppedHere: [],
  };
  const sources: DraftSource[] = [];
  const candidateClaims: DraftClaim[] = [];
  const fail = (reason: DraftFailure): DraftResult => ({
    status: "FAILED",
    reason,
    sources,
    candidateClaims,
    summary: null,
    summaryModel: null,
    report: { ...report, reason },
  });

  // 1. the search expressions
  const q: QueriesAnswer = await deps.ask.queries(question);
  if (q.kind === "UNAVAILABLE") return fail("AI_QUERIES_UNAVAILABLE");
  report.queriesBy = q.writtenBy;
  if (q.kind === "REFUSED") {
    report.queriesRefused.push(q.refusal);
    return fail("AI_QUERIES_REFUSED");
  }
  report.queries = q.queries;
  report.queriesRefused = q.refused;
  if (!q.queries.length) return fail("NO_QUERIES");

  // 2. the discovery, nothing stored. The TITLE_ABS field was not measured from here (the fleet has
  // no route to ebi.ac.uk): if Europe PMC answers it with nothing, or refuses the query itself (a
  // 4xx), the search runs once more on the full text, as it did before, and the report says which
  // one ran (acrobot, 37191). An API that is down (5xx, timeout, a 429 outlasting its retries) is
  // not asked again: that is the client's rule, and the fallback keeps it.
  const first = await deps.discover(discoveryInputFor(label, q.queries));
  let found = first;
  let fieldScope: FieldScope = "TITLE_ABS";
  if (!first.candidates.length && refusedOnlyTheQuery(first)) {
    fieldScope = "FULLTEXT_FALLBACK";
    found = await deps.discover(
      discoveryInputFor(label, q.queries, fieldScope),
    );
  }
  report.discovery = {
    status: found.status,
    // each search reports its own client's count; the budget they share is the caller's
    requestCount:
      found === first
        ? first.requestCount
        : first.requestCount + found.requestCount,
    found: found.candidates.length,
    unavailable: found.unavailable as Record<string, string>,
    fieldScope,
    ...(found === first
      ? {}
      : {
          titleAbstract: {
            found: 0,
            unavailable: first.unavailable as Record<string, string>,
          },
        }),
  };
  if (!found.candidates.length) return fail("NO_SOURCES");

  // 3. the open full texts, read in memory, in the draft's own order (THE READING ORDER above);
  // the sources stay in the discovery's order, and a claim names its source by that index
  const checked = new Set(found.checkedDois);
  const terms = queryTerms(q.queries);
  for (const c of found.candidates)
    sources.push({
      doi: c.doi,
      pmcid: c.pmcid,
      pmid: c.pmid,
      title: c.title,
      authors: c.authors.map((a) => a.name),
      year: c.year,
      venue: c.venue,
      url: c.url,
      licence: c.licence,
      read: "NOT_TRIED",
      claims: 0,
      retractionUnchecked: !c.doi,
    });
  const order = found.candidates
    .map((c, index) => ({ c, index, score: titleScore(c.title, terms) }))
    .sort((a, b) => b.score - a.score); // stable: a tie keeps Europe PMC's order
  let read = 0;
  let tried = 0;
  for (const { c, index, score } of order) {
    const source = sources[index]!;
    if (score < 0) {
      source.read = "ABSTRACT_BOOK";
      continue;
    }
    if (score === 0) {
      source.read = "NO_QUERY_TERM_IN_TITLE";
      continue;
    }
    if (read >= MAX_SOURCES_READ || tried >= MAX_SOURCES_TRIED) continue;
    if (retracted(c, found)) {
      source.read = "RETRACTED";
      continue;
    }
    // a DOI the Crossref check did not reach may be retracted without our knowing
    if (c.doi && !checked.has(c.doi)) {
      source.read = "RETRACTION_UNCHECKED";
      continue;
    }
    if (!c.pmcid) {
      source.read = "NO_OPEN_FULL_TEXT";
      continue;
    }
    tried += 1;
    const outcome = emptyOutcome(c.pmcid);
    const reading = await deps.read(c.pmcid, outcome);
    report.read.push({
      sections: outcome.sections,
      calls: outcome.calls,
      unavailable: outcome.unavailable,
      refusedClaims: outcome.refusedClaims,
      refusedFields: outcome.refusedFields,
      chunksDropped: outcome.chunksDropped,
    });
    if (!reading.ok) {
      source.read = reading.reason;
      continue;
    }
    read += 1;
    source.read = "READ";
    source.claims = reading.claims.length;
    report.extractedBy = reading.extractedBy;
    for (const claim of reading.claims)
      candidateClaims.push({
        ...claim,
        id: `c${candidateClaims.length + 1}`,
        source: index,
      });
  }
  report.claims = candidateClaims.length;
  if (read === 0)
    return fail(
      order.some((o) => o.score > 0)
        ? "NO_OPEN_FULL_TEXT"
        : "NO_RELEVANT_TITLE",
    );
  if (!candidateClaims.length) return fail("NO_CLAIMS");

  // 4. the summary from the checked claims only, checked again here
  const sent: SummaryClaimInput[] = candidateClaims
    .slice(0, MAX_SUMMARY_CLAIMS)
    .map((c) => ({
      id: c.id,
      fields: claimFields(c) || "no checked field",
      passage: clip(c.passage.text, MAX_CLAIM_TEXT),
      source: sourceRef(sources[c.source]!),
    }));
  report.claimsSent = sent.length;
  const s = await deps.ask.summary(question, sent);
  if (s.kind === "UNAVAILABLE") return fail("AI_SUMMARY_UNAVAILABLE");
  if (s.kind === "REFUSED") {
    report.summaryDroppedByAi.push(s.refusal);
    return fail("AI_SUMMARY_REFUSED");
  }
  report.summaryKept = s.kept;
  report.summaryDroppedByAi = s.dropped;
  const own = checkSummary(s.summary, sent);
  report.summaryDroppedHere = own.dropped;
  if (!own.kept) return fail("SUMMARY_EMPTY");
  return {
    status: "DRAFT",
    reason: null,
    sources,
    candidateClaims,
    summary: own.text,
    summaryModel: s.writtenBy,
    report,
  };
}
