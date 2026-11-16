/**
 * A MEGRENDELŐLAP TÉTELENKÉNTI DARAB- ÉS ALKALOMSZÁMA (Luca, 2026-11-13: „pontosan hány db és hány alkalom
 * számot szeretnék áthúzni a megrendelőbe"). A felhasználó tételenként megadja mindkettőt; ami érintetlen, az
 * eddigi érték marad: a szerződés darabszáma és egy alkalom. A szerver ugyanezt ellenőrzi (a keretet is), ez a
 * gomb-tiltás megelőzi a felesleges hibát.
 */
export type OrderLineDraft = { quantity: string; occasions: string };

type ItemLike = { quantity: string; occasionsPerYear: number | null };

/** a darabszámot a szerver `Decimal`-ja hat tizedesen adja ("1.000000"): a felületen a záró nullák nélkül */
function plainQuantity(value: string): string {
  return /^\d+\.\d+$/.test(value) ? value.replace(/\.?0+$/, "") : value;
}

export function defaultOrderLine(
  item: Pick<ItemLike, "quantity">,
): OrderLineDraft {
  return { quantity: plainQuantity(item.quantity), occasions: "1" };
}

/** `null`, ha rendben; különben egy mondat, hogy mi a baj. */
export function orderLineProblem(
  draft: OrderLineDraft,
  item: Pick<ItemLike, "occasionsPerYear">,
): string | null {
  const quantity = draft.quantity.trim();
  if (
    !/^\d+([.,]\d+)?$/.test(quantity) ||
    Number(quantity.replace(",", ".")) <= 0
  )
    return "a darabszám pozitív szám legyen";
  const occasions = draft.occasions.trim();
  if (!/^\d+$/.test(occasions) || Number(occasions) < 1)
    return "az alkalom egész szám, legalább 1";
  if (
    item.occasionsPerYear !== null &&
    Number(occasions) > item.occasionsPerYear
  )
    return `az alkalom legfeljebb ${item.occasionsPerYear} lehet (az évi keret)`;
  return null;
}

export function orderLinePayload(itemId: string, draft: OrderLineDraft) {
  return {
    itemId,
    quantity: draft.quantity.trim().replace(",", "."),
    occasions: Number(draft.occasions.trim()),
  };
}
