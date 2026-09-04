/**
 * A BOLTI CIM ATVITELE: a UNAS SefUrl-jebol a Medusa `handle` mezoje.
 *
 * MIERT LETEZIK: a vetites a `handle`-t atviszi, kulonben a Medusa a NEVBOL
 * szarmaztat. Merve az 1893 termeken (2026-09-03): a mai SefUrl-lel BETURE
 * mindossze NEGY egyezne, 872 csak kis-nagybetuben terne el, es 937 erdemben
 * mas cimet kapna. Vagyis a regi bolti cimek tulnyomo tobbsege nem all elo
 * magatol.
 *
 * === A KISBETUSITES NEM IZLES, HANEM A CEL OLDAL SZABALYA (merve 2026-09-04) ===
 *
 * Itt korabban az allt, hogy a lekepezes a leheto legkevesebbet valtoztat, mert
 * egy "szebb" alak (kisbetusites, ekezet-bontas) tavolabb vinne a cimet a
 * regitol. AZ INDOK FELE MA MAR NEM ALL, es nem kiegeszitettem, hanem atirtam.
 *
 * A telepitett Medusa 2.19.0 sajat forrasa
 * (`@medusajs/utils/dist/common/validate-handle.js`) NAGYBETUS ASCII-t KULON,
 * nevezett agon utasit el, ezzel az indokkal: "to maintain consistency with
 * auto-generated handles (always lowercase) and prevent case-sensitive
 * duplicate issues with the database unique index". A termek-modul ezt a
 * `handle` mezon KI IS KENYSZERITI (`product-module-service.js`, "Validates the
 * manually provided handle value").
 *
 * Ravezetve a teljes UNAS-exportra: az 1813 SefUrl-bol MA 14 menne at, 1799-et
 * a Medusa elutasitana -- MINDET a nagybetu miatt, mas ok nulla. Kisbetusites
 * utan 1812 megy at, EGY marad kint, es NULLA utkozes keletkezik.
 *
 * === AMIT A CEL OLDAL VISZONT ELFOGAD, ES EZERT NEM ADUNK FEL ===
 *
 * AZ EKEZETET. A szabaly `\p{Ll}`-t enged, tehat az `a`, `e`, `o`, `u` rendben
 * van. A regi felelem a "szebb alaktol" CSAK a kis-nagybetu kerdesere volt
 * igaz; ekezet-bontas tenyleg tavolabb vinne a cimet a regitol, es azt NEM
 * tesszuk.
 *
 * === AMI KIMARAD, AZ KIMARAD -- KULON ESET NELKUL ===
 *
 * Ha a lekepezes eredmenye a cel oldal szabalyanak NEM felel meg, a fuggveny
 * `null`-t ad, es akkor a mezo ki sem megy: a bolt a NEVBOL kepez cimet. Ez
 * rosszabb, mint a helyes cim, de jobb, mint egy ELUTASITOTT termek -- es
 * LATSZIK, mert a parositas-listaban nem lesz sora.
 *
 * A mai adaton ez EGY termek (`alap_hal`, alahuzas miatt). NINCS ra kulon eset,
 * es szandekosan nincs: egy nevesitett kivetel a kovetkezo ilyen erteknel mar
 * nem vedene, es elrejtene, hogy a szabaly az, ami dont.
 */

/** A `handle`-ben megtarthato karakterek: a SefUrl minden mai alakja belefer. */
const NEM_MEGENGEDETT = /[/\\?#\s]+/g;

/**
 * A CEL OLDAL SZABALYA, TUKROZVE -- es a tukor volta kimondva.
 *
 * A valodi szabaly a telepitett `@medusajs/utils` `isValidHandle` fuggvenyeben
 * all; ez itt masolat, hogy a lekepezes MAR ITT tudja, mit fogadnanak el. Egy
 * masolat elcsuszhat: ha a cel oldal verziot valt, EZT a sort kell ujra merni,
 * nem a viselkedest kitalalni.
 *
 * A nagybetu-agat nem tukrozzuk kulon, mert ide mar kisbetusitett ertek erkezik,
 * es a `\p{Ll}` amugy sem enged nagybetut.
 */
const MEDUSA_HANDLE_ALAK =
  /^[\p{Ll}\p{Lo}\p{Lm}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{N}]+)*$/u;

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
  if (vagott.length === 0) return null;

  const kisbetus = vagott.toLowerCase();
  return MEDUSA_HANDLE_ALAK.test(kisbetus) ? kisbetus : null;
}

/** Egy regi cim es az uj parja, atiranyitashoz. */
export interface MedusaHandleParositas {
  /** A UNAS SefUrl, ahogy ma all. */
  regi: string;
  /** A Medusaba kerulo `handle`. */
  uj: string;
}

/**
 * A REGI ES AZ UJ CIM PARJA, HA KULONBOZNEK.
 *
 * === MIERT A LEKEPEZESSEL EGYUTT KESZUL, ES NEM KESOBB ===
 *
 * A kisbetusites EGYIRANYU: a `aqua-illumination-prime-hd-led-panel` alakbol
 * nem lehet visszafejteni, hogy a regi cim `Aqua-Illumination-Prime-HD-LED-panel`
 * volt. Ha a parositas nem MOST keszul el, kesobb mar sehonnan nem all elo.
 *
 * Ez NEM atiranyitas-kezeles: csak a lista, ami az atiranyitasok FORRASA lesz,
 * amikor az uj bolt elesedik.
 *
 * === `null`, HA NINCS MIT ATIRANYITANI ===
 *
 * Ket eset. Ha nincs handle (a cel oldal ugyis a nevbol kepez, es a regi cimhez
 * nincs mit kotni). Es ha a ket cim AZONOS -- olyankor a regi cim tovabbra is
 * mukodik, es egy onmagara mutato atiranyitas csak zaj lenne. A mai adaton ez
 * 14 termek.
 */
export function medusaHandleParositas(
  slug: string | null,
): MedusaHandleParositas | null {
  if (slug === null) return null;
  const uj = medusaHandleFromSlug(slug);
  if (uj === null) return null;
  const regi = slug.trim();
  return regi === uj ? null : { regi, uj };
}
