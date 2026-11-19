/**
 * A KARBANTARTÁSI LAP CÍME A SZERZŐDÉSBŐL ÁTHÚZVA (Luca, 2026-11-19, kártya 17e6fcf2).
 *
 * Eddig a lap a szerződés címét kapta, tehát minden átvont lapot ugyanúgy hívtak. Luca tételenként
 * húz át, és a tétel megnevezése már azonosít (a lap dátumával együtt): „Cápasuli nagymedence (690m3)
 * gépészet (összesített egységár)". A szabály:
 *  - a hívó KIFEJEZETT címe (az űrlapon beírt) mindig előbb áll, azt nem írjuk felül;
 *  - egy tételnél a cím a tétel megnevezése;
 *  - több tételnél az első tétel megnevezése és „és még N tétel" (a sorrend a szerződés sorrendje);
 *  - tételenként külön laposnál minden lap a SAJÁT tételét viseli.
 * A LÉTEZŐ LAPOK CÍMÉT ez nem érinti: csak az új létrehozás hívja.
 */
export const CONTRACT_JOB_TITLE_MAX = 300;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Egy lap címe a kijelölt tételekből (legalább egy tétel). */
export function contractJobTitle(input: {
  explicit: string | null | undefined;
  contractTitle: string;
  items: readonly { description: string }[];
}): string {
  const explicit = input.explicit?.trim();
  if (explicit) return clip(explicit, CONTRACT_JOB_TITLE_MAX);
  const names = input.items
    .map((item) => item.description.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0)
    return clip(input.contractTitle, CONTRACT_JOB_TITLE_MAX);
  if (names.length === 1) return clip(names[0]!, CONTRACT_JOB_TITLE_MAX);
  const suffix = ` és még ${names.length - 1} tétel`;
  return `${clip(names[0]!, CONTRACT_JOB_TITLE_MAX - suffix.length)}${suffix}`;
}

/** A külön lapok címe: a hívó kifejezett címe után a tétel megnevezése, egyébként csak az. */
export function separateContractJobTitle(input: {
  explicit: string | null | undefined;
  contractTitle: string;
  item: { description: string };
}): string {
  const explicit = input.explicit?.trim();
  if (!explicit) return contractJobTitle({ ...input, items: [input.item] });
  return clip(`${explicit}: ${input.item.description}`, CONTRACT_JOB_TITLE_MAX);
}
