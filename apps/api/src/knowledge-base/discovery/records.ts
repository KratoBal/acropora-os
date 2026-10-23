import {
  normaliseDoi,
  normaliseLicence,
  normaliseOpenAlexId,
  normalisePmcid,
  normalisePmid,
  stricterLicence,
  type Licence,
} from "./identifiers.js";

/**
 * ONE WORK AS AN API DESCRIBED IT, BEFORE IT IS A `KnowledgeSource` ROW.
 *
 * Only fixed metadata fields are read from an answer: identifiers, type,
 * year, licence, the open-access link, the retraction flag and the citation
 * list. The title, the authors and the venue are kept as data (the editor
 * screens on them) but never read as instructions, and the abstract and the
 * free-text notices are not read at all: an OpenAlex answer carries a
 * `meta.notice` addressed to AI agents (plan section 3, B7).
 */
export type SourceKind = "PEER_REVIEWED" | "PREPRINT" | "REVIEW" | "BOOK";
export type DiscoveredVia =
  "OPENALEX" | "EUROPE_PMC" | "CITATION_GRAPH" | "MANUAL";

export interface SourceCandidate {
  doi: string | null;
  openalexId: string | null;
  pmid: string | null;
  pmcid: string | null;
  kind: SourceKind;
  title: string;
  authors: { name: string; orcid: string | null }[];
  year: number | null;
  venue: string | null;
  url: string | null;
  licence: Licence;
  /** An open full text the pilot may read; Europe PMC's first, then OpenAlex's. */
  oaUrl: string | null;
  discoveredVia: DiscoveredVia;
  /**
   * Later versions an API states on the work's own record, without a notice
   * DOI: OpenAlex's retraction flag (it reads Retraction Watch), Europe PMC's
   * publication type and correction list. They matter most for a work with no
   * DOI, which Crossref cannot check (barracuda, #1834 review).
   */
  versionSignals: VersionSignal[];
  /** OpenAlex ids this work cites, for the citation graph. */
  referencedWorks: string[];
}

/** A work the discovery saw and did not take, with the reason in the report. */
export interface SkippedWork {
  api: "OPENALEX" | "EUROPE_PMC";
  reason: string;
}

export type Mapped =
  | { ok: true; candidate: SourceCandidate }
  | { ok: false; skipped: SkippedWork };

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const yearOf = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 1500 && n < 3000
    ? n
    : null;
};

/**
 * OpenAlex `type` to a source kind. The work types with no literature meaning
 * for the pilot (dataset, paratext, erratum, editorial, letter...) and the
 * ones the schema has no kind for (dissertation, report, conference paper)
 * are skipped WITH their type in the report: a skip is an answer, not a
 * silent loss, and the editor sees how many there were.
 */
const OPENALEX_KINDS: Record<string, SourceKind> = {
  article: "PEER_REVIEWED",
  review: "REVIEW",
  preprint: "PREPRINT",
  book: "BOOK",
  "book-chapter": "BOOK",
};

