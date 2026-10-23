/**
 * IDENTIFIERS AND LICENCES OF A SCHOLARLY WORK, NORMALISED (research engine S2).
 *
 * The three APIs write the same identifier three ways: OpenAlex as a URL
 * (`https://doi.org/10.1/X`, `https://openalex.org/W1`), Crossref bare and in
 * its registered case, Europe PMC bare. Duplicates are found by identifier,
 * so one spelling per identifier: a DOI lower case without prefix (the
 * `KnowledgeSource_doi_lowercase` CHECK holds the same rule), a PMID digits
 * only, a PMCID `PMC` plus digits, an OpenAlex id `W` plus digits.
 *
 * A value that does not look like the identifier is null, not a guess.
 */

const DOI_PREFIXES = [/^https?:\/\/(dx\.)?doi\.org\//i, /^doi:\s*/i];

/**
 * Publisher URL paths an API sometimes leaves on a DOI: measured on the stage
 * run of 2026-10-23 (acrobot 35681), "10.1051/bioconf/202624502002/pdf". One
 * trailing segment is cut. A real DOI ending in one of these words would be
 * cut too; the Crossref check after it then reports the DOI as unknown, it is
 * not silently merged.
 */
const URL_ARTEFACT = /\/(?:pdf|epdf|full|fulltext|abstract|html|full\.pdf)$/;

/**
 * A DOI as stored: lower case, no resolver prefix, no publisher URL path;
 * null when it is not one. Percent-encoding is decoded ("%2F" is "/"); a "%"
 * that is not an encoding (an unexpanded template,
 * "10.15578/jppi.27.2.2021.%p", the same stage run) makes the value no DOI:
 * the work stays by its other identifiers.
 */
export function normaliseDoi(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  for (const prefix of DOI_PREFIXES) value = value.replace(prefix, "");
  // a "%" that is not a valid encoding ("%p") makes decoding throw: no DOI
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  value = value.toLowerCase().replace(URL_ARTEFACT, "");
  // registrant "10." + digits, a slash, and a non-empty suffix without spaces
  return /^10\.\d{4,9}\/\S+$/.test(value) && value.length <= 255 ? value : null;
}

export function normalisePmid(raw: unknown): string | null {
  const value =
    typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "")
    .replace(/\/$/, "");
  return /^\d{1,12}$/.test(trimmed) ? trimmed : null;
}

export function normalisePmcid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /(?:^|\/)(pmc)?(\d{1,12})\/?$/i.exec(raw.trim());
  if (!match || !/pmc/i.test(raw)) return null;
  return `PMC${match[2]}`;
}

export function normaliseOpenAlexId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /(?:^|\/)(W\d{1,15})$/i.exec(raw.trim());
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * THE LICENCE VALUES. An open list (the column is text), but every value the
 * discovery writes comes from here. `UNKNOWN` is a value: it says nobody has
 * stated a licence, which is not the same as `CLOSED`.
 */
export const LICENCES = [
  "CC0",
  "CC-BY",
  "CC-BY-SA",
  "CC-BY-ND",
  "CC-BY-NC",
  "CC-BY-NC-SA",
  "CC-BY-NC-ND",
  "CLOSED",
  "UNKNOWN",
] as const;
export type Licence = (typeof LICENCES)[number];

/**
 * How much a licence restricts reuse, low to high. When two sources state two
 * different licences for one work, the stricter one is kept: the licence is
 * the input of the copyright step before any publishing (plan section 8), and
 * there an over-strict reading costs a question, an over-loose one a breach.
 */
const RESTRICTION: Record<Licence, number> = {
  CC0: 0,
  "CC-BY": 1,
  "CC-BY-SA": 2,
  "CC-BY-ND": 3,
  "CC-BY-NC": 4,
  "CC-BY-NC-SA": 5,
  "CC-BY-NC-ND": 6,
  CLOSED: 7,
  UNKNOWN: -1,
};

/**
 * One licence statement to a value. Reads the three spellings: OpenAlex
 * `cc-by-nc`, Europe PMC `cc by-nc`, and a Creative Commons URL
 * (`https://creativecommons.org/licenses/by-nc/4.0/`). Anything else, a
 * publisher's own text-mining licence included, says nothing: `UNKNOWN`.
 */
export function normaliseLicence(raw: unknown): Licence {
  if (typeof raw !== "string") return "UNKNOWN";
  const value = raw.trim().toLowerCase();
  if (!value) return "UNKNOWN";
  if (/creativecommons\.org\/publicdomain\/zero\b/.test(value)) return "CC0";
  if (/^(cc[\s_-]?0|cc[\s_-]?zero|public[\s_-]?domain)$/.test(value))
    return "CC0";
  let parts: string[] | null = null;
  const url = /creativecommons\.org\/licenses\/([a-z-]+)\//.exec(value);
  if (url) parts = url[1]!.split("-");
  else {
    const named = /^cc[\s_-]+(by(?:[\s_-]+(?:nc|nd|sa))*)$/.exec(value);
    if (named) parts = named[1]!.split(/[\s_-]+/);
  }
  if (!parts || parts[0] !== "by") return "UNKNOWN";
  const nc = parts.includes("nc");
  const nd = parts.includes("nd");
  const sa = parts.includes("sa");
  if (nd && sa) return "UNKNOWN"; // not a Creative Commons licence
  if (nc) return nd ? "CC-BY-NC-ND" : sa ? "CC-BY-NC-SA" : "CC-BY-NC";
  return nd ? "CC-BY-ND" : sa ? "CC-BY-SA" : "CC-BY";
}

/** The stricter of two licence statements; `UNKNOWN` never wins over a stated one. */
export function stricterLicence(a: Licence, b: Licence): Licence {
  return RESTRICTION[b] > RESTRICTION[a] ? b : a;
}
