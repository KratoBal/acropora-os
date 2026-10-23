/**
 * THE KNOWLEDGE BASE'S OVERVIEW (research engine S4, "Áttekintő", Figma
 * K2d2lES872xzwQHCMVXtam 3:2): what waits for the editor ("Rád vár"), the
 * research project's counts, and where the research workflow stands (plan
 * v4, section 7: discovery, screening, extraction, checking, conclusion,
 * article).
 *
 * ONE PROJECT. There is no research-question model yet: the pilot has one
 * question (plan 9: phosphate in an SPS aquarium), so the card shows that
 * question with the whole knowledge base's counts. A second question needs
 * its own model and links (which sources, which runs) first; until then a
 * "new research question" button would have nothing behind it.
 *
 * Pure: the counts come in, the stages come out, the same way every time.
 */
export const PILOT_QUESTION = "Foszfát SPS-akváriumban";

export interface OverviewCounts {
  /** All sources, and how screening stands. */
  sources: number;
  sourcesPending: number;
  sourcesIncluded: number;
  /** Included sources an extraction ran on (their full-text hash is set). */
  sourcesExtracted: number;
  /** Claims by status. */
  claimsCandidate: number;
  claimsVerified: number;
  /** Field anchors waiting for the editor, and the open questions among them. */
  anchorsPending: number;
  questionsOpen: number;
  /** Claims built on a retracted work, still not DISPUTED or WITHDRAWN. */
  claimsOnRetracted: number;
}

export const STAGES = [
  "DISCOVERY",
  "SCREENING",
  "EXTRACTION",
  "CHECKING",
  "CONCLUSION",
  "ARTICLE",
] as const;
export type Stage = (typeof STAGES)[number];
export type StageState = "DONE" | "ACTIVE" | "TODO";

export interface Overview {
  question: string;
  waiting: { sourcesToScreen: number; claimsToCheck: number; problems: number };
  project: {
    sources: number;
    included: number;
    acceptedClaims: number;
    openChecks: number;
    /** The first stage not done: the card's badge. */
    stage: Stage;
  };
  stages: { key: Stage; state: StageState }[];
}

/**
 * A stage is DONE when its work has come through and nothing of it waits,
 * ACTIVE when some of it has happened or waits, TODO when it has not begun.
 * Conclusion and article have no screen yet: TODO, never guessed.
 */
export function overviewOf(c: OverviewCounts): Overview {
  const problems = c.questionsOpen + c.claimsOnRetracted;
  const state: Record<Stage, StageState> = {
    DISCOVERY: c.sources > 0 ? "DONE" : "TODO",
    SCREENING:
      c.sources === 0
        ? "TODO"
        : c.sourcesPending === 0
          ? "DONE"
          : c.sourcesPending < c.sources
            ? "ACTIVE"
            : "TODO",
    EXTRACTION:
      c.sourcesExtracted === 0
        ? "TODO"
        : c.sourcesExtracted >= c.sourcesIncluded && c.sourcesPending === 0
          ? "DONE"
          : "ACTIVE",
    CHECKING:
      c.claimsCandidate + c.claimsVerified === 0
        ? "TODO"
        : c.claimsCandidate === 0 && c.anchorsPending === 0
          ? "DONE"
          : "ACTIVE",
    CONCLUSION: "TODO",
    ARTICLE: "TODO",
  };
  const stage = STAGES.find((s) => state[s] !== "DONE") ?? "ARTICLE";
  return {
    question: PILOT_QUESTION,
    waiting: {
      sourcesToScreen: c.sourcesPending,
      claimsToCheck: c.claimsCandidate,
      problems,
    },
    project: {
      sources: c.sources,
      included: c.sourcesIncluded,
      acceptedClaims: c.claimsVerified,
      openChecks: problems,
      stage,
    },
    stages: STAGES.map((key) => ({ key, state: state[key] })),
  };
}