export function fromOpenAlexWork(
  work: unknown,
  discoveredVia: DiscoveredVia,
): Mapped {
  const w = (work ?? {}) as Record<string, unknown>;
  const type = str(w.type) ?? "unknown";
  const kind = OPENALEX_KINDS[type];
  if (!kind)
    return { ok: false, skipped: { api: "OPENALEX", reason: `type:${type}` } };
  const ids = (w.ids ?? {}) as Record<string, unknown>;
  const primary = (w.primary_location ?? {}) as Record<string, unknown>;
  const best = (w.best_oa_location ?? null) as Record<string, unknown> | null;
  const title = str(w.title) ?? str(w.display_name);
  if (!title)
    return { ok: false, skipped: { api: "OPENALEX", reason: "no-title" } };
  // OpenAlex's `oa_status: closed` means it knows no open copy, not that a
  // licence says so; Europe PMC or Crossref may still state one. So no
  // statement stays UNKNOWN.
  const licence = stricterLicence(
    normaliseLicence(primary.license),
    normaliseLicence(best?.license),
  );
  const authorships = Array.isArray(w.authorships) ? w.authorships : [];
  return {
    ok: true,
    candidate: {
      doi: normaliseDoi(w.doi) ?? normaliseDoi(ids.doi),
      openalexId: normaliseOpenAlexId(w.id),
      pmid: normalisePmid(ids.pmid),
      pmcid: normalisePmcid(ids.pmcid),
      kind,
      title,
      authors: authorships
        .map((a) => {
          const author = ((a as Record<string, unknown>)?.author ??
            {}) as Record<string, unknown>;
          const name = str(author.display_name);
          return name
            ? {
                name,
                orcid:
                  str(author.orcid)?.replace(/^https?:\/\/orcid\.org\//, "") ??
                  null,
              }
            : null;
        })
        .filter((a): a is { name: string; orcid: string | null } => !!a),
      year: yearOf(w.publication_year),
      venue: str(
        ((primary.source ?? {}) as Record<string, unknown>).display_name,
      ),
      url:
        str(primary.landing_page_url) ??
        (normaliseDoi(w.doi) ? `https://doi.org/${normaliseDoi(w.doi)}` : null),
      licence,
      oaUrl: best ? (str(best.pdf_url) ?? str(best.landing_page_url)) : null,
      discoveredVia,
      versionSignals:
        w.is_retracted === true
          ? [{ versionKind: "RETRACTION", detectedVia: "OPENALEX_RETRACTED" }]
          : [],
      referencedWorks: (Array.isArray(w.referenced_works)
        ? w.referenced_works
        : []
      )
        .map(normaliseOpenAlexId)
        .filter((id): id is string => !!id),
    },
  };
}

/**
 * A Europe PMC `core` result. `source: PPR` is a preprint; the publication
 * types name a review; the rest of the indexed literature is a journal
 * article. The open full-text link is the Europe PMC article page of an open
 * access record (`fullTextUrlList`, availability code `OA`, site Europe_PMC):
 * that is where the JATS full text the S3 reader will use lives.
 */
export function fromEuropePmcResult(result: unknown): Mapped {
  const r = (result ?? {}) as Record<string, unknown>;
  const title = str(r.title);
  if (!title)
    return { ok: false, skipped: { api: "EUROPE_PMC", reason: "no-title" } };
  const pubTypes = (((r.pubTypeList ?? {}) as Record<string, unknown>)
    .pubType ?? []) as unknown[];
  const types = (Array.isArray(pubTypes) ? pubTypes : [pubTypes])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase());
  const corrections = (
    (((r.commentCorrectionList ?? {}) as Record<string, unknown>)
      .commentCorrection ?? []) as Record<string, unknown>[]
  )
    .map((c) => (typeof c?.type === "string" ? c.type.toLowerCase() : ""))
    .filter(Boolean);
  // a notice is not literature: the work it changes carries it as a version
  const notice =
    types.find((t) => EUROPE_PMC_NOTICE_TYPES.includes(t)) ??
    corrections.find((c) => EUROPE_PMC_NOTICE_LINKS.includes(c));
  if (notice)
    return {
      ok: false,
      skipped: { api: "EUROPE_PMC", reason: `notice:${notice}` },
    };
  const kind: SourceKind =
    r.source === "PPR" || types.includes("preprint")
      ? "PREPRINT"
      : types.some((t) => t === "review" || t === "review-article")
        ? "REVIEW"
        : "PEER_REVIEWED";
  const urls = (((r.fullTextUrlList ?? {}) as Record<string, unknown>)
    .fullTextUrl ?? []) as Record<string, unknown>[];
  const openAccess = r.isOpenAccess === "Y";
  const oaPage = Array.isArray(urls)
    ? urls.find((u) => u?.availabilityCode === "OA" && u?.site === "Europe_PMC")
    : undefined;
  const pmcid = normalisePmcid(r.pmcid);
  const authors = (((r.authorList ?? {}) as Record<string, unknown>).author ??
    []) as Record<string, unknown>[];
  const journal = ((r.journalInfo ?? {}) as Record<string, unknown>).journal as
    Record<string, unknown> | undefined;
  const doi = normaliseDoi(r.doi);
  return {
    ok: true,
    candidate: {
      doi,
      openalexId: null,
      pmid:
        r.source === "MED"
          ? normalisePmid(r.pmid ?? r.id)
          : normalisePmid(r.pmid),
      pmcid,
      kind,
      title,
      authors: (Array.isArray(authors) ? authors : [])
        .map((a) => {
          const name = str(a?.fullName);
          const orcid =
            ((a?.authorId ?? {}) as Record<string, unknown>).type === "ORCID"
              ? str(((a?.authorId ?? {}) as Record<string, unknown>).value)
              : null;
          return name ? { name, orcid } : null;
        })
        .filter((a): a is { name: string; orcid: string | null } => !!a),
      year: yearOf(r.pubYear),
      venue: str(journal?.title),
      url: doi
        ? `https://doi.org/${doi}`
        : pmcid
          ? `https://europepmc.org/articles/${pmcid}`
          : null,
      licence: normaliseLicence(r.license),
      oaUrl: !openAccess
        ? null
        : oaPage
          ? str(oaPage.url)
          : pmcid
            ? `https://europepmc.org/articles/${pmcid}`
            : null,
      discoveredVia: "EUROPE_PMC",
      versionSignals: europePmcSignals(types, corrections),
      referencedWorks: [],
    },
  };
}

/** A Crossref record's licence: the stricter of its Creative Commons statements. */
export function crossrefLicence(item: unknown): Licence {
  const licences = ((item ?? {}) as Record<string, unknown>).license;
  if (!Array.isArray(licences)) return "UNKNOWN";
  return licences
    .map((l) => normaliseLicence((l as Record<string, unknown>)?.URL))
    .reduce<Licence>((acc, l) => stricterLicence(acc, l), "UNKNOWN");
}

export type VersionKind =
  "CORRECTION" | "ERRATUM" | "RETRACTION" | "EXPRESSION_OF_CONCERN" | "UPDATE";
