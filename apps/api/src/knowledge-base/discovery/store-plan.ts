import type { SourceCandidate, VersionCandidate } from "./records.js";

/**
 * The versions a work gets from this run: every Crossref notice on its DOI,
 * and a retraction from OpenAlex's flag when Crossref holds no retraction
 * notice for it (OpenAlex reads Retraction Watch; a missed retraction is the
 * costlier mistake, so the flag alone is enough to record it).
 */
export function versionsFor(
  candidate: SourceCandidate,
  notices: readonly VersionCandidate[],
): Omit<VersionCandidate, "doi">[] {
  const own = candidate.doi
    ? notices.filter((n) => n.doi === candidate.doi)
    : [];
  const versions = own.map(({ doi: _doi, ...rest }) => rest);
  if (
    candidate.retractedFlag &&
    !versions.some((v) => v.versionKind === "RETRACTION")
  )
    versions.push({
      versionKind: "RETRACTION",
      relatedDoi: null,
      noticeDate: null,
      detectedVia: "OPENALEX_RETRACTED",
    });
  return versions;
}

/** Only a DOI that went through the notice check may be stored. */
export function isStorable(
  candidate: SourceCandidate,
  checked: ReadonlySet<string>,
): boolean {
  return !candidate.doi || checked.has(candidate.doi);
}
