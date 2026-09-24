/**
 * KARBANTARTÓ AVATAR -- KEZDŐBETŰK ÉS SZÍN, A SZERVER ADATÁBÓL SZÁRMAZTATVA.
 *
 * A szerver nem ad színt a karbantartóhoz (`AquariumMaintainer` csak
 * `userId`/`displayName`-t visel), a Figma-terv (make-2, mobil szekció)
 * viszont színes köröket kér a kezdőbetűkkel. A szín a `userId`-ból
 * DETERMINISZTIKUSAN származik, hogy ugyanaz a kolléga mindig ugyanazt a
 * kört kapja, akárhány akváriumon szerepel, és a lista újratöltése se
 * változtassa meg alóla.
 */

const AVATAR_PALETTE = [
  "#177b74",
  "#2b657d",
  "#5a4fae",
  "#a3673d",
  "#4f7a3c",
  "#8a4a6b",
] as const;

export function initialsFor(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}
