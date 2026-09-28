/**
 * BESZÁLLÍTÓI SZÁMLASOR -> JELÖLT TERMÉKEK, JEV NÉLKÜL (#1199 A-008 Stage A).
 *
 * A mért generátor (`stage-a-v3`, Python, `agents/nautilus/a008/stage_a.py`)
 * szabályról szabályra átírva. A `p3-final` policy ezen a jelöltlistán mért
 * (V0 HOLDOUT, P-023): élesben ugyanennek a listának kell a Jev elé kerülnie,
 * ezért a paritás a mérce, nem a "hasonló eredmény". A PR mérése: a P-023 120
 * és a V0 140 nevén a lista elemenként és sorrendben azonos a Pythonéval.
 *
 * BEMENET, és csak ez (PD-007 / ACD-015): a sor NEVE, a beszállító profilja,
 * és a cikkszám ELŐTAGJA, kizárólag a profil márka-routingján keresztül. A
 * teljes cikkszám, az EAN és bármilyen leképezés TILOS: a generátor soha nem
 * keres rá közvetlenül a válaszra.
 *
 *   1. márkaszavak: a profil routingja az előtag alapján, ha van találat;
 *      különben a név első szava (az első kettő, ha az első címszó, pl. "Dr.")
 *   2. készlet: a törzs azon változatai, amelyek nevében minden márkaszó benne
 *      van (vagy legalább 4 betűs előtag-viszonyban áll vele)
 *   3. pont: a közös névszavak száma, a készleten belül +1 a márka-egyezésért;
 *      a legalább MIN_SHARED pontosak, a legjobb elöl, legfeljebb K
 *   4. ha a márka sehol nem talál: az egész törzs, ugyanezzel a ponttal, bónusz
 *      nélkül
 *
 * Ami beszállítónként eltér (a routing és a márka-álnevek), az a beszállító
 * PROFILJÁBAN áll, a beszállító illesztő-fájljában. Itt semmi nem tud a
 * Hertleinről.
 */

export const CANDIDATE_GENERATOR_VERSION = "stage-a-v3";
export const CANDIDATE_LIMIT = 30;
export const CANDIDATE_MIN_SHARED = 1;

export interface CandidateProfile {
  /** Cikkszám-előtag -> márkaszavak. A minta a TELJES (kisbetűs) cikkszámra illeszkedik. */
  readonly brandRouting: readonly {
    readonly pattern: RegExp;
    readonly words: readonly string[];
  }[];
  /** Ha a márkaszavak tartalmazzák a `when` szavakat, ezek is márkának számítanak. */
  readonly brandAliases: readonly {
    readonly when: readonly string[];
    readonly alternatives: readonly (readonly string[])[];
  }[];
  /** Címszavak: utánuk a második szó is a márka része ("Dr. Bassleer"). */
  readonly titleWords?: readonly string[];
}

/** A törzs egy változata: az azonosítója és a teljes neve (termék + változat). */
export interface CandidateMasterRow {
  readonly variantId: string;
  readonly text: string;
}

export interface CandidateIndexEntry {
  readonly variantId: string;
  readonly tokens: ReadonlySet<string>;
}

export interface CandidateResult {
  readonly candidates: readonly string[];
  readonly brandSource: "routing" | "nev" | "nincs";
  readonly fallback: boolean;
}

/**
 * Python `fold`: NFKD, az ékezet-jelek el, `casefold`. A `casefold` a
 * `toLowerCase`-tól egy dologban tér el, ami a német szövegben számít: a
 * "ß" két betű lesz ("Größe" -> "grosse").
 */
export function foldCandidateText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss");
}

/**
 * A név szavai. A betű-szám határon is vág ("150W" -> 150, w; "myAqua1900" ->
 * myaqua, 1900), mert a törzs összeírja a mértékegységet, a beszállító nem.
 * Az egybetűs szó kiesik, a szám marad.
 */
export function candidateTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of foldCandidateText(text).match(/[a-z0-9]+/g) ?? [])
    for (const part of token.match(/[a-z]+|\d+/g) ?? [])
      if (part.length > 1 || /^\d+$/.test(part)) out.add(part);
  return out;
}

/** A törzs szavai egyszer, előre: a generátor soronként csak összevet. */
export function indexCandidateMaster(
  rows: readonly CandidateMasterRow[],
): CandidateIndexEntry[] {
  return rows.map((row) => ({
    variantId: row.variantId,
    tokens: candidateTokens(row.text),
  }));
}

function brandIn(
  words: ReadonlySet<string>,
  tokens: ReadonlySet<string>,
): boolean {
  for (const word of words) {
    let found = false;
    for (const token of tokens)
      if (
        word === token ||
        (token.length >= 4 && word.startsWith(token)) ||
        (word.length >= 4 && token.startsWith(word))
      ) {
        found = true;
        break;
      }
    if (!found) return false;
  }
  return true;
}

function brandWords(
  name: string,
  codeForRouting: string,
  profile: CandidateProfile,
): { words: Set<string>; source: CandidateResult["brandSource"] } {
  for (const route of profile.brandRouting)
    if (route.pattern.test(codeForRouting))
      return { words: new Set(route.words), source: "routing" };
  const nameWords = name.trim().split(/\s+/).filter(Boolean);
  if (nameWords.length === 0) return { words: new Set(), source: "nincs" };
  const first = new Set(
    foldCandidateText(nameWords[0]!).match(/[a-z0-9]+/g) ?? [],
  );
  const titles = profile.titleWords ?? ["dr"];
  if ([...first].some((word) => titles.includes(word)) && nameWords.length > 1)
    for (const word of foldCandidateText(nameWords[1]!).match(/[a-z0-9]+/g) ??
      [])
      first.add(word);
  return { words: first, source: "nev" };
}

/**
 * A jelöltlista egy számlasorhoz. A `codeForRouting` a beszállítói cikkszám
 * kisbetűs alakja, és KIZÁRÓLAG a profil routing-mintáin megy át.
 */
export function generateCandidates(
  name: string,
  codeForRouting: string,
  index: readonly CandidateIndexEntry[],
  profile: CandidateProfile,
): CandidateResult {
  const { words, source } = brandWords(name, codeForRouting, profile);
  const lineTokens = candidateTokens(name);
  const alternatives: ReadonlySet<string>[] = [words];
  for (const alias of profile.brandAliases)
    if (alias.when.every((word) => words.has(word)))
      for (const alternative of alias.alternatives)
        alternatives.push(new Set(alternative));

  let pool =
    words.size > 0
      ? index.filter((entry) =>
          alternatives.some((alternative) =>
            brandIn(alternative, entry.tokens),
          ),
        )
      : [];
  const fallback = pool.length === 0;
  if (fallback) pool = [...index];
  const bonus = fallback ? 0 : 1; // the brand match is evidence of its own

  const scored = pool.map((entry) => {
    let shared = 0;
    for (const token of lineTokens) if (entry.tokens.has(token)) shared += 1;
    return { score: shared + bonus, variantId: entry.variantId };
  });
  // best first; a tie goes by the variant id, in code-point order as Python compares
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.variantId < b.variantId
        ? -1
        : a.variantId > b.variantId
          ? 1
          : 0,
  );
  return {
    candidates: scored
      .filter((entry) => entry.score >= CANDIDATE_MIN_SHARED)
      .slice(0, CANDIDATE_LIMIT)
      .map((entry) => entry.variantId),
    brandSource: source,
    fallback,
  };
}
