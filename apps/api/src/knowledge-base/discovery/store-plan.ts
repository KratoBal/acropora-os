import type { SourceCandidate, VersionCandidate } from "./records.js";

/**
 * The versions a work gets from this run: every Crossref notice on its DOI,
 * and every version its own record states (OpenAlex's retraction flag,
 * Europe PMC's type and correction list) whose kind no Crossref notice
 * already covers. A missed retraction is the costlier mistake, so a signal
 * alone is enough to record it; it carries no notice DOI.
 */
export function versionsFor(
  candidate: SourceCandidate,
  notices: readonly VersionCandidate[],
): Omit<VersionCandidate, "doi">[] {
  const own = candidate.doi
    ? notices.filter((n) => n.doi === candidate.doi)
    : [];
  const versions = own.map(({ doi: _doi, ...rest }) => rest);
  for (const signal of candidate.versionSignals)
    if (!versions.some((v) => v.versionKind === signal.versionKind))
      versions.push({
        versionKind: signal.versionKind,
        relatedDoi: null,
        noticeDate: null,
        detectedVia: signal.detectedVia,
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
