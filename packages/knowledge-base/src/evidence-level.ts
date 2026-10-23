/**
 * THE EVIDENCE-LEVEL RULE TABLE (plan v4, section 6 `EvidenceQuality` and 7a).
 *
 * The level of a claim is DERIVED from recorded facts about its sources,
 * never estimated by a model and never stored: a stored level could drift
 * from the evidence it summarises. The level decides which certainty verbs a
 * sentence may use about the claim (`compare.ts`, the strength row).
 *
 * The table, in order:
 *
 *   1. Each supporting source gets a DESIGN TIER from its study type:
 *        CONTROLLED_LAB, MESOCOSM, FIELD_EXPERIMENT, META_ANALYSIS
 *            -> SINGLE_EXPERIMENT, but only with a control (`controlled`
 *               true) AND at least MIN_REPLICATES replicate units; otherwise
 *               OBSERVATIONAL (an experiment without a control, or on too few
 *               units, is an observation)
 *        FIELD_OBSERVATIONAL, AQUARIUM_SURVEY, OWN_MEASUREMENT
 *            -> OBSERVATIONAL
 *        AQUARIUM_CASE, MANUFACTURER, REVIEW, MODELLING
 *            -> SINGLE_REPORT (a narrative review restates others' results;
 *               it is not new evidence; a model or simulation computes an
 *               outcome from assumptions, it observes none: acrobot 35808)
 *      A source without a study type is unclassified and counts for nothing.
 *   2. The claim takes the best tier among its supporting sources.
 *   3. Two or more DISTINCT sources at SINGLE_EXPERIMENT, with no
 *      contradicting source, raise it to CONSISTENT_EXPERIMENTS.
 *   4. Any contradicting source caps it at OBSERVATIONAL.
 *
 * Two properties are deliberate and tested (open question "condition 4" of
 * the handoff, the overconfidence and method-bias check):
 *   - MONOTONE: weakening the evidence (dropping a control, fewer replicates,
 *     one fewer supporting source, one more contradicting source) never
 *     raises the level.
 *   - DESIGN CAP: agreement can only lift controlled experiments. No number
 *     of observational or anecdotal sources reaches an experimental level, so
 *     a large survey cannot buy the verbs of a controlled experiment.
 *
 * Whether the TIER ASSIGNMENT matches an editor's judgement is an empirical
 * question this table cannot answer about itself; it is measured in slice S7
 * against the editor's classification of the pilot sources.
 */

export const EVIDENCE_RULES_VERSION = "evidence-rules-v0-draft";

