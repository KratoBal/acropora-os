import { Prisma } from "@acropora/database";

import { acceptedItemIds, replacedItemIds } from "../quote-accepted-items.js";

/**
 * A NYILVÁNOS OLDAL VÉGÖSSZEGE EGY KIVÁLASZTÁSRA (Luca 2026-11-26, card 2540d9d4: kiváltott tétel). A számítás a SZERVEREN van, nem a böngészőben:
 * ugyanaz a döntés (`acceptedItemIds`), mint amit a megrendelés, a készlet-átadás, a díjbekérő és a számla használ, így az oldalon látott összeg és a
 * később számlázott összeg nem térhet el.
 */
export interface SelectableItem {
  id: string;
  isOptional: boolean;
  replacesItemId: string | null;
  quantity: Prisma.Decimal;
  unitNetPrice: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);
const net = (item: SelectableItem) => item.quantity.times(item.unitNetPrice);

export interface SelectionTotals {
  /** a beleszámító tételek nettó összege */
  net: Prisma.Decimal;
  /** a kiváltott (a kiválasztott opcionális által kiszorított) tételek helye a listában (a lista sorrendje stabil) */
  replacedIndexes: number[];
  /** a kiválasztott opcionális tételek helye a listában */
  chosenIndexes: number[];
}

export function selectionTotals(
  items: readonly SelectableItem[],
  selected: readonly string[],
): SelectionTotals {
  const accepted = acceptedItemIds(items, selected);
  const replaced = replacedItemIds(items, selected);
  let total = ZERO;
  const replacedIndexes: number[] = [];
  const chosenIndexes: number[] = [];
  items.forEach((item, index) => {
    if (accepted.has(item.id)) total = total.plus(net(item));
    if (replaced.has(item.id)) replacedIndexes.push(index);
    if (item.isOptional && accepted.has(item.id)) chosenIndexes.push(index);
  });
  return { net: total, replacedIndexes, chosenIndexes };
}

/** Az összes opcionális tétel kiválasztva: az "opcionális tételekkel együtt" összeg (a kiváltott tételek nélkül). */
export function withAllOptionals(
  items: readonly SelectableItem[],
): SelectionTotals {
  return selectionTotals(
    items,
    items.filter((item) => item.isOptional).map((item) => item.id),
  );
}
