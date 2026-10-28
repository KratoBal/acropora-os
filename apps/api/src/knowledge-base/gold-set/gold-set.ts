/**
 * THE T3 GOLD SET (plan v4, section 10, T3; research-t3-jelolt-keszlet).
 *
 * The extraction is the machine's, the judgement the editor's: ten sources
 * are frozen with their machine claims, and the editor reviews every row in
 * the claim review already in use (field by field). Precision asks nothing
 * new: a row is read from the decisions the review stored. For completeness
 * the editor records, per source, the claims the machine did not bring,
 * and says when a source has no more.
 *
 * Row rules (one claim):
 * - CANDIDATE: waits for the editor (PENDING);
 * - VERIFIED, every field of the claim's own that the MACHINE filled was
 *   accepted: CORRECT;
 * - VERIFIED with such a field corrected or rejected: WRONG, the field named;
 *   a wrong `quantity` (value, unit or basis) is a CRITICAL error (plan 10:
 *   zero allowed);
 * - WITHDRAWN by the editor (discarded, or withdrawn after a mistaken
 *   accept): WRONG as a whole claim (`CLAIM`);
 * - anything else (withdrawn by a re-extraction, DISPUTED by a retraction,
 *   SUPERSEDED, or gone): OUT of the score, shown with its reason.
 * Not errors, shown apart: an editor's QUESTION (the machine proposed no
 * value the vocabulary holds, so it asserted none), and the source's own
 * study fields (they belong to the source, not to one claim).
 *
 * Score (plan 10): precision at least 27 of 30 (at most 3 errors, scaled to
 * the rows scored) with zero value, unit or basis errors; completeness at
 * least 21 of 30 (the machine's real claims among the real claims plus the
 * missed ones). The sample is small, so the 95% Wilson lower bound is shown
 * with each rate. Pure: no database, no clock.
 */

export const GOLD_SOURCE_COUNT = 10;
export const GOLD_MIN_CLAIMS = 30;
/** Plan 10: at most 3 errors in 30 rows, at least 21 of 30 found. */
export const PRECISION_MAX_ERRORS_PER_30 = 3;
export const COMPLETENESS_MIN_FOUND_PER_30 = 21;
export const MAX_MISSED_TEXT = 500;
export const MAX_MISSED_LOCATOR = 128;
export const MAX_MISSED_PER_SOURCE = 50;

export type AnchorDecision = "PENDING" | "ACCEPTED" | "CORRECTED" | "REJECTED";

export interface GoldClaimField {
  field: string;
  /** The machine's value; null for an editor's question. */
  machineValue: string | null;
  decision: AnchorDecision;
}

export interface GoldClaimInput {
  id: string;
  /** null: the frozen claim is no longer in the database. */
  status: string | null;
  /** The claim's own fields (the source's study fields are not here). */
  fields: readonly GoldClaimField[];
  /** The editor discarded it, or withdrew it after accepting it. */
  editorWithdrew: boolean;
}

export type RowVerdict = "PENDING" | "CORRECT" | "WRONG" | "OUT";
export type OutReason = "REEXTRACTED" | "DISPUTED" | "SUPERSEDED" | "MISSING";

export interface RowJudgement {
  verdict: RowVerdict;
  /** WRONG: the fields the editor corrected or rejected, or `CLAIM`. */
  errors: string[];
  /** A wrong quantity: value, unit or basis. */
  critical: boolean;
  /** Fields the machine left as an editor's question. */
  questions: string[];
  /** OUT only. */
  outReason: OutReason | null;
  /** The machine brought a real claim (the editor kept it): counts as found. */
  found: boolean;
}

export const CRITICAL_FIELD = "quantity";

