/**
 * A KATEGORIA WEBCIME. KULON MODUL, ADATBAZIS NELKUL MERHETO.
 *
 * === MIERT KULDUNK SAJAT HANDLE-T, HOLOTT A MEDUSA SZARMAZTAT IS ===
 *
 * A Medusa 2.19.0 a kategoria handle-jet a NEVBOL kepzi, ha nem kuldunk:
 * `productCategory.handle ??= kebabCase(productCategory.name)`
 * (`@medusajs/product`, product-module-service.js:1047 es 1072).
 *
 * ES A KATEGORIA-AGON NINCS ERVENYESSEG-ELLENORZES. Az `isValidHandle` a
 * TERMEK againban all (`validateProductPayload`, a doc-kommentje szo szerint
 * "of the product"), a kategoriaria nem fut. Merve 2026-09-08 a telepitett
 * 2.19.0 forrasabol.
 *
 * EBBOL KOVETKEZIK A LELET, AMI EZT A MODULT ELOHIVTA: a teszt peldanyon mind
 * a 219 kategoria letrejott, es kozuluk 214 handle-je ERVENYTELEN -- csendben,
 * mert semmi nem szolt. Az ok a szulo-fuzes: a `{nev} - {szulo}` alak a
 * kebabCase utan harom kotojelet ad (`eledelek---termekek`), es az
 * isValidHandle az egymas melletti kotojelet tiltja.
 *
 * === MIERT NEM A NEVET NORMALIZALJUK ===
 *
 * A masik ut az lett volna, hogy a kategoria NEVET tisztitjuk. Az egyetlen
 * dontesse vonna ossze a MEGJELENO nevet es a WEBCIMET, es a kettot kesobb nem
 * lehetne szetvalasztani. A sajat handle mellett kulon maradnak: a cim
 * valtozatlan, tehat nincs atnevezes es nincs atiranyitas-igeny.
 *
 * ES A MARKANAL (gyujtemeny) EZT MAR IGY CSINALJUK, kifejezett indoklassal a
 * kliens kommentjeben. A ket ut asszimetriaja nem dontesbol allt elo, hanem
 * hianybol.
 *
 * === AZ EKEZET: ELHAGYJUK, ES EZ DONTES, NEM MERES ===
 *
 * Mindket alak (ekezettel es nelkule) 0 ervenytelen handle-t es 0 utkozest ad
 * a 219-en, tehat a meres NEM donti el. Az indok a mai UNAS kategoria-cimekhez
 * valo kozelseg: azok vagy `/sct/<azonosito>/<Nev>` alakuak (megszunnek), vagy
 * kezzel adott, EKEZET NELKULI cimek.
 *
 * A TERMEKEKNEL EZ FORDITVA ALL, es ott az ekezet MARAD: a termek handle-je a
 * UNAS SefUrl, tehat egy MAR LETEZO cim, amit orzunk. Kategorianal nincs regi
 * cim, amit orizni kellene. (acrobot dontese, 2026-09-08.)
 *
 * HA EZ AZ OK MEGSZUNIK -- pl. a kategoriak is kapnak orzendo regi cimet --,
 * az indok is megszunik, es a dontest ujra kell hozni.
 */

/** A Medusa `isValidHandle` altal megengedett karakterek: kisbetu, szamjegy. */
const MEGENGEDETT = /[a-z0-9]/;

/**
 * A `kebabCase` HAROM lepese a telepitett 2.19.0-bol, betuhiven:
 * camelCase-bontas, majd a szokoz es alahuzas kotojelre, majd kisbetusites.
 * Karaktert NEM torol -- ezert kell utana a sajat tisztitasunk.
 */
function kebabCase(szoveg: string): string {
  return szoveg
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/** Az ekezetet a kombinalo jelek eltavolitasaval bontjuk le (NFD). */
function ekezetNelkul(szoveg: string): string {
  return szoveg.normalize("NFD").replace(/\p{Mn}+/gu, "");
}

/**
 * A CIMBOL WEBCIM. A cimet NEM valtoztatja meg: csak leképezi.
 *
 * Minden nem megengedett karakter KOTOJEL lesz, aztan a kotojel-futamok
 * osszevonodnak, es a vezeto/zaro kotojel levagodik.
 */
export function categoryHandle(title: string): string {
  const alap = ekezetNelkul(kebabCase(title));
  let ki = "";
  for (const ch of alap) ki += MEGENGEDETT.test(ch) ? ch : "-";
  return ki.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * MELYIK CIM-SZO TUNIK EL NYOM NELKUL.
 *
 * A csere KARAKTER-szinten artalmatlan: egy vesszo ket szo kozott kotojel lesz,
 * a szo-hatar megmarad. Egy ONALLO, csak irasjelbol allo szo viszont eltunik,
 * mert a helyen keletkezo kotojel a szomszedaival osszevonodik.
 *
 * MERVE 2026-09-08 a 219 kategorian: PONTOSAN EGY ilyen van, a
 * `Black Label "+" sorozat` (a `"+"` szo). A szam azert all itt es nem a
 * kodban, mert allitas -- a `medusa-category-handle.spec.ts` tartja.
 *
 * EZ A FUGGVENY A SZABALY ONBEVALLASA, NEM KIVETEL. Egy `+`-ra irt kivetel
 * tobbet rontana, mint amennyit er (polip merese); ehelyett a betoltes KIIRJA,
 * ha egy szo elveszett, es akkor a vesztes nem csendes.
 */
export function lostWordsInHandle(title: string): string[] {
  const szavak = title.split(/[\s-]+/).filter((sz) => sz.length > 0);
  return szavak.filter((sz) => categoryHandle(sz) === "");
}

/** A jelentes sora egy szo-vesztesrol. Megnevezi a cimet ES az elveszett szot. */
export function describeLostWords(
  title: string,
  lost: readonly string[],
): string {
  return (
    `A(z) "${title}" kategória webcíméből ${lost.length} szó nyom nélkül ` +
    `eltűnik (${lost.map((sz) => `"${sz}"`).join(", ")}), mert csak írásjelből ` +
    `áll. A webcím érvényes marad, tehát ezt semmi más nem jelzi.`
  );
}
