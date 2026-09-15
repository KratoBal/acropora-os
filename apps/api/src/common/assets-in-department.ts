import { prisma } from "@acropora/database";

import { collectUnitSubtreeIds } from "../service-assets/unit-subtree.js";

/**
 * MELYIK ESZKOZ ESIK KIVUL EGY HELYSZIN RESZFAJAN.
 *
 * === MIERT KOZOS FUGGVENY, ES NEM KET MASOLAT ===
 *
 * Ket felvitel hasznalja ugyanezt a szabalyt: a HIBAJEGY (2026-09-14 ota) es a
 * MUNKALAP (2026-09-15 ota). Ugyanaz a kerdes -- a megnevezett eszkozok
 * tenyleg a megadott helyszin ALATT allnak-e --, es ugyanaz a hiba, ha
 * elcsuszik: egy IDEGEN partner eszkoze kerulne a munkadarabra.
 *
 * Masolatban a ket peldany addig egyezne, amig valaki az egyiket javitja. A
 * jegynel ez a szabaly mar mukodott; a lapnal a MASODIK peldany lett volna --
 * es a repo sajat mercéje szerint epp a masodik peldany az, ami egyszer
 * lemarad.
 *
 * === A RESZFA, NEM A CSOMOPONT ===
 *
 * A szures a megnevezett egyseg RESZFAJARA szol, nem csak magara az egysegre.
 * Ez nem kenyelem: a bejelento a "Biodom"-ot nevezi meg, az eszkoz viszont a
 * "Biodom / Nagy medence" alatt all. Egy pontos egyezes itt ures listat adna,
 * es a felhasznalo azt hinne, nincs eszkoze.
 *
 * === AMIT VISSZAAD, ES MIERT NEM BOOLEAN ===
 *
 * A KIESO azonositok listaja, nem egy igen/nem. A hivo igy meg tudja nevezni,
 * MELYIK eszkozzel van baj -- egy puszta elutasitas arra kenyszeritene a
 * felhasznalot, hogy egyesevel probalgassa.
 */
export async function assetsOutsideDepartment(
  assetIds: readonly string[],
  departmentId: string,
): Promise<string[]> {
  const root = await prisma.worksheetDepartment.findUnique({
    where: { id: departmentId },
    select: { customerId: true },
  });
  const units = root
    ? await prisma.worksheetDepartment.findMany({
        where: { customerId: root.customerId },
        select: { id: true, name: true, parentId: true },
      })
    : [];
  /**
   * ISMERETLEN HELYSZINNEL A RESZFA MAGA AZ EGYSEG. Nem talalat-nelkuli ag: a
   * hivo ilyenkor MINDEN eszkozt kiesonek fog latni, ami a helyes irany -- egy
   * ures reszfa `{ in: [] }` alakban mindent atengedne.
   */
  const subtree = root
    ? collectUnitSubtreeIds(units, departmentId)
    : [departmentId];

  const found = await prisma.asset.findMany({
    where: { id: { in: [...assetIds] }, departmentId: { in: subtree } },
    select: { id: true },
  });
  const ok = new Set(found.map((row) => row.id));
  return assetIds.filter((id) => !ok.has(id));
}
