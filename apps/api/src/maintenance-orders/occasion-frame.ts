/**
 * AZ ÉVES ALKALOMKERET MÉRCÉJE, ADATBÁZIS NÉLKÜL (a `reserveOccasions` ezt hívja a zár alatt, a számokat az
 * adatbázis adja). A felhasználás ÖSSZEADÓ (acrobot döntése, 2026-11-14 01:42): a megrendelőlapok alkalmai plusz a
 * megrendelőlap NÉLKÜLI munkalapok alkalmai nem lehetnek több, mint a szerződéses tétel évi alkalomszáma. A
 * megrendelőlapból aláíráskor létrejövő EGY munkalap az egész megrendelőlap alkalmát fedi, és nem foglal külön
 * (a `ServiceJobContractItem` sorai csak a megrendelőlap nélküli lapoknak vannak); a szerződésből közvetlenül
 * indított munkalap új alkalom, és önmagát foglalja.
 */
export type OccasionUse = { orders: number; jobs: number };

/** A tételnek ebben az évben már elfoglalt alkalmai. */
export const occasionsUsedOf = (use: OccasionUse | undefined): number =>
  (use?.orders ?? 0) + (use?.jobs ?? 0);

export type OccasionDecision =
  | { fits: true }
  | { fits: false; exhausted: true }
  | { fits: false; exhausted: false; remaining: number };

/**
 * BELEFÉR-E A KÉRT ALKALOM: `felhasznált + kért <= éves keret`, megrendelőlapra és lapra egyaránt. A teljesen
 * elfogyott tétel és a csak részben beférő kérés külön ág, mert a hibaüzenet mást mond rájuk. Az alkalom nélküli
 * tételnek (`occasionsPerYear` null) nincs kerete: mindig túllépett.
 */
export function decideOccasionRequest(input: {
  use: OccasionUse | undefined;
  occasionsPerYear: number | null;
  requested?: number;
}): OccasionDecision {
  const per = input.occasionsPerYear ?? 0;
  const used = occasionsUsedOf(input.use);
  if (used + (input.requested ?? 1) <= per) return { fits: true };
  return used >= per
    ? { fits: false, exhausted: true }
    : { fits: false, exhausted: false, remaining: per - used };
}
