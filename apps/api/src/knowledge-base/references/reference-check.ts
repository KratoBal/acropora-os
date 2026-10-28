import { CROSSREF_BASE, EUROPE_PMC_BASE } from "../discovery/discovery-run.js";
import { normaliseDoi, normalisePmid } from "../discovery/identifiers.js";
import type { ScholarlyClient } from "../discovery/scholarly-client.js";

/**
 * T1 OF THE RESEARCH TEST SET (plan v4, 10; S7): every DOI and PMID of a
 * source a claim can rest on exists, and points to THAT source.
 *
 * Measured against the real registries, not against a stored answer: a
 * recorded Crossref response would only measure our reading of it, not that
 * the DOI exists, which is what T1 claims. So the check runs on the stage api
 * by hand (`knowledge:check-references`); its reading of an answer is what the
 * unit spec pins.
 *
 *   DOI   Crossref `/works/{doi}`: 404 is NOT_FOUND; an answer whose DOI or
 *         title is another work's is OTHER_WORK.
 *   PMID  Europe PMC `EXT_ID:{pmid} AND SRC:MED`: no hit is NOT_FOUND; a hit
 *         whose PMID, title, or DOI (when both sides have one) differs is
 *         OTHER_WORK.
 *
 * A refused API (5xx, timeout, a 429 past the retries) is UNREACHABLE: the
 * identifier is not measured, and the run does not meet the threshold by
 * leaving it out. Titles are compared, never printed: they are third-party
 * text and stay data in the table.
 */

export interface ReferenceSource {
  id: string;
  doi: string | null;
  pmid: string | null;
  title: string;
  year: number | null;
}

export type ReferenceVerdict =
  "RESOLVED" | "NOT_FOUND" | "OTHER_WORK" | "UNREACHABLE";

export interface ReferenceResult {
  sourceId: string;
  kind: "DOI" | "PMID";
  identifier: string;
  verdict: ReferenceVerdict;
  /** Codes, never text from the registry: TITLE_DIFFERS, DOI_DIFFERS, HTTP_404, ... */
  reasons: string[];
  /** The registry's year differs from the source's (a note: online and print years differ). */
  yearDiffers: boolean;
}

export interface ReferenceReport {
  sources: number;
  identifiers: number;
  resolved: number;
  results: ReferenceResult[];
  /** Every identifier RESOLVED, and at least one measured (plan 10: 100%). */
  met: boolean;
}

/** Letters and digits only, lower case, without diacritics: how two titles are compared. */
export function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/<[^>]*>/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The shorter key must be this long before a prefix counts as the same title. */
export const MIN_PREFIX_KEY = 20;

/**
 * The same title: equal keys, or one the other's beginning (a subtitle the
 * other side left out), when the shorter is at least MIN_PREFIX_KEY long.
 */
