/**
 * How an answer from the internal AI test surface may be judged.
 *
 * One list, shared by the three places that would otherwise keep their own:
 * the buttons on the screen, the validation on the API, and - through the
 * request body - the CHECK constraint in the AI service's database. A value
 * added to one copy and not the others fails at the moment somebody presses
 * it, with a constraint violation nobody expected.
 *
 * The Hungarian labels stay on the surface, because they are wording rather
 * than vocabulary and nothing outside the screen needs them.
 */
export const AI_ANSWER_RATINGS = [
  "correct",
  "inaccurate",
  "dangerous",
  "no-data",
] as const;

export type AiAnswerRating = (typeof AI_ANSWER_RATINGS)[number];

/** What the OS reports back after a judgement was sent to the AI service. */
export interface AiAnswerRatingResult {
  /** The stored value, straight from the AI service, or null when it failed. */
  rating: AiAnswerRating | null;
  /** When the AI service recorded it. */
  ratedAt: string | null;
  /** Our code or the AI's, and null when nothing went wrong. */
  errorCode: string | null;
}
