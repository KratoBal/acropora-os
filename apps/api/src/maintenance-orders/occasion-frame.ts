/**
 * AZ ÉVES ALKALOMKERET MÉRCÉJE, ADATBÁZIS NÉLKÜL (a `reserveOccasions` ezt hívja a zár alatt, a számokat az
 * adatbázis adja). EGY ALKALOM A KERETBŐL EGYSZER FOGLALÓDIK (acrobot döntése, 2026-11-14 01:21): ha van
 * megrendelőlap, az foglal, és a belőle vagy ugyanarra a tételre indított munkalap a megrendelőlap foglalását
 * használja; ha nincs megrendelőlap, a munkalap foglal.
 */
export type OccasionUse = { orders: number; jobs: number };
export type OccasionRequestKind = "order" | "job";

/** A felhasználás: a két érték MAXIMUMA, nem az összege, mert a lapok a megrendelőlapok alkalmain ülnek. */
export const occasionsUsedOf = (use: OccasionUse | undefined): number =>
  Math.max(use?.orders ?? 0, use?.jobs ?? 0);

export type OccasionDecision =
  | { fits: true }
  | { fits: false; exhausted: true }
  | { fits: false; exhausted: false; remaining: number };

/**
 * BELEFÉR-E A KÉRT ALKALOM. A mérce a foglalás fajtájától függ:
 *   - "order" (megrendelőlap, alap): saját alkalmakat foglal, tehát a mostani felhasználáshoz hozzáadódik:
 *     `felhasznált + kért <= éves keret` (a régi mérce ugyanez egy alkalomra);
 *   - "job" (megrendelőlap nélküli lap): a tétel megrendelőlapjainak alkalmain ül, tehát csak az számít új
 *     foglalásnak, ami azokon túl van: `max(megrendelőlap, lapok + kért) <= éves keret`.
 * Az új megrendelőlap szándékosan NEM ül a már meglévő lapokon: a keret akkor is megvédi magát, ha előbb a lapok
 * vitték el, és csak utána jön a megrendelőlap. Az alkalom nélküli tételnek (`per` null) nincs kerete: mindig
 * túllépett.
 */
export function decideOccasionRequest(input: {
  use: OccasionUse | undefined;
  occasionsPerYear: number | null;
  requested?: number;
  kind?: OccasionRequestKind;
}): OccasionDecision {
  const per = input.occasionsPerYear ?? 0;
  const requested = input.requested ?? 1;
  const orders = input.use?.orders ?? 0;
  const jobs = input.use?.jobs ?? 0;
  const usedNow = occasionsUsedOf(input.use);
  const after =
    input.kind === "job"
      ? Math.max(orders, jobs + requested)
      : usedNow + requested;
  if (after <= per) return { fits: true };
  return usedNow >= per
    ? { fits: false, exhausted: true }
    : { fits: false, exhausted: false, remaining: per - usedNow };
}
