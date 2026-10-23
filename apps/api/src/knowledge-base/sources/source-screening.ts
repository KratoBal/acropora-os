/**
 * SOURCE SCREENING, THE RULES (research engine S4, the "Forrásszűrés" screen,
 * Figma 3:68; plan v4 section 7, step 3: "the model suggests, a person
 * decides"). The editor includes or excludes each discovered source; an
 * exclusion needs a reason, and "other" needs the editor's words. The
 * database holds the same rules as CHECK constraints, so no other path can
 * write a reasonless exclusion either.
 *
 * Pure: the query and the body are read here, in words, and nothing is
 * guessed. The repository and the controller do the rest.
 */
export const SCREENING_STATUSES = ["PENDING", "INCLUDED", "EXCLUDED"] as const;
export type ScreeningStatus = (typeof SCREENING_STATUSES)[number];

export const EXCLUSION_REASONS = [
  "NOT_MARINE",
  "NOT_CORAL",
  "NOT_RELEVANT",
  "DUPLICATE",
  "OTHER",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const SOURCE_KINDS = [
  "PEER_REVIEWED",
  "PREPRINT",
  "REVIEW",
  "BOOK",
  "MANUFACTURER",
  "HOBBY_ARTICLE",
  "FORUM",
  "OWN_DATA",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_NOTE = 500;

export interface SourceListQuery {
  /** null: every status. */
  status: ScreeningStatus | null;
  kind: SourceKind | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** true: with an open full text; false: without; null: both. */
  openAccess: boolean | null;
  page: number;
  pageSize: number;
}

export type Parsed<T> =
  { ok: true; value: T } | { ok: false; problems: string[] };

const one = (v: unknown): string | null =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : Array.isArray(v) && typeof v[0] === "string"
      ? v[0].trim() || null
      : null;

/** The list's query string. Without `status` it shows what waits for a decision. */
export function parseSourceListQuery(
  raw: Record<string, unknown>,
): Parsed<SourceListQuery> {
  const problems: string[] = [];
  const status = one(raw.status) ?? "PENDING";
  if (
    status !== "ALL" &&
    !(SCREENING_STATUSES as readonly string[]).includes(status)
  )
    problems.push("status: PENDING, INCLUDED, EXCLUDED vagy ALL.");
  const kind = one(raw.kind);
  if (kind !== null && !(SOURCE_KINDS as readonly string[]).includes(kind))
    problems.push("kind: ismeretlen forrásfajta.");
  const int = (name: string, min: number, max: number): number | null => {
    const v = one(raw[name]);
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name}: ${min} és ${max} közötti egész szám.`);
      return null;
    }
    return n;
  };
  const yearFrom = int("yearFrom", 1500, 3000);
  const yearTo = int("yearTo", 1500, 3000);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo)
    problems.push("yearFrom nem lehet nagyobb, mint yearTo.");
  const oa = one(raw.openAccess);
  if (oa !== null && oa !== "true" && oa !== "false")
    problems.push("openAccess: true vagy false.");
  const page = int("page", 1, 100_000) ?? 1;
  const pageSize = int("pageSize", 1, MAX_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE;
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      status: status === "ALL" ? null : (status as ScreeningStatus),
      kind: kind as SourceKind | null,
      yearFrom,
      yearTo,
      openAccess: oa === null ? null : oa === "true",
      page,
      pageSize,
    },
  };
}

export type ScreeningDecision =
  | { status: "INCLUDED"; reason: null; note: string | null }
  | { status: "EXCLUDED"; reason: ExclusionReason; note: string | null }
  /** Back to "waits for a decision": a wrong click is undone, never hidden. */
  | { status: "PENDING"; reason: null; note: null };

/** The decision's body: `{ decision: INCLUDE | EXCLUDE | RESET, reason?, note? }`. */
export function parseScreeningDecision(
  body: unknown,
): Parsed<ScreeningDecision> {
  const b = (body ?? {}) as Record<string, unknown>;
  const note =
    typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  if (note !== null && note.length > MAX_NOTE)
    return { ok: false, problems: [`note: legfeljebb ${MAX_NOTE} karakter.`] };
  switch (b.decision) {
    case "INCLUDE":
      if (b.reason !== undefined && b.reason !== null)
        return {
          ok: false,
          problems: ["reason: befogadásnál nincs kizárási ok."],
        };
      return { ok: true, value: { status: "INCLUDED", reason: null, note } };
    case "EXCLUDE": {
      const reason = b.reason;
      if (
        typeof reason !== "string" ||
        !(EXCLUSION_REASONS as readonly string[]).includes(reason)
      )
        return {
          ok: false,
          problems: [
            `reason: kizárásnál kötelező, egy ezek közül: ${EXCLUSION_REASONS.join(", ")}.`,
          ],
        };
      if (reason === "OTHER" && note === null)
        return {
          ok: false,
          problems: ["note: az „egyéb” okhoz a megjegyzés kötelező."],
        };
      return {
        ok: true,
        value: { status: "EXCLUDED", reason: reason as ExclusionReason, note },
      };
    }
    case "RESET":
      return {
        ok: true,
        value: { status: "PENDING", reason: null, note: null },
      };
    default:
      return {
        ok: false,
        problems: ["decision: INCLUDE, EXCLUDE vagy RESET."],
      };
  }
}