export function titlesMatch(a: string, b: string): boolean {
  const [x, y] = [titleKey(a), titleKey(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_PREFIX_KEY && long.startsWith(short);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const firstString = (v: unknown): string | null =>
  Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;

/** A DOI in a URL: escaped, but its slash kept, as the APIs write it. */
const encodeDoi = (doi: string): string =>
  encodeURIComponent(doi).replace(/%2F/gi, "/");

/** Reads a Crossref `/works/{doi}` answer against the source. */
export function readCrossrefWork(
  source: ReferenceSource,
  doi: string,
  json: unknown,
): Pick<ReferenceResult, "verdict" | "reasons" | "yearDiffers"> {
  const message = isRecord(json) ? json.message : null;
  if (!isRecord(message))
    return {
      verdict: "OTHER_WORK",
      reasons: ["NO_WORK_IN_ANSWER"],
      yearDiffers: false,
    };
  const reasons: string[] = [];
  if (normaliseDoi(message.DOI) !== doi) reasons.push("DOI_DIFFERS");
  const title = firstString(message.title);
  const subtitle = firstString(message.subtitle);
  const titles = [
    title,
    title && subtitle ? `${title}: ${subtitle}` : null,
  ].filter((t): t is string => t !== null);
  if (!titles.some((t) => titlesMatch(t, source.title)))
    reasons.push("TITLE_DIFFERS");
  const parts = isRecord(message.issued) ? message.issued["date-parts"] : null;
  const year =
    Array.isArray(parts) &&
    Array.isArray(parts[0]) &&
    typeof parts[0][0] === "number"
      ? parts[0][0]
      : null;
  return {
    verdict: reasons.length ? "OTHER_WORK" : "RESOLVED",
    reasons,
    yearDiffers: year !== null && source.year !== null && year !== source.year,
  };
}

/** Reads a Europe PMC `EXT_ID:{pmid} AND SRC:MED` search answer against the source. */
export function readEuropePmcHit(
  source: ReferenceSource,
  pmid: string,
  json: unknown,
): Pick<ReferenceResult, "verdict" | "reasons" | "yearDiffers"> {
  const list =
    isRecord(json) && isRecord(json.resultList) ? json.resultList.result : null;
  const hits = Array.isArray(list) ? list.filter(isRecord) : [];
  const hit = hits.find((h) => normalisePmid(h.pmid) === pmid);
  if (!hit)
    return {
      verdict: hits.length ? "OTHER_WORK" : "NOT_FOUND",
      reasons: [hits.length ? "PMID_DIFFERS" : "NO_HIT"],
      yearDiffers: false,
    };
  const reasons: string[] = [];
  if (typeof hit.title !== "string" || !titlesMatch(hit.title, source.title))
    reasons.push("TITLE_DIFFERS");
  const theirDoi = normaliseDoi(hit.doi);
  if (source.doi !== null && theirDoi !== null && theirDoi !== source.doi)
    reasons.push("DOI_DIFFERS");
  const year = Number(hit.pubYear);
  return {
    verdict: reasons.length ? "OTHER_WORK" : "RESOLVED",
    reasons,
    yearDiffers:
      Number.isInteger(year) && source.year !== null && year !== source.year,
  };
}

export async function checkReferences(
  sources: readonly ReferenceSource[],
  client: Pick<ScholarlyClient, "getJson">,
): Promise<ReferenceReport> {
  const results: ReferenceResult[] = [];
  for (const source of sources) {
    const doi = normaliseDoi(source.doi);
    if (doi !== null) {
      const answer = await client.getJson(
        "CROSSREF",
        `${CROSSREF_BASE}/works/${encodeDoi(doi)}`,
      );
      const base = {
        sourceId: source.id,
        kind: "DOI" as const,
        identifier: doi,
      };
      if (answer.ok)
        results.push({
          ...base,
          ...readCrossrefWork(source, doi, answer.json),
        });
      else
        results.push({
          ...base,
          verdict: answer.httpStatus === 404 ? "NOT_FOUND" : "UNREACHABLE",
          reasons: [answer.reason],
          yearDiffers: false,
        });
    }
    const pmid = normalisePmid(source.pmid);
    if (pmid !== null) {
      const query = encodeURIComponent(`EXT_ID:${pmid} AND SRC:MED`);
      const answer = await client.getJson(
        "EUROPE_PMC",
        `${EUROPE_PMC_BASE}/search?query=${query}&resultType=lite&format=json&pageSize=5`,
      );
      const base = {
        sourceId: source.id,
        kind: "PMID" as const,
        identifier: pmid,
      };
      if (answer.ok)
        results.push({
          ...base,
          ...readEuropePmcHit(source, pmid, answer.json),
        });
      else
        results.push({
          ...base,
          verdict: "UNREACHABLE",
          reasons: [answer.reason],
          yearDiffers: false,
        });
    }
  }
  const resolved = results.filter((r) => r.verdict === "RESOLVED").length;
  return {
    sources: sources.length,
    identifiers: results.length,
    resolved,
    results,
    met: results.length > 0 && resolved === results.length,
  };
}

/** The report as text: counts, then one line per identifier that is not RESOLVED, and the year notes. */
export function referenceReportText(r: ReferenceReport): string {
  const lines = [
    `T1: ${r.resolved}/${r.identifiers} azonosító feloldva, ${r.sources} forrásból -> ${r.met ? "TELJESÜL" : "NEM TELJESÜL"} (küszöb: 100%)`,
  ];
  for (const x of r.results.filter((x) => x.verdict !== "RESOLVED"))
    lines.push(
      `  ${x.verdict} ${x.kind} ${x.identifier} (forrás ${x.sourceId}): ${x.reasons.join(", ")}`,
    );
  const years = r.results.filter((x) => x.yearDiffers);
  if (years.length)
    lines.push(
      `  megjegyzés: ${years.length} azonosítónál az év eltér (online és nyomtatott év): ${years.map((x) => x.identifier).join(", ")}`,
    );
  return `${lines.join("\n")}\n`;
}
