import type { Prisma } from "@acropora/database";

/**
 * MELYIK LAP CSATOLHATÓ EGY HIBAJEGY ALÁ.
 *
 * EGYETLEN FELTÉTEL: nincs mögötte hibajegy. Semmi más.
 *
 * MIÉRT ÁLL EZ KÜLÖN FÜGGVÉNYBEN, EGYETLEN SORÉRT: mert a kézenfekvő bővítés
 * elrontaná, és a hiba NÉMA lenne. Aki később ideír egy `status: "DRAFT"`
 * vagy egy „csak az elmúlt harminc nap" szűrőt, nem hibát okoz, hanem eltünteti
 * a folyamat felét - és a felület attól még működni fog, csak épp nem találja
 * azt a lapot, amit keresnek.
 *
 * A MÁSODIK ÚT MIATT VAN ÍGY. A lap keletkezhet hibajegy nélkül: karbantartás
 * közben derül ki, hogy valami elromlott, a szerelő ott helyben felveszi a
 * lapot, ÁTADJA, és a hibajegy nálunk születik meg - akár hetekkel később. Ha a
 * választó csak a friss vagy nyitott lapokat kínálná, épp az a lap maradna ki,
 * amiért ez a lista létezik.
 *
 * A LEZÁRT LAP IS CSATOLHATÓ: a lezárás a dokumentumról szól, a csatolás a
 * besorolásról. A kettőnek nincs köze egymáshoz.
 */
export function attachableWorksheetWhere(): Prisma.WorksheetWhereInput {
  return { serviceJobId: null };
}
