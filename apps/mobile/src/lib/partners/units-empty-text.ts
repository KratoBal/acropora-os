/**
 * Az üres helyszín-lista OKA, ha kimondható: a partner nincs vevő-sorral
 * összekötve (a szerver `reason` mezője). A hatókörön kívüli partner üres
 * listája szándékosan ok nélküli.
 */
export type PartnerUnitsReason = "SUPPLIER_NOT_LINKED";

/**
 * AZ ÜRES HELYSZÍN-LISTA MONDATA (kártya 227a2137).
 *
 * Három különböző helyzet adott eddig ugyanazt a mondatot ("Ehhez a partnerhez
 * még nincs felvéve helyszín"):
 *
 *   1. offline, és nincs mentett másolat: ezt a mentett-másolat sáv mondja meg
 *      (`offline-notice.ts`), ezért itt NINCS mondat -- különben a kettő
 *      ellentmondana egymásnak;
 *   2. a partner nincs vevő-sorral összekötve: a szerver `SUPPLIER_NOT_LINKED`
 *      okot küld, és ez irodai javítás, nem "még nincs helyszín";
 *   3. a partner a kérő hatókörén kívül esik: ez SZÁNDÉKOSAN nem
 *      különböztethető meg (a létezés nem szivároghat ki), tehát ugyanaz a
 *      mondat, mint a valóban üres partnernél.
 */
export function partnerUnitsEmptyText(input: {
  fromCache: boolean;
  reason?: PartnerUnitsReason;
}): string | null {
  if (input.fromCache) return null;
  if (input.reason === "SUPPLIER_NOT_LINKED") {
    return "Ez a partner nincs vevővel összekötve, ezért a helyszínei nem látszanak. Az irodában kell összekötni.";
  }
  return "Ehhez a partnerhez még nincs felvéve helyszín.";
}
