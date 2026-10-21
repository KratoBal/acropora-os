/**
 * THE RETIRED `powerConsumption` KEY, FOLDED INTO THE ORIGINAL ENTRY (acrobot's
 * decision, 2026-10-21, kanban 541e2716).
 *
 * Until 2026-10-21 the clients sent the consumption as a normalized kW number
 * ("0.75"). That field is gone; the text the migration moved into
 * `powerConsumptionRaw` carries the same value as "0,75 kW". An old mobile
 * build, or an offline write queued before the update, still sends the old
 * key. Dropping it silently would lose the entry, and rejecting it would leave
 * the queued write stuck (the global pipe forbids unknown keys), so the server
 * folds it in the SAME Hungarian form the migration writes, and only where the
 * original entry is empty: a filled entry always wins.
 *
 * Anything that is not a plain decimal number is ignored, never guessed at.
 */
export function legacyPowerConsumptionToRaw(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d+([.,]\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return `${whole}${trimmedFraction === "" ? "" : `,${trimmedFraction}`} kW`;
}

/** The original entry the write ends up with: the request's own, else the legacy one. */
export function rawWithLegacyFallback(
  requested: string | null | undefined,
  current: string | null | undefined,
  legacyRaw: string | null,
): string | null | undefined {
  if (legacyRaw === null) return requested;
  const effective =
    requested === undefined ? (current?.trim() ?? "") : requested;
  return effective ? requested : legacyRaw;
}
