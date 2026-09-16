import { buildUnitPaths } from "../service-assets/unit-path.js";

/**
 * EGY ALEGYSEG TELJES UTJA, A GYOKERTOL LEFELE -- ADATBAZISBOL.
 *
 * MIERT KELL, es miert nem eleg a nev: a kod es a nev csak TESTVEREK kozott
 * egyedi, tehat ket tavoli ag alatt ugyanaz a "Biodóm (BIO)" megengedett es
 * termeszetes. Aki egy adatlapon ilyen sort lat, nem tudja megmondani,
 * melyikrol van szo -- es semmi nem jelzi neki, hogy van miben tevedni.
 *
 * Balazs merte vissza 2026-09-16-an, a munkalap adatlapjarol: ott `NMD —
 * Nagymedence` allt, a teljes ut helyett.
 *
 * === A KLIENST A HIVO ADJA, ES EZ NEM STILUS ===
 *
 * A fuggveny NEM importal `prisma`-t. Elso alakjaban megtette, es huszonhat
 * egyseg-teszt bukott el ra: a szolgaltatasok hamis TAROLOVAL futnak, es ha a
 * szolgaltatas maga nyul az adatbazishoz, a hamis tarolo mar nem fedi le.
 * A reteg-rend ebben a kodbazisban az, hogy adatbazishoz a TAROLO nyul --
 * a bukas nem kellemetlenseg volt, hanem pont ezt mondta ki.
 *
 * === MIERT A TESTVEREKET IS BETOLTI, HOLOTT EGY UT KELL ===
 *
 * Mert az ut FELFELE epul, es a szulok azonositojat csak a sorokbol tudjuk. Egy
 * rekurziv lekerdezes korokre is helyes lenne, de ugyanazt a vedelmet ujra meg
 * kellene irni, ami a tiszta fuggvenyben mar all (hianyzo szulo, kor).
 */
export interface UnitPathClient {
  worksheetDepartment: {
    findUnique(args: {
      where: { id: string };
      select: { customerId: true };
    }): Promise<{ customerId: string } | null>;
    findMany(args: {
      where: { customerId: string };
      select: { id: true; name: true; parentId: true };
    }): Promise<{ id: string; name: string; parentId: string | null }[]>;
  };
}

export async function unitPathFor(
  client: UnitPathClient,
  departmentId: string | null | undefined,
): Promise<string[] | null> {
  if (!departmentId) return null;

  const egyseg = await client.worksheetDepartment.findUnique({
    where: { id: departmentId },
    select: { customerId: true },
  });
  if (!egyseg) return null;

  const sorok = await client.worksheetDepartment.findMany({
    where: { customerId: egyseg.customerId },
    select: { id: true, name: true, parentId: true },
  });

  /**
   * A HIANYZO UT `null`, NEM URES TOMB. A ketto ket kulonbozo allitas: az
   * ures tomb azt mondana, hogy az ut ISMERT es nulla hosszu, a `null` azt,
   * hogy nem tudjuk. A felulet a masodikra visszaeshet a rovid nevre.
   */
  return buildUnitPaths(sorok).get(departmentId) ?? null;
}