export function judgeRow(claim: GoldClaimInput): RowJudgement {
  const questions = claim.fields
    .filter((f) => f.machineValue === null)
    .map((f) => f.field);
  const base = { errors: [], critical: false, questions, outReason: null };
  const out = (outReason: OutReason): RowJudgement => ({
    ...base,
    verdict: "OUT",
    outReason,
    found: false,
  });
  switch (claim.status) {
    case null:
      return out("MISSING");
    case "CANDIDATE":
      return { ...base, verdict: "PENDING", found: false };
    case "DISPUTED":
      return out("DISPUTED");
    case "SUPERSEDED":
      return out("SUPERSEDED");
    case "WITHDRAWN":
      return claim.editorWithdrew
        ? {
            ...base,
            verdict: "WRONG",
            errors: ["CLAIM"],
            found: false,
          }
        : out("REEXTRACTED");
    case "VERIFIED": {
      const errors = claim.fields
        .filter(
          (f) =>
            f.machineValue !== null &&
            (f.decision === "CORRECTED" || f.decision === "REJECTED"),
        )
        .map((f) => f.field);
      return {
        ...base,
        verdict: errors.length ? "WRONG" : "CORRECT",
        errors,
        critical: errors.includes(CRITICAL_FIELD),
        found: true,
      };
    }
    default:
      return out("MISSING");
  }
}

/** The 95% Wilson score interval's lower bound; null for no rows. */
export function wilsonLower(hits: number, n: number): number | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = hits / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - spread) / (1 + z2 / n));
}

export interface GoldSourceScoreInput {
  sourceId: string;
  rows: readonly RowJudgement[];
  missed: number;
  completenessChecked: boolean;
}

export type ScoreProblem =
  | "NOT_FROZEN"
  | "SOURCE_COUNT"
  | "PENDING_ROWS"
  | "TOO_FEW_SCORED"
  | "COMPLETENESS_OPEN"
  | "GOLD_TOO_SMALL";

export type ScoreFailure = "PRECISION" | "CRITICAL_ERRORS" | "COMPLETENESS";

export interface GoldScore {
  rows: {
    total: number;
    pending: number;
    correct: number;
    wrong: number;
    out: number;
  };
  precision: {
    scored: number;
    correct: number;
    wrong: number;
    critical: number;
    /** Plan 10 scaled to the rows scored: 3 per 30, rounded down. */
    maxErrors: number;
    wilsonLower: number | null;
  };
  completeness: {
    found: number;
    missed: number;
    /** The real claims: the machine's kept ones plus the missed ones. */
    gold: number;
    /** Plan 10 scaled to the gold set: 21 per 30, rounded up. */
    minFound: number;
    wilsonLower: number | null;
    sourcesChecked: number;
  };
  /** NOT_READY while a problem stands; then PASS or FAIL with the failures. */
  verdict: "NOT_READY" | "PASS" | "FAIL";
  problems: ScoreProblem[];
  failures: ScoreFailure[];
}

export function scoreGoldSet(
  sources: readonly GoldSourceScoreInput[],
): GoldScore {
  const rows = sources.flatMap((s) => s.rows);
  const count = (v: RowVerdict) => rows.filter((r) => r.verdict === v).length;
  const correct = count("CORRECT");
  const wrong = count("WRONG");
  const pending = count("PENDING");
  const scored = correct + wrong;
  const critical = rows.filter((r) => r.critical).length;
  const maxErrors = Math.floor(
    (scored * PRECISION_MAX_ERRORS_PER_30) / GOLD_MIN_CLAIMS,
  );
  const found = rows.filter((r) => r.found).length;
  const missed = sources.reduce((n, s) => n + s.missed, 0);
  const gold = found + missed;
  const minFound = Math.ceil(
    (gold * COMPLETENESS_MIN_FOUND_PER_30) / GOLD_MIN_CLAIMS,
  );
  const sourcesChecked = sources.filter((s) => s.completenessChecked).length;

  const problems: ScoreProblem[] = [];
  if (!sources.length) problems.push("NOT_FROZEN");
  else if (sources.length !== GOLD_SOURCE_COUNT) problems.push("SOURCE_COUNT");
  if (pending) problems.push("PENDING_ROWS");
  if (sources.length && scored < GOLD_MIN_CLAIMS)
    problems.push("TOO_FEW_SCORED");
  if (sourcesChecked < sources.length) problems.push("COMPLETENESS_OPEN");
  if (sources.length && gold < GOLD_MIN_CLAIMS) problems.push("GOLD_TOO_SMALL");

  const failures: ScoreFailure[] = [];
  if (wrong > maxErrors) failures.push("PRECISION");
  if (critical > 0) failures.push("CRITICAL_ERRORS");
  if (found < minFound) failures.push("COMPLETENESS");

  return {
    rows: {
      total: rows.length,
      pending,
      correct,
      wrong,
      out: count("OUT"),
    },
    precision: {
      scored,
      correct,
      wrong,
      critical,
      maxErrors,
      wilsonLower: wilsonLower(correct, scored),
    },
    completeness: {
      found,
      missed,
      gold,
      minFound,
      wilsonLower: wilsonLower(found, gold),
      sourcesChecked,
    },
    verdict: problems.length ? "NOT_READY" : failures.length ? "FAIL" : "PASS",
    problems,
    failures: problems.length ? [] : failures,
  };
}

