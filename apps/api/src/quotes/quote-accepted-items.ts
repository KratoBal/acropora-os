/**
 * AZ ELFOGADOTT TÉTELEK, EGY HELYEN (Luca 2026-11-26, card 2540d9d4: kiváltott tétel).
 *
 * Egy elfogadás a kiválasztott opcionális tételek azonosítóit tárolja. Hogy melyik tétel számít bele a megrendelésbe, a készlet-átadásba, a
 * díjbekérőbe és a számlába, EZ a függvény dönti el, mind a négy fogyasztónak ugyanazt:
 *
 *   - a kiválasztott opcionális tétel beleszámít;
 *   - a nem kiválasztott opcionális tétel nem;
 *   - a nem opcionális tétel beleszámít, KIVÉVE ha egy beleszámító opcionális tétel a helyére lép (`replacesItemId`).
 *
 * Kiváltás nélkül (minden régi elfogadás: a mező null) ez pontosan a régi szabály: nem opcionális VAGY kiválasztott.
 */
export interface AcceptableItem {
  id: string;
  isOptional: boolean;
  /** az a nem opcionális tétel, amelynek a helyére ez az opcionális tétel lép (null: kiegészítés) */
  replacesItemId: string | null;
}

/** A beleszámító tételek azonosítói. A `selected` olyan azonosítót is tartalmazhat, ami nem opcionális: az nem számít (a szerver máshol szűri). */
export function acceptedItemIds(
  items: readonly AcceptableItem[],
  selected: ReadonlySet<string> | readonly string[],
): Set<string> {
  const chosen = selected instanceof Set ? selected : new Set(selected);
  const replaced = replacedItemIds(items, chosen);
  const accepted = new Set<string>();
  for (const item of items) {
    if (item.isOptional ? chosen.has(item.id) : !replaced.has(item.id))
      accepted.add(item.id);
  }
  return accepted;
}

/** A kiváltott (a kiválasztott opcionális által a helyükről kiszorított) nem opcionális tételek azonosítói. */
export function replacedItemIds(
  items: readonly AcceptableItem[],
  selected: ReadonlySet<string> | readonly string[],
): Set<string> {
  const chosen = selected instanceof Set ? selected : new Set(selected);
  const replaced = new Set<string>();
  for (const item of items)
    if (item.isOptional && item.replacesItemId && chosen.has(item.id))
      replaced.add(item.replacesItemId);
  return replaced;
}