/** Weakest first. The order is the comparison used everywhere. */
export const EVIDENCE_LEVELS = [
  "SINGLE_REPORT",
  "OBSERVATIONAL",
  "SINGLE_EXPERIMENT",
  "CONSISTENT_EXPERIMENTS",
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export function levelRank(level: EvidenceLevel): number {
  return EVIDENCE_LEVELS.indexOf(level);
}

/** Matches the Prisma enum `KnowledgeStudyType`. */
export const STUDY_TYPES = [
  "CONTROLLED_LAB",
  "MESOCOSM",
  "FIELD_EXPERIMENT",
  "FIELD_OBSERVATIONAL",
  "AQUARIUM_CASE",
  "AQUARIUM_SURVEY",
  "REVIEW",
  "META_ANALYSIS",
  "MANUFACTURER",
  "OWN_MEASUREMENT",
  "MODELLING",
] as const;
export type StudyType = (typeof STUDY_TYPES)[number];

/** Replicate units (colonies, tanks, sites) a controlled experiment needs to count as one. */
export const MIN_REPLICATES = 3;

const EXPERIMENTAL: ReadonlySet<StudyType> = new Set([
  "CONTROLLED_LAB",
  "MESOCOSM",
  "FIELD_EXPERIMENT",
  "META_ANALYSIS",
]);
const OBSERVATIONAL: ReadonlySet<StudyType> = new Set([
  "FIELD_OBSERVATIONAL",
  "AQUARIUM_SURVEY",
  "OWN_MEASUREMENT",
]);

export interface EvidenceItem {
  /** The source the evidence comes from: two rows of one source are one source. */
  sourceId: string;
  studyType: StudyType | null;
  controlled: boolean | null;
  /** Replicate units; null when the source does not report it. */
  sampleSize: number | null;
}

export interface EvidenceLevelInput {
  supporting: readonly EvidenceItem[];
  /** Distinct sources that contradict the claim (see `computeAgreement`). */
  contradictingSources: number;
}

export interface EvidenceLevelResult {
  /** null: no classified supporting source, so the claim cannot be stated at all. */
  level: EvidenceLevel | null;
  /** Which rules fired, in table order, for the editor and the audit trail. */
  reasons: string[];
  rulesVersion: string;
}

/** Rule 1: the design tier of one source, or null when unclassified. */
export function designTier(item: EvidenceItem): EvidenceLevel | null {
  if (item.studyType === null) return null;
  if (EXPERIMENTAL.has(item.studyType)) {
    const adequate =
      item.controlled === true &&
      item.sampleSize !== null &&
      item.sampleSize >= MIN_REPLICATES;
    return adequate ? "SINGLE_EXPERIMENT" : "OBSERVATIONAL";
  }
  if (OBSERVATIONAL.has(item.studyType)) return "OBSERVATIONAL";
  return "SINGLE_REPORT";
}

export function deriveEvidenceLevel(
  input: EvidenceLevelInput,
): EvidenceLevelResult {
  const reasons: string[] = [];
  // A source's best row stands for the source (rule 1 per source, not per row).
  const bySource = new Map<string, EvidenceLevel>();
  for (const item of input.supporting) {
    const tier = designTier(item);
    if (tier === null) {
      reasons.push(`unclassified source ${item.sourceId} ignored`);
      continue;
    }
    const prior = bySource.get(item.sourceId);
    if (prior === undefined || levelRank(tier) > levelRank(prior))
      bySource.set(item.sourceId, tier);
  }
  if (bySource.size === 0) {
    reasons.push("no classified supporting source");
    return { level: null, reasons, rulesVersion: EVIDENCE_RULES_VERSION };
  }

  let level: EvidenceLevel = "SINGLE_REPORT";
  for (const tier of bySource.values())
    if (levelRank(tier) > levelRank(level)) level = tier;
  reasons.push(`best design tier ${level} over ${bySource.size} source(s)`);

  const experiments = [...bySource.values()].filter(
    (t) => t === "SINGLE_EXPERIMENT",
  ).length;
  if (
    level === "SINGLE_EXPERIMENT" &&
    experiments >= 2 &&
    input.contradictingSources === 0
  ) {
    level = "CONSISTENT_EXPERIMENTS";
    reasons.push(`${experiments} independent controlled experiments agree`);
  }

  if (
    input.contradictingSources > 0 &&
    levelRank(level) > levelRank("OBSERVATIONAL")
  ) {
    level = "OBSERVATIONAL";
    reasons.push(
      `${input.contradictingSources} contradicting source(s): capped at OBSERVATIONAL`,
    );
  }

  return { level, reasons, rulesVersion: EVIDENCE_RULES_VERSION };
}

export interface StanceRow {
  sourceId: string;
  stance: "SUPPORTS" | "CONTRADICTS" | "QUALIFIES";
}

/**
 * The `agreement` of plan section 6, computed and never stored: distinct
 * supporting and contradicting sources. A contradiction comes from a
 * CONTRADICTS evidence row of the claim itself, or from the supporting
 * sources of a claim linked by a CONTRADICTS relation. A source that appears
 * on both sides counts on both: the conflict is the editor's to resolve, not
 * this function's. QUALIFIES counts on neither side.
 */
export function computeAgreement(
  evidence: readonly StanceRow[],
  contradictingClaimSources: readonly string[] = [],
): { supportingSources: number; contradictingSources: number } {
  const supporting = new Set<string>();
  const contradicting = new Set<string>(contradictingClaimSources);
  for (const row of evidence) {
    if (row.stance === "SUPPORTS") supporting.add(row.sourceId);
    else if (row.stance === "CONTRADICTS") contradicting.add(row.sourceId);
  }
  return {
    supportingSources: supporting.size,
    contradictingSources: contradicting.size,
  };
}
