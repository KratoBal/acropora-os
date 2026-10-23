/**
 * NAME-BASED PRODUCT SUGGESTIONS FOR PRICE LIST ROWS (task arlista-nev-javaslat).
 *
 * A price list row that no barcode and no known supplier code ties to one of our
 * products gets up to three candidates by its NAME. This is only ever a
 * SUGGESTION: a person approves or dismisses it, and nothing here writes.
 *
 * The suppliers write German or English names, ours are mostly Hungarian, so what
 * carries a match is the brand, the model words and the PACK SIZE, not the
 * prose. The rules are therefore strict on purpose (precision over recall):
 *
 *   - the BRAND must agree when both sides have one;
 *   - the PACK SIZE must agree when both sides name one (2 kg is not 500 g, and
 *     "2kg", "2 kg", "2000 g" are one size);
 *   - the words (brand and model included) must overlap by a Dice score of at
 *     least `MIN_SCORE`;
 *   - a candidate that names no size where the row does is allowed but loses
 *     `UNCONFIRMED_SIZE_PENALTY`: it cannot be told apart from another pack size.
 *
 * Nothing here knows the database: the caller passes the candidates in.
 */

export interface NameCandidate {
  variantId: string;
  /** The product (and variant) name as we write it. */
  name: string;
  brand: string | null;
}

export interface NameQuery {
  supplierSku: string;
  name: string | null;
  brand: string | null;
}

export interface NameSuggestion {
  supplierSku: string;
  variantId: string;
  /** Dice score of the words, 0..1, after the size penalty. */
  score: number;
  /** What the suggestion rests on, for the person who approves it. */
  basis: { commonWords: string[]; sizes: string[]; brand: string | null };
}

export const MIN_SCORE = 0.75;
export const MAX_SUGGESTIONS = 3;
const UNCONFIRMED_SIZE_PENALTY = 0.15;
/** A word that stands in more candidates than this does not narrow the search. */
const COMMON_WORD_LIMIT = 250;

const STOP_WORDS = new Set([
  "und",
  "mit",
  "von",
  "der",
  "die",
  "das",
  "fur",
  "for",
  "the",
  "and",
  "with",
  "pro",
  "set",
  "new",
  "neu",
  "kft",
  "gmbh",
  "ltd",
  "egy",
  "es",
  "az",
]);

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " ");
}

/** "2000g" -> g, "500ml" -> ml: a weight and a volume of the same product cannot be compared. */
function sizeUnit(size: string): "g" | "ml" {
  return size.endsWith("ml") ? "ml" : "g";
}

/** The sizes (grams, millilitres) a name states, canonical: "2 kg" and "2000g" are "2000g". */
export function sizesOf(name: string): string[] {
  const sizes = new Set<string>();
  const pattern =
    /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt|liter|litre|ltr)(?![a-z])/g;
  for (const match of plain(name).matchAll(pattern)) {
    const value = Number(match[1]!.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2]!;
    if (unit === "kg") sizes.add(`${Math.round(value * 1000)}g`);
    else if (unit === "g") sizes.add(`${Math.round(value)}g`);
    else if (unit === "ml") sizes.add(`${Math.round(value)}ml`);
    else sizes.add(`${Math.round(value * 1000)}ml`);
  }
  return [...sizes].sort();
}

/**
 * The informative words of a name: no sizes, no stop words. Short tokens STAY: a
 * single letter or digit is what tells "Component A" from "Component C" and
 * "Trace 1" from "Trace 2", and "dr" is half of a brand ("Dr. Bassleer").
 */
export function wordsOf(name: string): string[] {
  const text = plain(name).replace(
    /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lt|liter|litre|ltr)(?![a-z])/g,
    " ",
  );
  const words = text
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 1 && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

