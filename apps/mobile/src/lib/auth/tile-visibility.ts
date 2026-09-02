import type { AuthenticatedUser } from "./types";

/**
 * A CSEMPE KODJA -> A SZERVER MENUTETELENEK AZONOSITOJA.
 *
 * KEZZEL IRT KEPZES, mert nem gepies: a telefon "ES" kodu csempeje az
 * `service-assets` tetel, a "RE" a `webshop-orders`. Ugyanaz az indok, mint a
 * kepesseg-tukornel: a ket oldal sajat szokincset hasznalja, es a megfeleltetes
 * dontes, nem levezetes.
 *
 * A SZERVER OLDALAN ALL RA ALLITAS (`mobile-capability-values.spec.ts`), mert
 * csak onnan latszik mind a ketto: az itteni azonositok es a kozos forras
 * tetelei. Egy azonosito, ami a forrasban nem letezik, itt SOHA nem valna
 * lathatova -- es a csempe csendben eltunne, pontosan ugy, ahogy egy ismeretlen
 * tetelnel HELYES viselkedni.
 *
 * ES AZERT SAJAT MODUL, NEM A KEPERNYO BELSEJE: egy dontesi tabla egy React
 * kepernyoben nem allithato. Merve 2026-09-02: amig itt allt, a "a telefon a
 * kiadott menut hasznalja" rontas NULLA tesztet dontott pirosra.
 */
export const TILE_ENTRY = {
  ES: "service-assets",
  MU: "worksheets",
  RE: "webshop-orders",
  BE: "purchasing",
  TE: "products",
  NAV: "nav-integration-mobile",
  PA: "partners",
} as const;

export type TileCode = keyof typeof TILE_ENTRY;

/**
 * MIT LAT EZ A FELHASZNALO -- A SZERVER SZERINT.
 *
 * A szures MAR MEGTORTENT a szerveren, a kozos menu-forrasbol. Ez a fuggveny
 * NEM ertekel ujra szabalyt: ha megtenne, ott keletkezne a harmadik forras,
 * epp azutan, hogy a masodikat megszuntettuk.
 *
 * MENU NELKULI VALASZ = URES HALMAZ, NEM VISSZAESES. A (3) lepesben meg volt
 * egy tartalek ag: ha a szerver nem kuldott menut, a kezdokepernyo a sajat
 * kepesseg-tablaira esett vissza. Acrobot dontese (2026-09-02): menu nelkuli
 * szervert nem tamogatunk, tehat az ag kiesik.
 *
 * AZ INDOK NEM AZ, HOGY FOLOSLEGES, HANEM AZ, HOGY NEMA. Ha a szerver egyszer
 * megsem kuld menut, a visszaeses CSENDBEN a regi tablakbol dolgozna, es senki
 * nem venne eszre. Nelkule a kezdolapon nem lesz csempe -- es a kepernyo ki is
 * mondja, hogy nincs. Egy tartalek ag, ami sosem fut, nem vedelem, hanem
 * masodik velemeny.
 *
 * CSAK A MOBIL FELULETU TETELEK szamitanak: a valasz a webeseket is hozza, es
 * azok kihagyasa nem verzio-csuszas, hanem normal mukodes.
 */
export function servedTileIds(
  user: Pick<AuthenticatedUser, "navigation"> | null,
): Set<string> {
  return new Set(
    (user?.navigation ?? [])
      .filter((entry) => entry.surfaces.includes("mobile"))
      .map((entry) => entry.id),
  );
}

/**
 * A SZERVER DONT, ES CSAK O.
 *
 * Nincs masodik velemeny: ha a tetel nincs a kiadott menuben, a csempe nem
 * jelenik meg -- akkor sem, ha a telefon sajat tablai mast mondananak.
 */
export function tileVisible(servedIds: Set<string>, code: TileCode): boolean {
  return servedIds.has(TILE_ENTRY[code]);
}
