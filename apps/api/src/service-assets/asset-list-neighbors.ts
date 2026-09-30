import type { AssetListNeighbors } from "@acropora/types";

/**
 * HANY AZONOSITOT KER LE A SZOMSZED-KERESO EGY LEPESHEZ. Csak azonosito jon,
 * tehat ez olcso, de nem korlatlan: egy tobb tizezres szuretlen halmaznal a
 * lepes nem hozhatja le az egesz tablat. A hatar folott allo eszkoz "nincs a
 * listaban" valaszt kap, es a gombok tiltottak -- rossz szomszedot nem adunk.
 */
export const ASSET_NEIGHBOR_SCAN_LIMIT = 5000;

/**
 * AZ ESZKOZ KET SZOMSZEDJA A LISTA SORRENDJEBEN. Tiszta fuggveny: az adatbazis
 * a sorrendet adja, a hely megkeresese itt mert.
 *
 * `position` 1-tol szamol, es `null`, ha az eszkoz nincs a szurt halmazban
 * (kozben megvaltozott az allapota, vagy a hatar folott all). Ilyenkor mindket
 * szomszed `null`: egy "kovetkezo" egy olyan listaban, amiben az eszkoz nincs
 * benne, csak kitalalt lehetne.
 */
export function assetListNeighbors(
  orderedIds: readonly string[],
  id: string,
): AssetListNeighbors {
  const index = orderedIds.indexOf(id);
  if (index === -1)
    return {
      previousId: null,
      nextId: null,
      position: null,
      total: orderedIds.length,
    };
  return {
    previousId: index > 0 ? orderedIds[index - 1]! : null,
    nextId: index < orderedIds.length - 1 ? orderedIds[index + 1]! : null,
    position: index + 1,
    total: orderedIds.length,
  };
}
