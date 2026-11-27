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
 *
 * ALTERNATÍVÁK (Luca 2026-11-27): egy tételt TÖBB opcionális is kiválthat, de ezek KIZÁRJÁK egymást: amit az ügyfél bejelöl, az számít, a többi
 * nem (`conflictingChoices` őrzi, hogy egy elfogadásban legfeljebb egy legyen közülük). Ezért az „összes opció kiválasztva" összeg sem az összes
 * alternatívát adja, hanem csoportonként a legdrágábbat (`allOptionsSelection`): ennél többet egy ügyfél nem fizethet.
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

/**
 * Az alternatívák: egy tételt kiváltó opcionális tételek azonosítói, a kiváltott tétel azonosítója szerint, a lista sorrendjében. Csak az olyan
 * csoport érdekes, amelyben legalább KETTŐ van (egyetlen kiváltó nem alternatíva, hanem egy sima kiváltás).
 */
export function alternativeGroups(
  items: readonly AcceptableItem[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    if (!item.isOptional || !item.replacesItemId) continue;
    const group = groups.get(item.replacesItemId) ?? [];
    group.push(item.id);
    groups.set(item.replacesItemId, group);
  }
  for (const [replaced, group] of groups)
    if (group.length < 2) groups.delete(replaced);
  return groups;
}

/**
 * A kiválasztásban egyszerre szereplő alternatívák: minden olyan csoport, amelyből KETTŐ vagy több van kiválasztva, a kiváltott tétel
 * azonosítójával és a kiválasztott opciók azonosítóival. Üres: nincs ütközés.
 */
export function conflictingChoices(
  items: readonly AcceptableItem[],
  selected: ReadonlySet<string> | readonly string[],
): { replacedItemId: string; chosenItemIds: string[] }[] {
  const chosen = selected instanceof Set ? selected : new Set(selected);
  const conflicts: { replacedItemId: string; chosenItemIds: string[] }[] = [];
  for (const [replacedItemId, group] of alternativeGroups(items)) {
    const picked = group.filter((id) => chosen.has(id));
    if (picked.length > 1)
      conflicts.push({ replacedItemId, chosenItemIds: picked });
  }
  return conflicts;
}

/**
 * Az „összes opció kiválasztva" kiválasztás, az alternatívák kizárását betartva: minden önálló opció (és az egyetlen kiváltó is), az alternatívák
 * csoportjából pedig a LEGDRÁGÁBB (`dearer(a, b)`: igaz, ha `a` drágább `b`-nél; egyenlőnél a lista sorrendjében az első marad).
 */
export function allOptionsSelection<T extends AcceptableItem>(
  items: readonly T[],
  dearer: (a: T, b: T) => boolean,
): string[] {
  const groups = alternativeGroups(items);
  const best = new Map<string, T>();
  for (const item of items) {
    if (!item.isOptional || !item.replacesItemId) continue;
    if (!groups.has(item.replacesItemId)) continue;
    const current = best.get(item.replacesItemId);
    if (!current || dearer(item, current)) best.set(item.replacesItemId, item);
  }
  const picked = new Set([...best.values()].map((item) => item.id));
  return items
    .filter(
      (item) =>
        item.isOptional &&
        (!item.replacesItemId ||
          !groups.has(item.replacesItemId) ||
          picked.has(item.id)),
    )
    .map((item) => item.id);
}

/**
 * Az ütközés mondata az ügyfélnek vagy a rögzítőnek: melyik tétel helyett kell egyet választani, és mik közül. Üres ütközésre `null`.
 */
export function conflictSentence(
  items: readonly (AcceptableItem & { name: string })[],
  conflicts: ReturnType<typeof conflictingChoices>,
): string | null {
  const first = conflicts[0];
  if (!first) return null;
  const nameOf = (id: string) => items.find((item) => item.id === id)?.name;
  const options = first.chosenItemIds
    .map((id) => `„${nameOf(id) ?? "?"}”`)
    .join(", ");
  return `„${nameOf(first.replacedItemId) ?? "?"}” helyett csak egy opciót választhatsz, ezek közül egyet: ${options}.`;
}
