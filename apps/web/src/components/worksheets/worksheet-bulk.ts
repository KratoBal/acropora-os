/**
 * A MUNKALAP-LISTA TÖBBES KIJELÖLÉSE (kártya a785e580, 2. szelet). Tiszta segédek: a kijelölés változtatása és
 * a művelet után kimondott összefoglaló. A kijelölés azonosítók halmaza, ezért a lapozás és a szűrés között
 * is megmarad; a kimondott szöveg a kihagyott lapokat sorszámmal nevezi meg.
 */
export const BULK_SELECTION_MAX = 50;

/** Egy lap ki-be kapcsolása; az 50. fölé nem megy. A másodikként visszaadott `full` jelzi, ha a határ megállított. */
export function toggleSelected(
  selected: ReadonlySet<string>,
  id: string,
): { selected: Set<string>; full: boolean } {
  const next = new Set(selected);
  if (next.delete(id)) return { selected: next, full: false };
  if (next.size >= BULK_SELECTION_MAX) return { selected: next, full: true };
  next.add(id);
  return { selected: next, full: false };
}

/**
 * Az oldal lapjainak mind kijelölése, vagy ha már mind ki van jelölve, mind törlése az oldalról. Az 50-es határig
 * a sorrendben előrébb állók kerülnek be.
 */
export function togglePage(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): { selected: Set<string>; full: boolean } {
  const next = new Set(selected);
  if (pageIds.length > 0 && pageIds.every((id) => next.has(id))) {
    for (const id of pageIds) next.delete(id);
    return { selected: next, full: false };
  }
  let full = false;
  for (const id of pageIds) {
    if (next.has(id)) continue;
    if (next.size >= BULK_SELECTION_MAX) {
      full = true;
      break;
    }
    next.add(id);
  }
  return { selected: next, full };
}

export type PageSelection = "none" | "some" | "all";

export function pageSelection(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): PageSelection {
  const count = pageIds.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === pageIds.length ? "all" : "some";
}

/** A művelet után kimondott mondat: hány lap ment a fájlba, és melyik maradt ki (és miért). */
export function bulkSummary(input: {
  action: "download" | "print";
  included: number;
  skipped: number;
  skippedNumbers: readonly string[];
}): string {
  const head =
    input.action === "download"
      ? `A zip ${input.included} munkalap PDF-jét tartalmazza.`
      : `A nyomtatható PDF ${input.included} munkalapot tartalmaz.`;
  if (input.skipped === 0) return head;
  const named = input.skippedNumbers.join(", ");
  const unnamed = input.skipped - input.skippedNumbers.length;
  const who = [named, unnamed > 0 ? `${unnamed} sorszám nélküli` : ""]
    .filter(Boolean)
    .join(" és ");
  return `${head} ${input.skipped} lapnak még nincs kiadott PDF-je, kimaradt: ${who}.`;
}
