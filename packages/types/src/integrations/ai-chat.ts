/**
 * How an answer from the internal AI test surface may be judged.
 *
 * TWO axes, not one list, and they never mix. An answer can be factually
 * right and written in unreadable Hungarian, or fluent and wrong; folded into
 * one set of buttons those two collapse into each other, and telling them
 * apart is what the measurement is for.
 *
 * These lists are shared by the three places that would otherwise keep their
 * own: the buttons on the screen, the validation on this API, and - through
 * the request body - the CHECK constraint in the AI service's database. A
 * value added to one copy and not the others fails at the moment somebody
 * presses it, with a constraint violation nobody expected.
 *
 * The Hungarian labels stay on the surface, because they are wording rather
 * than vocabulary and nothing outside the screen needs them.
 */
export const AI_RATING_AXES = ["accuracy", "language"] as const;

export type AiRatingAxis = (typeof AI_RATING_AXES)[number];

/** What was judged about the FACTS. */
export const AI_ACCURACY_RATINGS = [
  "correct",
  "inaccurate",
  "dangerous",
  "no-data",
] as const;

/**
 * What was judged about the WORDING.
 *
 * Same shape as the accuracy set, because it is used the same way - one
 * click, no deliberation: one good value and three kinds of failure, one of
 * them heavier than the others. `confusing` is the wording equivalent of
 * `dangerous`: the other three are unpleasant, that one turns a factually
 * correct answer into a wrong action.
 */
export const AI_LANGUAGE_RATINGS = [
  "natural",
  "wordy",
  "foreign",
  "confusing",
] as const;

export const AI_RATINGS_BY_AXIS = {
  accuracy: AI_ACCURACY_RATINGS,
  language: AI_LANGUAGE_RATINGS,
} as const satisfies Record<AiRatingAxis, readonly string[]>;

export type AiAccuracyRating = (typeof AI_ACCURACY_RATINGS)[number];
export type AiLanguageRating = (typeof AI_LANGUAGE_RATINGS)[number];
export type AiAnswerRating = AiAccuracyRating | AiLanguageRating;

/** What the OS reports back after a judgement was sent to the AI service. */
export interface AiAnswerRatingResult {
  /** Which axis this judgement was about, straight from the AI service. */
  axis: AiRatingAxis | null;
  /** The stored value, straight from the AI service, or null when it failed. */
  rating: AiAnswerRating | null;
  /** When the AI service recorded it. */
  ratedAt: string | null;
  /** Our code or the AI's, and null when nothing went wrong. */
  errorCode: string | null;
}
