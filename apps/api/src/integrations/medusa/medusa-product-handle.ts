/**
 * A BOLTI CIM ATVITELE: a UNAS SefUrl-jebol a Medusa `handle` mezoje.
 *
 * MIERT LETEZIK: a vetites ma a `handle`-t nem kuldi, tehat a Medusa a NEVBOL
 * szarmaztatja. Merve az 1893 termeken (2026-09-03): a mai SefUrl-lel BETURE
 * mindossze NEGY egyezne, 872 csak kis-nagybetuben terne el, es 937 erdemben
 * mas cimet kapna. Vagyis a regi bolti cimek tulnyomo tobbsege nem all elo
 * magatol.
 *
 * A LEKEPEZES A LEHETO LEGKEVESEBBET VALTOZTAT, es ez dontes: ami a `handle`-ben
 * allhat, azt beture visszuk. Egy "szebb" alak (kisbetusites, ekezet-bontas) a
 * cimet tavolabb vinne a regitol, es a leképezés visszafejthetetlenne valna --
 * epp azt veszitenenk el, amiert a mezot atvisszuk.
 *
 * AMIT AT KELL ALAKITANI: a PERJEL. A SefUrl 107 esetben tartalmaz perjelet, a
 * mertekegyseg miatt ("...KIMERT-/kg", "...SLW-5-aramoltato-3000-l/h"), es a
 * `handle` egyetlen URL-szegmens. Perjellel a cim ket szegmensre esne szet.
 *
 * ES EGY HATAR, AMIT NEM EN DONTOK EL: a Medusa `handle` oszlopan EGYEDI index
 * all (a kategoriaknal a repo ezt mar megmerte). A mai adaton ez nem gond --
 * 1813 SefUrl, mind kulonbozo, NULLA utkozes --, de a leképezés utkozest
 * KELETKEZTETHET, ha ket kulonbozo SefUrl ugyanarra az alakra jonne ki. Ezert
 * a fuggveny nem "megjavitja" az utkozest, hanem a hivo latja a kimenetet.
 */

/** A `handle`-ben megtarthato karakterek: a SefUrl minden mai alakja belefer. */
const NEM_MEGENGEDETT = /[/\\?#\s]+/g;

/**
 * `null`-t ad, ha nincs mit atvinni -- es ez NEM ugyanaz, mint az ures string.
 *
 * A hivo szerzodese: `null` eseten a mezot EL KELL HAGYNI a keresbol, nem ures
 * ertekkel kikuldeni. Egy ures `handle` a Medusaban vagy elutasitast valtana ki,
 * vagy felulirna azt, amit a bolt korabban szarmaztatott -- mindket eset
 * rosszabb, mint ha a mezo nem megy ki.
 */
export function medusaHandleFromSlug(slug: string | null): string | null {
  if (slug === null) return null;
  const tiszta = slug.trim().replace(NEM_MEGENGEDETT, "-").replace(/-+/g, "-");
  const vagott = tiszta.replace(/^-+/, "").replace(/-+$/, "");
  return vagott.length > 0 ? vagott : null;
}
