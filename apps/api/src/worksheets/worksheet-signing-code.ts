/**
 * AZ ALAIROKOD: NEGY SZAMJEGY, AMIT AZ UGYFEL IR BE.
 *
 * Balazs kerese, 2026-09-04: "Szerelo kivalasztja a listarol es utana felugrik
 * egy alairokod nevu ablak ahova az ugyfel beirja a negyjegyu szamokbol allo
 * alairokodjat."
 *
 * === MIT BIZONYIT, ES MIT NEM ===
 *
 * A legordulo azt rogziti, KINEK mondta magat az alairo. A kod az, ami ezt
 * bizonyitja is: olyasmit kell tudnia, amit csak o tud.
 *
 * AZ ELSO IDOSZAKBAN EZ FORMALIS, ES EZ TUDOTT DONTES, NEM MULASZTAS. Az
 * alapertelmezett kod `0000`, es amig a ticketing felulet nincs meg, senki nem
 * tudja megvaltoztatni. Balazs ezt szo szerint tudomasul vette. Aki ezt kesobb
 * olvassa: NE "javitsd meg" a kod kikapcsolasaval vagy egy kitalalt
 * kotelezo-csere aggal -- az a dontes mar megszuletett, es a masik iranyba.
 *
 * === ZAROLAS NINCS, ES EZT IS KI KELL MONDANI ===
 *
 * Negy szamjegy tizezer lehetoseg. Egy probalkozas-korlat ezt kezelne, es
 * Balazs dontese szerint NEM keszul ("nem kell zarolas"). Ez a modul tehat nem
 * szamol kiserleteket -- de a hianya DONTES, nem elfelejtett resz, es ezert all
 * itt leirva. Ha valaha megis kell, a hely ez a fuggveny.
 */

/** A kod alakja: PONTOSAN negy szamjegy. */
const CODE_PATTERN = /^\d{4}$/;

/**
 * AZ ALAPERTELMEZETT KOD, amit a felhasznalo a letrehozasakor kap.
 *
 * Balazs adta meg peldakent, es szo szerint ezt hasznaljuk. NEM veletlen ertek:
 * egy generalt kodot at kellene adni valahogy, es az az ut (a ticketing
 * felulet) meg nincs meg -- vagyis a fiok hasznalhatatlan lenne addig.
 */
export const DEFAULT_SIGNING_CODE = "0000";

export type SigningCodeCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "malformed" | "missing-code" | "mismatch";
      message: string;
    };

/**
 * ELFOGADHATO-E EZ A KOD -- ALAK SZERINT.
 *
 * A levagott erteket nezzuk: a telefon billentyuzete konnyen ad szokozt, es egy
 * " 1234" alaku ertek a felhasznalo szemszogebol UGYANAZ a kod.
 */
export function isWellFormedSigningCode(value: string): boolean {
  return CODE_PATTERN.test(value.trim());
}

/**
 * MI TORTENIK, HA A KOD NEM JO -- ES A HAROM ESET KULON MONDATOT KAP.
 *
 * A kulonbseg nem stilus: MAS A TEENDO. Az alak-hiba a beirasrol szol (javitsd
 * a mezot), a hianyzo tarolt kod a FIOKROL (szolj az irodanak), az eltero kod
 * pedig arrol, hogy az ott allo ember nem tudja a kodot -- ott a szerelonek
 * kell dontenie, hogy az "egyik sem" agra megy-e.
 *
 * ES A HIANYZO TAROLT KOD SOHA NEM ENGED AT. Egy "nincs kod, tehat atengedjuk"
 * ag pontosan azt a bizonyito erot venne el, amiert az egesz keszul -- es a
 * lapon ugyanugy nezne ki, mint egy ellenorzott alairas.
 */
export function describeSigningCodeFailure(
  reason: "malformed" | "missing-code" | "mismatch",
): string {
  if (reason === "malformed") return "Az aláírókód négy számjegy. Írd be újra.";
  if (reason === "missing-code")
    return (
      "Ehhez a munkatárshoz nincs aláírókód rögzítve, ezért nem tud aláírni. " +
      "Szólj az irodának, vagy válaszd az „egyik sem” lehetőséget, és írd be a nevét."
    );
  return (
    "Az aláírókód nem egyezik. Próbáld újra, vagy ha az ügyfél nem tudja a kódját, " +
    "válaszd az „egyik sem” lehetőséget, és írd be a nevét."
  );
}
