/**
 * What a save does to the partner's abbreviation. The decision is here rather
 * than inside the transaction because the transaction needs a database and the
 * unit gate keeps those runs out of `pnpm test` -- and this is the part that
 * decides whether a code may move at all.
 *
 * The three inputs are not two: `undefined` means the field was left out of the
 * request and the stored value stands, `null` means "clear it", and a string
 * means "make it this". Collapsing the first two would clear a code on every
 * save that did not mention it.
 */
export type PartnerCodeChange = "unchanged" | "set" | "changed" | "cleared";

export function partnerCodeChange(
  current: string | null,
  next: string | null | undefined,
): PartnerCodeChange {
  if (next === undefined) return "unchanged";
  const wanted = next === null ? null : next.trim();
  if ((wanted ?? null) === (current ?? null)) return "unchanged";
  if (wanted === null || wanted === "")
    return current ? "cleared" : "unchanged";
  return current ? "changed" : "set";
}
