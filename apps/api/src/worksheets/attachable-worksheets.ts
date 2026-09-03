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

/**
 * ES A MASODIK SZURO: CSAK A JEGY PARTNERENEK LAPJAI.
 *
 * KULON FUGGVENY, NEM A FENTI BOVITESE, es ez nem stilus. A ketto MAST
 * jelent, es maskor romlik el:
 *
 *   a szabad-lap szuro   arrol szol, hogy a lap nem all mar MASIK jegy alatt
 *   a partner-szuro      arrol, hogy a lap ehhez a jegyhez TARTOZHAT-e
 *
 * Ha egy fuggvenybe kerulnenek, az egyik kivetele csendben elvinne a masikat.
 * Igy mindkettonek sajat allitasa van, es egy celzott rontas nev szerint
 * mondja meg, MELYIK szunt meg.
 *
 * MIERT KELLETT (Balazs elo esete, 2026-09-03): a valaszto olyan lapot kinalt
 * fel, ami masik partnere -- a csatolas vegpontja HELYESEN visszautasitotta, de
 * csak a kattintas utan. A vegpont ellenorzese tehat jo volt, csak keson szolalt
 * meg. Ez a szuro ugyanazt a szabalyt viszi elore a listaig, ES NEM VALTJA KI:
 * a vegponti ellenorzes marad, mert a lista es a kattintas kozott is telik ido.
 */
export function attachableWorksheetPartnerWhere(
  customerId: string,
): Prisma.WorksheetWhereInput {
  return { customerId };
}

/**
 * A KETTO EGYUTT, AHOGY A LEKERDEZES HASZNALJA.
 *
 * MIERT KELL HARMADIK FUGGVENY KET SOR OSSZEFUZESEERT: mert a BEKOTES eddig
 * merhetetlen volt. A ket szuro kulon-kulon merheto (sajat allitasuk van), a
 * lekerdezes viszont a repositoryban all, ami Prismat hiv -- tehat az a hely,
 * ahol az egyik szuro KIMARADHAT, epp az volt, amit semmi nem orzott.
 *
 * Ez ugyanaz az alak, mint a lekepezes a felhasznalo-valaszban: ket helyes
 * darab, es a KOZOTTUK levo allitas nema. Egy kimaradt szuro nem hibazik: a
 * lista bovebb lesz, es helyes valasznak nez ki.
 */
export function attachableWorksheetFilters(
  customerId: string,
): Prisma.WorksheetWhereInput[] {
  return [
    attachableWorksheetWhere(),
    attachableWorksheetPartnerWhere(customerId),
  ];
}