export type DetectedVia =
  | "CROSSREF_UPDATE_TO"
  | "RETRACTION_WATCH"
  | "OPENALEX_RETRACTED"
  | "EUROPE_PMC";

/** A version stated on the work's own record, with no notice DOI. */
export interface VersionSignal {
  versionKind: VersionKind;
  detectedVia: DetectedVia;
}

/**
 * EUROPE PMC'S VERSION WORDS, measured 2026-10-23 on `PUB_TYPE:"Retracted
 * Publication" AND coral` (60 hits): a retracted work has the publication
 * type "Retracted Publication" and the link "Retraction in"; a corrected one
 * "Erratum in". The notices themselves are typed "Retraction Notice",
 * "Published Erratum" or "correction", and link back with "Erratum for".
 * "Correction in", "Expression of concern in" and "Retraction of" were not in
 * that sample; they are read by their name, the safer direction.
 */
const EUROPE_PMC_NOTICE_TYPES = [
  "retraction notice",
  "retraction of publication",
  "published erratum",
  "correction",
  "expression of concern",
];
const EUROPE_PMC_NOTICE_LINKS = [
  "erratum for",
  "retraction of",
  "correction for",
];

function europePmcSignals(
  types: readonly string[],
  corrections: readonly string[],
): VersionSignal[] {
  const kinds = new Set<VersionKind>();
  if (
    types.includes("retracted publication") ||
    corrections.includes("retraction in")
  )
    kinds.add("RETRACTION");
  if (corrections.includes("erratum in")) kinds.add("ERRATUM");
  if (corrections.includes("correction in")) kinds.add("CORRECTION");
  if (corrections.includes("expression of concern in"))
    kinds.add("EXPRESSION_OF_CONCERN");
  return [...kinds].map((versionKind) => ({
    versionKind,
    detectedVia: "EUROPE_PMC",
  }));
}

/** A later change to a work: a correction, a retraction, a concern. */
export interface VersionCandidate {
  /** The work it changes (lower-case DOI). */
  doi: string;
  versionKind: VersionKind;
  /** The notice's own DOI; equal to `doi` when the publisher marks the work itself. */
  relatedDoi: string | null;
  noticeDate: Date | null;
  detectedVia: DetectedVia;
}

const UPDATE_KINDS: Record<string, VersionKind> = {
  retraction: "RETRACTION",
  withdrawal: "RETRACTION",
  removal: "RETRACTION",
  correction: "CORRECTION",
  corrigendum: "CORRECTION",
  erratum: "ERRATUM",
  expression_of_concern: "EXPRESSION_OF_CONCERN",
  "expression-of-concern": "EXPRESSION_OF_CONCERN",
};

/**
 * THE LATER VERSIONS OF THE WORKS IN A CROSSREF `filter=doi:` ANSWER.
 *
 * Crossref states an update twice: on the NOTICE (`update-to`, naming the
 * work) and on the WORK (`updated-by`, naming the notice). The work's side is
 * read, so the DOI check, the licence and the versions come from ONE request
 * per batch (measured 2026-10-23: the record 10.1177/1758835919874651 carries
 * `updated-by` 10.1177/17588359211061903, retraction; 10.1007/s00338-022-02223-0
 * a correction; and `select=...,updated-by` is accepted). Some publishers mark
 * the work itself, so the notice DOI may be the work's own. Retraction Watch
 * and the publisher can both state the same notice: one version per (work,
 * kind, notice), the publisher's statement kept.
 */
export function crossrefNotices(
  items: unknown,
  asked: ReadonlySet<string>,
): VersionCandidate[] {
  const found = new Map<string, VersionCandidate>();
  for (const item of Array.isArray(items) ? items : []) {
    const record = (item ?? {}) as Record<string, unknown>;
    const doi = normaliseDoi(record.DOI);
    if (!doi || !asked.has(doi)) continue;
    const updates = Array.isArray(record["updated-by"])
      ? (record["updated-by"] as Record<string, unknown>[])
      : [];
    for (const update of updates) {
      const noticeDoi = normaliseDoi(update?.DOI);
      const type = (str(update?.type) ?? "").toLowerCase();
      const versionKind = UPDATE_KINDS[type] ?? "UPDATE";
      const detectedVia: DetectedVia =
        update?.source === "retraction-watch"
          ? "RETRACTION_WATCH"
          : "CROSSREF_UPDATE_TO";
      const dateTime = str(
        ((update?.updated ?? {}) as Record<string, unknown>)["date-time"],
      );
      const noticeDate = dateTime ? new Date(dateTime) : null;
      const key = `${doi} ${versionKind} ${noticeDoi ?? ""}`;
      const existing = found.get(key);
      if (existing && existing.detectedVia === "CROSSREF_UPDATE_TO") continue;
      found.set(key, {
        doi,
        versionKind,
        relatedDoi: noticeDoi,
        noticeDate:
          noticeDate && !Number.isNaN(noticeDate.getTime()) ? noticeDate : null,
        detectedVia,
      });
    }
  }
  return [...found.values()];
}
