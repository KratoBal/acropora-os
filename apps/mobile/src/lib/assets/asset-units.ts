/**
 * A KET FOGYASZTAS-MEZO EGYSEGE (Kelecsenyi Ferenc kerese, 2026-10-21, kanban
 * 541e2716): az adatlapon es a szerkeszton az ertek MELLETT all. Az Aramfelvetel
 * AMPERBEN van, a "Fogyasztas (eredeti bejegyzes)" KILOWATTBAN.
 *
 * A MOBIL A KOZOS CSOMAGOT NEM IMPORTALHATJA (a pnpm workspace-en kivul all),
 * tehat ez kezzel karbantartott masolat a `packages/types` `withAssetUnit`
 * fuggvenyerol; a ket egyseg egyezeset az `asset-units.spec.ts` forrasszoveg-
 * olvasassal vedi, a viselkedest ugyanazok az esetek mérik mindket oldalon.
 */
export const ASSET_CURRENT_DRAW_UNIT = "A";
export const ASSET_POWER_CONSUMPTION_UNIT = "kW";

/**
 * Az ertek egyseggel, MEGJELENITESRE. A tarolt szoveg nem valtozik. Ha az
 * ertekben mar van betu (`0,75 kW`, `3 A`, szabad megjegyzes), valtozatlan;
 * ures ertekbol `undefined` lesz.
 */
export function withAssetUnit(
  value: string | null | undefined,
  unit: string,
): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return /\p{L}/u.test(text) ? text : `${text} ${unit}`;
}