function brandKey(brand: string | null | undefined): string | null {
  const key = plain(brand ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return key || null;
}

function sameBrand(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

interface Prepared {
  candidate: NameCandidate;
  brand: string | null;
  words: Set<string>;
  /** Adjacent words written together ("rowa carbon" -> "rowacarbon"): for matching only. */
  compounds: Set<string>;
  sizes: string[];
}

/** Adjacent pairs of the words, joined: how a supplier writes "ROWAcarbon" where we write "Rowa Carbon". */
function compoundsOf(text: string): Set<string> {
  const tokens = plain(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i++)
    out.add(`${tokens[i]}${tokens[i + 1]}`);
  return out;
}

export interface NameIndex {
  byWord: Map<string, Prepared[]>;
}

export function buildNameIndex(
  candidates: readonly NameCandidate[],
): NameIndex {
  const byWord = new Map<string, Prepared[]>();
  for (const candidate of candidates) {
    const brand = brandKey(candidate.brand);
    const words = new Set([
      ...wordsOf(candidate.name),
      ...(brand ? wordsOf(brand) : []),
    ]);
    const prepared: Prepared = {
      candidate,
      brand,
      words,
      compounds: compoundsOf(candidate.name),
      sizes: sizesOf(candidate.name),
    };
    for (const word of words) {
      const list = byWord.get(word);
      if (list) list.push(prepared);
      else byWord.set(word, [prepared]);
    }
  }
  return { byWord };
}

export function suggestByName(
  index: NameIndex,
  query: NameQuery,
): NameSuggestion[] {
  const queryBrand = brandKey(query.brand);
  const queryWords = new Set([
    ...wordsOf(query.name ?? ""),
    ...(queryBrand ? wordsOf(queryBrand) : []),
  ]);
  if (queryWords.size < 2) return [];
  const querySizes = sizesOf(query.name ?? "");

  const seen = new Set<Prepared>();
  for (const word of queryWords) {
    const list = index.byWord.get(word);
    if (list && list.length <= COMMON_WORD_LIMIT)
      for (const prepared of list) seen.add(prepared);
  }

  const queryCompounds = compoundsOf(query.name ?? "");
  const suggestions: NameSuggestion[] = [];
  for (const prepared of seen) {
    if (!sameBrand(queryBrand, prepared.brand)) continue;
    // a size is a hard no only when both name one in the SAME unit and none agrees
    let sizePenalty = 0;
    if (querySizes.length > 0) {
      if (prepared.sizes.length === 0) sizePenalty = UNCONFIRMED_SIZE_PENALTY;
      else if (!querySizes.some((size) => prepared.sizes.includes(size))) {
        const comparable = querySizes.some((q) =>
          prepared.sizes.some((c) => sizeUnit(q) === sizeUnit(c)),
        );
        if (comparable) continue;
        sizePenalty = UNCONFIRMED_SIZE_PENALTY;
      }
    }
    const common = [...queryWords].filter(
      (word) =>
        prepared.words.has(word) ||
        prepared.compounds.has(word) ||
        queryCompounds.has(word),
    );
    // a compound of the supplier's two words stands for words of ours
    const matchedByCompound = [...queryCompounds].filter((compound) =>
      prepared.words.has(compound),
    );
    const matched = common.length + matchedByCompound.length;
    if (common.length < 2 && matched < 2) continue;
    // most of the supplier's words must be in our name (containment), and our
    // name must not be much longer than the match (dice); containment weighs more
    // because our names carry Hungarian prose the supplier's do not
    const containment = Math.min(1, matched / queryWords.size);
    const diceScore =
      (2 * Math.min(matched, prepared.words.size)) /
      (queryWords.size + prepared.words.size);
    const score = 0.7 * containment + 0.3 * diceScore - sizePenalty;
    if (score < MIN_SCORE) continue;
    suggestions.push({
      supplierSku: query.supplierSku,
      variantId: prepared.candidate.variantId,
      score: Math.round(score * 1000) / 1000,
      basis: {
        commonWords: [...common].sort(),
        sizes: querySizes.filter((size) => prepared.sizes.includes(size)),
        brand: queryBrand && prepared.brand ? queryBrand : null,
      },
    });
  }
  return suggestions
    .sort((a, b) => b.score - a.score || a.variantId.localeCompare(b.variantId))
    .slice(0, MAX_SUGGESTIONS);
}
