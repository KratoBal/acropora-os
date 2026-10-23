import type { Vocabulary } from "@acropora/knowledge-base";

import { DISCOVERY_USER_AGENT } from "../discovery/scholarly-client.js";
import { checkClaims } from "./claim-check.js";
import type { ClaimExtractor } from "./claim-extractor.js";
import type { ExtractionStore } from "./extraction-store.js";
import { sha256 } from "./extraction-store.js";
import { chunkSections, chunkText, jatsSections } from "./jats-text.js";

/**
 * THE CLAIM EXTRACTION OF A FEW SOURCES (plan v4, 9.2 S3).
 *
 * Per source: the open-access full text from Europe PMC (JATS), its sections,
 * one AI call per chunk of sections, the OS's own check of every claim, and,
 * with `apply`, the store. Without `apply` it does everything but the store.
 *
 * A source is skipped, with its reason, when: it is not found; it has a
 * RETRACTION version (nothing is built on a retracted work); it was already
 * extracted; it has no PMCID or Europe PMC holds no open full text for it
 * (NO_OPEN_FULL_TEXT: a closed work needs the editor's manual PDF, which is
 * the S4 editor screen's job, not this slice's).
 *
 * The report carries counts and codes, never the text: the text is a third
 * party's, and the report lands in a terminal or a run record.
 */
export const EUROPE_PMC_FULL_TEXT = (pmcid: string) =>
  `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`;
export const MAX_SOURCES_PER_RUN = 5;
export const MAX_CHUNKS_PER_SOURCE = 6;
export const MAX_FULL_TEXT_BYTES = 5_000_000;
export const FULL_TEXT_TIMEOUT_MS = 30_000;

export type FullTextAnswer =
  { ok: true; xml: string } | { ok: false; reason: string };

export type TextFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<Response>;

/** The open full text, or why not. A 404 is "Europe PMC has no open text". */
export async function fetchFullText(
  pmcid: string,
  fetch: TextFetch,
): Promise<FullTextAnswer> {
  let response: Response;
  try {
    response = await fetch(EUROPE_PMC_FULL_TEXT(pmcid), {
      method: "GET",
      headers: {
        "User-Agent": DISCOVERY_USER_AGENT,
        Accept: "application/xml",
      },
      signal: AbortSignal.timeout(FULL_TEXT_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error)?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK",
    };
  }
  if (response.status === 404)
    return { ok: false, reason: "NO_OPEN_FULL_TEXT" };
  if (response.status !== 200)
    return { ok: false, reason: `HTTP_${response.status}` };
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_FULL_TEXT_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const xml = await response.text();
  if (xml.length > MAX_FULL_TEXT_BYTES)
    return { ok: false, reason: "TOO_LARGE" };
  if (!/<article\b/i.test(xml)) return { ok: false, reason: "NOT_JATS" };
  return { ok: true, xml };
}

export interface SourceOutcome {
  sourceId: string;
  status: "EXTRACTED" | "PREVIEWED" | "SKIPPED";
  reason: string | null;
  sections: number;
  calls: number;
  /** AI calls that did not answer, by reason code. */
  unavailable: Record<string, number>;
  claims: number;
  fields: number;
  questions: number;
  /** Claims dropped whole, here or by the AI service, by code. */
  refusedClaims: Record<string, number>;
  /** Fields dropped, by code. */
  refusedFields: Record<string, number>;
  claimsCreated: number;
}

export interface ExtractionDeps {
  store: ExtractionStore;
  extractor: ClaimExtractor;
  fetch: TextFetch;
  vocabulary: Vocabulary;
  now: () => Date;
  /** The stored run, when there is one: its row must still be RUNNING to store. */
  runId?: string;
}

const count = (into: Record<string, number>, code: string) => {
  into[code] = (into[code] ?? 0) + 1;
};

export async function extractSource(
  sourceId: string,
  apply: boolean,
  deps: ExtractionDeps,
): Promise<SourceOutcome> {
  const outcome: SourceOutcome = {
    sourceId,
    status: "SKIPPED",
    reason: null,
    sections: 0,
    calls: 0,
    unavailable: {},
    claims: 0,
    fields: 0,
    questions: 0,
    refusedClaims: {},
    refusedFields: {},
    claimsCreated: 0,
  };
  const skip = (reason: string) => ({ ...outcome, reason });
  const source = await deps.store.source(sourceId);
  if (!source) return skip("NOT_FOUND");
  if (source.retracted) return skip("RETRACTED");
  if (source.alreadyExtracted) return skip("ALREADY_EXTRACTED");
  if (!source.pmcid) return skip("NO_OPEN_FULL_TEXT");
  const text = await fetchFullText(source.pmcid, deps.fetch);
  if (!text.ok) return skip(text.reason);
  const sections = jatsSections(text.xml);
  outcome.sections = sections.length;
  if (!sections.length) return skip("NO_SECTIONS");

  const vocabularyKeys = {
    taxa: deps.vocabulary.taxa.map((t) => t.key),
    environments: deps.vocabulary.environments.map((t) => t.key),
    effects: deps.vocabulary.effects.map((t) => t.key),
  };
  const checked = [];
  let extractedBy = "unknown";
  for (const chunk of chunkSections(sections).slice(0, MAX_CHUNKS_PER_SOURCE)) {
    outcome.calls += 1;
    const answer = await deps.extractor.extract({
      sourceText: chunkText(chunk),
      subject: "PHOSPHATE",
      vocabulary: vocabularyKeys,
    });
    if (answer.kind === "UNAVAILABLE") {
      count(outcome.unavailable, answer.reason);
      continue;
    }
    if (answer.kind === "REFUSED") {
      count(outcome.refusedClaims, `AI_${answer.refusal}`);
      continue;
    }
    extractedBy = answer.extractedBy;
    for (const code of answer.refusedClaims)
      count(outcome.refusedClaims, `AI_${code}`);
    // the OS checks against ALL sections: a field's anchor may stand in another one
    const result = checkClaims(answer.claims, sections, deps.vocabulary);
    for (const code of result.refusedClaims) count(outcome.refusedClaims, code);
    for (const claim of result.claims) {
      for (const r of claim.refused) count(outcome.refusedFields, r.refusal);
      outcome.fields += claim.anchors.filter(
        (a) => a.proposed === undefined,
      ).length;
      outcome.questions += claim.anchors.filter(
        (a) => a.proposed !== undefined,
      ).length;
      checked.push(claim);
    }
  }
  if (
    outcome.calls ===
    Object.values(outcome.unavailable).reduce((a, b) => a + b, 0)
  )
    return skip("AI_UNAVAILABLE");
  outcome.claims = checked.length;
  if (!apply) return { ...outcome, status: "PREVIEWED" };
  const saved = await deps.store.saveSource({
    sourceId,
    contentHash: sha256(text.xml),
    extractedBy,
    claims: checked,
    verifiedAt: deps.now(),
    ...(deps.runId ? { runId: deps.runId } : {}),
  });
  return {
    ...outcome,
    status: "EXTRACTED",
    claimsCreated: saved.claimsCreated,
  };
}
