/**
 * THE CHRISTMAS GIVEAWAY'S RULES, AS PURE FUNCTIONS (card 31445d0f; Balázs, 2026-11-05; brief
 * exchange/jatek/brief-2026-11-05.md). The api decides correctness with these, the OS admin draws with these, and a draw
 * run again with the same seed and the same candidates picks the same winner, so it can be shown live on screen. No
 * Node or browser API: the package runs in both.
 */

export const GAME_QUESTION_TYPES = ["TEXT", "CHOICE"] as const;
export type GameQuestionType = (typeof GAME_QUESTION_TYPES)[number];

export interface GameOption {
  id: string;
  label: string;
}

/**
 * A free-text answer as it is compared (Balázs: case, accents and spaces do not matter): lower case, the Hungarian
 * and other Latin accents taken off (`ő` → `o`), every whitespace and punctuation mark removed.
 */
export function normalizeGameAnswer(answer: string): string {
  return answer
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Whether an answer is one of the accepted ones. TEXT: compared normalized, against every accepted answer. CHOICE: the
 * chosen option's id, exactly. An empty accepted list accepts nothing (a question not set up yet draws no one).
 */
export function isGameAnswerCorrect(
  type: GameQuestionType,
  answer: string,
  accepted: readonly string[],
): boolean {
  if (type === "CHOICE") return accepted.includes(answer);
  const given = normalizeGameAnswer(answer);
  return (
    given.length > 0 &&
    accepted.some((one) => normalizeGameAnswer(one) === given)
  );
}

/** A plain e-mail check for the form; the address is stored trimmed and in lower case. */
export function normalizeGameEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
    ? value
    : null;
}

export interface GameDrawCandidate {
  email: string;
  /** weekly: 1; Christmas: the weeks with a confirmed, correct entry */
  weight: number;
}

/** A 32-bit hash of a string (xmur3): the seed of the generator. */
function seedOf(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** One number in [0, 1) from a seed (mulberry32): the same seed gives the same number everywhere. */
function unitOf(seed: string): number {
  let t = (seedOf(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * THE DRAW: one winner from the candidates, each as many times in the hat as its weight. The candidates are put in
 * order by e-mail first, so the order they came from the database in does not matter; then the seed picks a point on
 * the line of their weights. Same seed, same candidates: same winner. Null when there is no one with a weight.
 */
export function drawGameWinner(
  candidates: readonly GameDrawCandidate[],
  seed: string,
): { winner: GameDrawCandidate; ticket: number; tickets: number } | null {
  const sorted = candidates
    .filter((c) => Number.isInteger(c.weight) && c.weight > 0)
    .slice()
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  const tickets = sorted.reduce((sum, c) => sum + c.weight, 0);
  if (tickets === 0) return null;
  const ticket = Math.floor(unitOf(seed) * tickets);
  let reached = 0;
  for (const candidate of sorted) {
    reached += candidate.weight;
    if (ticket < reached) return { winner: candidate, ticket, tickets };
  }
  return null;
}

/**
 * The Christmas draw's candidates: every e-mail with a confirmed, correct entry, weighted by the number of weeks it has
 * one in (Balázs: who plays more weeks is in the Christmas draw more times).
 */
export function christmasCandidates(
  entries: readonly { email: string; questionId: string }[],
): GameDrawCandidate[] {
  const weeks = new Map<string, Set<string>>();
  for (const entry of entries)
    weeks.set(
      entry.email,
      (weeks.get(entry.email) ?? new Set()).add(entry.questionId),
    );
  return [...weeks].map(([email, set]) => ({ email, weight: set.size }));
}
