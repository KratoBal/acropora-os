/**
 * A TELJESITMENY ES A MERTEKEGYSEGE EGYUTT MOZOG -- ES FRISSITESKOR AZ EREDMENYT
 * KELL NEZNI, NEM A BEKULDOTT MEZOT.
 *
 * Ez a kulonbseg a fuggveny letezesenek oka. Felvitelkor egyszeru: ami jon, az
 * lesz. Frissiteskor viszont a kliens KULON is kuldheti a ketto egyiket, es
 * olyankor a masik a MEGLEVO ertek marad -- egy "csak a szamot irom at" keres
 * TELJESEN ervenyes, ha az egyseg mar all az eszkozon.
 *
 * Ha a felallapotot a bekuldott mezokbol itelnenk meg, pontosan ezt utasitanank
 * el: a kezelo azt latna, hogy a mentes hibas, holott a vegeredmeny ep.
 *
 * A TABLAN ALLO `Asset_performance_pairing_check` a vegso vedelem. Ez a
 * fuggveny NEM helyettesiti: azert all elotte, hogy a felhasznalo MONDATOT
 * kapjon, ne egy megkotes nevet.
 */
export type TeljesitmenyAllapot =
  | { rendben: true; performance: string | null; unitId: string | null }
  | { rendben: false; hiany: "unit" | "szam" };

export function teljesitmenyEredmenye(
  /** Ami MA all az eszkozon. Felvitelnel mind a ketto `null`. */
  meglevo: { performance: string | null; unitId: string | null },
  /** Ami a keresben jott. A `undefined` jelenti azt, hogy ne nyulj hozza. */
  bekuldott: {
    performance?: string | null;
    performanceUnitId?: string | null;
  },
): TeljesitmenyAllapot {
  const performance =
    bekuldott.performance === undefined
      ? meglevo.performance
      : ures(bekuldott.performance);
  const unitId =
    bekuldott.performanceUnitId === undefined
      ? meglevo.unitId
      : ures(bekuldott.performanceUnitId);

  if (performance !== null && unitId === null)
    return { rendben: false, hiany: "unit" };
  if (performance === null && unitId !== null)
    return { rendben: false, hiany: "szam" };
  return { rendben: true, performance, unitId };
}

/**
 * AZ URES SZOVEG ITT TORLES, NEM ERVENYTELEN ERTEK -- es ez ELTER a
 * matricakodtol, szandekosan.
 *
 * A kulonbseg oka nem a mezo tipusa, hanem hogy a TORLES letezik-e: a
 * teljesitmenyt le lehet szedni az eszkozrol (a ket mezo egyutt kiurul), a
 * matricat ezen az uton nem. A webes urlap minden szoveges mezore ures
 * szoveget kuld, ha a kezelo kitorolte a tartalmat.
 */
function ures(ertek: string | null): string | null {
  if (ertek === null) return null;
  const trimmelt = ertek.trim();
  return trimmelt === "" ? null : trimmelt;
}
