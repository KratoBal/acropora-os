import type { UnitRow } from "../service-assets/unit-path.js";
import { collectUnitSubtreeIds } from "../service-assets/unit-subtree.js";

/**
 * EGY FELHASZNALO LATHATOSAGI EGYSEGEI, A RESZFAVAL EGYUTT.
 *
 * A HOZZARENDELES CSOMOPONTOKAT TAROL, NEM RESZFAT (lasd a
 * `UserWorksheetDepartment` modell jegyzetet). A kibontas ezert lekerdezeskor
 * tortenik: ha a reszfat a tablaba irnank ki, egy uj alcsomopont felvetele
 * CSENDBEN kihagyna azt mindenkinek, akinek a hozzarendelese korabban keszult.
 *
 * TISZTA FUGGVENY, adatbazis nelkul: a hivo tolti be a sorokat egy kotegben, ez
 * pedig csak bejar. Ugyanaz az alak, mint a `service-assets` oldalan
 * (`unitSubtreeIds`), es szandekosan ugyanaz -- ket kulonbozo bejaras ugyanarra
 * a fara ket kulonbozo valaszt tudna adni.
 */
export function expandAssignedUnits(input: {
  /** A hozzarendelt csomopontok azonositoi, a kapcsolotablabol. */
  assignedIds: readonly string[];
  /**
   * A hozzarendelesek partnerei ALATT allo OSSZES alegyseg.
   *
   * A hivo TOBB partner sorait is beadhatja, es ez nem elmeleti: ha egy
   * felhasznalo ket kulonbozo partner egysegeit kapna, EGY partner sorai hianyos
   * reszfat adnanak -- es az nem ures listakent jelentkezne, hanem KEVESEBB
   * sorkent, ami sokkal kevesbe feltuno.
   */
  units: readonly UnitRow[];
}): string[] {
  const ids = new Set<string>();
  for (const rootId of input.assignedIds) {
    for (const id of collectUnitSubtreeIds(input.units, rootId)) ids.add(id);
  }
  return [...ids];
}
