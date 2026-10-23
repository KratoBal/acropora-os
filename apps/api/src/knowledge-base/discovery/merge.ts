import { stricterLicence } from "./identifiers.js";
import type { SourceCandidate } from "./records.js";

/**
 * ONE WORK, ONE CANDIDATE: the same paper found by OpenAlex, Europe PMC and
 * the citation graph is merged by any identifier they share (DOI, PMID,
 * PMCID, OpenAlex id), transitively. Merging is deterministic: the order of
 * the input decides every "first", and the input order is the run's own
 * (queries in file order, pages in API order).
 *
 * Two different values of the SAME identifier inside one merged group (two
 * DOIs linked through one PMID, say) are not resolved here: the group keeps
 * the first and reports the conflict, so a person can look at it.
 */
export interface MergeResult {
  candidates: SourceCandidate[];
  /** Merged groups that carried two values of one identifier. */
  conflicts: { identifier: IdField; values: string[] }[];
}

export type IdField = "doi" | "openalexId" | "pmid" | "pmcid";
export const ID_FIELDS: readonly IdField[] = [
  "doi",
  "openalexId",
  "pmid",
  "pmcid",
];

export function mergeCandidates(
  input: readonly SourceCandidate[],
): MergeResult {
  const parent = input.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const seen = new Map<string, number>();
  input.forEach((candidate, i) => {
    for (const field of ID_FIELDS) {
      const value = candidate[field];
      if (!value) continue;
      const key = `${field}:${value}`;
      const other = seen.get(key);
      if (other === undefined) seen.set(key, i);
      else {
        const a = find(other);
        const b = find(i);
        // the earlier index stays the root, so "first" is the input order
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const groups = new Map<number, SourceCandidate[]>();
  input.forEach((candidate, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  });
  const candidates: SourceCandidate[] = [];
  const conflicts: MergeResult["conflicts"] = [];
  for (const root of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(root)!;
    for (const field of ID_FIELDS) {
      const values = [
        ...new Set(group.map((c) => c[field]).filter((v): v is string => !!v)),
      ];
      if (values.length > 1) conflicts.push({ identifier: field, values });
    }
    candidates.push(mergeGroup(group));
  }
  return { candidates, conflicts };
}

function mergeGroup(group: readonly SourceCandidate[]): SourceCandidate {
  const first = group[0]!;
  const firstOf = <K extends keyof SourceCandidate>(key: K) =>
    group.map((c) => c[key]).find((v) => v !== null && v !== "") ?? first[key];
  const europePmcOa = group.find(
    (c) => c.discoveredVia === "EUROPE_PMC" && c.oaUrl,
  )?.oaUrl;
  return {
    doi: firstOf("doi"),
    openalexId: firstOf("openalexId"),
    pmid: firstOf("pmid"),
    pmcid: firstOf("pmcid"),
    // a review is a review whoever says so; otherwise the first statement
    kind: group.some((c) => c.kind === "REVIEW") ? "REVIEW" : first.kind,
    title: first.title,
    authors: group.find((c) => c.authors.length)?.authors ?? [],
    year: firstOf("year"),
    venue: firstOf("venue"),
    url: firstOf("url"),
    licence: group.reduce(
      (acc, c) => stricterLicence(acc, c.licence),
      first.licence,
    ),
    // Europe PMC's open copy is the JATS full text the reader (S3) uses
    oaUrl: europePmcOa ?? firstOf("oaUrl"),
    discoveredVia: first.discoveredVia,
    retractedFlag: group.some((c) => c.retractedFlag),
    referencedWorks: [...new Set(group.flatMap((c) => c.referencedWorks))],
  };
}