export interface ProposalSource {
  sourceId: string;
  title: string;
  year: number | null;
  /** The source's machine claims a review can score. */
  claims: number;
}

export interface GoldProposal {
  sources: ProposalSource[];
  claims: number;
  /** Ten sources and at least thirty claims: it can be frozen as it is. */
  enough: boolean;
}

/**
 * The fleet's proposal: the included sources with the most machine claims,
 * then the newest, then a stable order. The editor freezes it (or another
 * list); nothing is frozen by the proposal itself.
 */
export function proposeGoldSet(
  candidates: readonly ProposalSource[],
): GoldProposal {
  const sources = candidates
    .filter((c) => c.claims > 0)
    .slice()
    .sort(
      (a, b) =>
        b.claims - a.claims ||
        (b.year ?? -1) - (a.year ?? -1) ||
        (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0),
    )
    .slice(0, GOLD_SOURCE_COUNT);
  const claims = sources.reduce((n, s) => n + s.claims, 0);
  return {
    sources,
    claims,
    enough: sources.length === GOLD_SOURCE_COUNT && claims >= GOLD_MIN_CLAIMS,
  };
}

export class GoldSetInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoldSetInputError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseFreezeInput(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.sourceIds))
    throw new GoldSetInputError("BAD_BODY", "sourceIds: a list is required");
  const ids = body.sourceIds;
  if (
    !ids.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 64,
    )
  )
    throw new GoldSetInputError("BAD_SOURCE_ID", "a source id is malformed");
  if (new Set(ids).size !== ids.length)
    throw new GoldSetInputError("DUPLICATE_SOURCE", "a source is listed twice");
  if (ids.length !== GOLD_SOURCE_COUNT)
    throw new GoldSetInputError(
      "SOURCE_COUNT",
      `the gold set takes exactly ${GOLD_SOURCE_COUNT} sources`,
    );
  return ids as string[];
}

export interface MissedClaimInput {
  text: string;
  locator: string | null;
}

export function parseMissedClaim(body: unknown): MissedClaimInput {
  const text =
    isRecord(body) && typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_MISSED_TEXT)
    throw new GoldSetInputError(
      "MISSED_TEXT",
      `a missed claim needs its text (at most ${MAX_MISSED_TEXT} characters)`,
    );
  const raw = isRecord(body) ? body.locator : undefined;
  if (raw !== undefined && raw !== null && typeof raw !== "string")
    throw new GoldSetInputError("MISSED_LOCATOR", "locator: text or nothing");
  const locator = typeof raw === "string" ? raw.trim() : "";
  if (locator.length > MAX_MISSED_LOCATOR)
    throw new GoldSetInputError(
      "MISSED_LOCATOR",
      `locator: at most ${MAX_MISSED_LOCATOR} characters`,
    );
  return { text, locator: locator || null };
}

export function parseCompleteness(body: unknown): boolean {
  if (!isRecord(body) || typeof body.checked !== "boolean")
    throw new GoldSetInputError("BAD_BODY", "checked: true or false");
  return body.checked;
}
