/**
 * MEHET-E EZ AZ ALEGYSEG EHHEZ A FELHASZNALOHOZ.
 *
 * A SEMA EZT NEM TUDJA KIKENYSZERITENI: a feltetel KET TABLAN at vezet (a
 * felhasznalo szallitojatol a tukor-vevon keresztul az alegyseg vevojeig), es
 * egy idegenkulcs csak egy lepest lat. Ezert all kodban, sajat allitassal.
 *
 * MIERT NEM ELEG A JOGKOR. A `service.visibility.assign` azt dönti el, KI
 * allithat hozzarendelest. Azt nem, hogy MIT: enelkul egy belsos kolléga --
 * elgepelessel vagy egy rossz legordulobol -- MASIK partner alegyseget adhatna
 * egy felhasznalonak, es az attol kezdve MAS PARTNER hibajegyeit latna. A hiba
 * NEMA: a lista tobb sort ad, es helyes valasznak nez ki.
 *
 * TISZTA FUGGVENY, hogy a harom eset adatbazis nelkul is merheto legyen.
 */
export type VisibilityAssignmentCheck =
  | { ok: true }
  | { ok: false; reason: "not-partner-user" | "no-mirror" | "other-partner" };

export function mayAssignUnit(input: {
  /** A cel-felhasznalo partnere. `null`, ha sajat kollega. */
  userSupplierId: string | null;
  /** A partner tukor-vevo sora. `null`, ha nincs (nem szerviz partner). */
  supplierMirrorCustomerId: string | null;
  /** Az alegyseg vevoje. */
  unitCustomerId: string;
}): VisibilityAssignmentCheck {
  /**
   * SAJAT KOLLEGANAK NINCS ERTELME HOZZARENDELNI: o belsos hatokorrel mindent
   * lat, tehat a hozzarendeles nem bovitene semmit -- viszont azt sugallna,
   * hogy szukiti. Egy nem letezo szukites latszata rosszabb, mint a hianya.
   */
  if (input.userSupplierId === null)
    return { ok: false, reason: "not-partner-user" };

  /**
   * TUKOR NELKUL NINCS MIHEZ RENDELNI, es ez ma nem elmeleti: az eles
   * rendszerben kilenc partnerbol KETTONEK van tukor-vevo sora (merve
   * 2026-09-03). A tobbi ala eso felhasznalo egyseg-tengelye ures maradna --
   * es a hozzarendeles latszolag sikerulne.
   */
  if (input.supplierMirrorCustomerId === null)
    return { ok: false, reason: "no-mirror" };

  if (input.supplierMirrorCustomerId !== input.unitCustomerId) {
    return { ok: false, reason: "other-partner" };
  }
  return { ok: true };
}
