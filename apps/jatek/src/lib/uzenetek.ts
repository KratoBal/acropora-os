/**
 * AZ OLDAL SZAVAI A HIBAKODOKHOZ. Az api (`jatek-api-szerzodes.md`, nautilus) minden hibat
 * `{ statusCode, code, message }` alakban ad, a `message` kiirhato magyar mondat. Az oldal a SAJAT mondatait
 * hasznalja az ismert kodokhoz (a szoveg egy helyen cserelheto, es nem fugg az api szovegetol), az api mondata csak
 * az ismeretlen kodra marad.
 *
 * AMIT AZ OLDAL SOHA NEM MOND: hogy a valasz jo-e (az api sem mondja), es hogy egy cim jatszott-e mar (az ismetelt
 * beküldés ugyanazt a "levelet kuldtunk" valaszt kapja).
 */
export const BEKULDES_RENDBEN =
  "Küldtünk egy levelet, a benne lévő linkkel lesz érvényes a játékod.";

export const NEM_ELERHETO =
  "A játék most nem érhető el. Kérjük, próbáld újra egy kicsit később.";

const BEKULDES_HIBAK: Readonly<Record<string, string>> = {
  INVALID_EMAIL: "Ez az e-mail-cím nem tűnik érvényesnek. Nézd át, kérjük.",
  INVALID_NAME: "Kérjük, add meg a nevedet.",
  INVALID_ANSWER:
    "A válaszod nem fogadható el. Írj be egy választ (legfeljebb 200 karakter), vagy válassz a lehetőségek közül.",
  NO_QUESTION: "Most nincs nyitott kérdés.",
  CLOSED: "Ez a kérdés már lezárult, vagy még nem nyílt meg.",
  TOO_MANY:
    "Túl sok próbálkozás érkezett. Kérjük, várj egy kicsit, és próbáld újra.",
};

const MEGEROSITES_HIBAK: Readonly<Record<string, string>> = {
  INVALID_TOKEN:
    "Ez a megerősítő link nem érvényes. Nézd meg, hogy a levélben lévő linket másoltad-e be teljesen.",
  CLOSED:
    "A kérdés azóta lezárult, ezért ezt a részvételt már nem lehet megerősíteni.",
  TOO_MANY:
    "Túl sok próbálkozás érkezett. Kérjük, várj egy kicsit, és próbáld újra.",
};

export const MEGEROSITVE = "Köszönjük, a részvételed megerősítve.";
export const MAR_MEGEROSITVE =
  "Ezt a részvételt már megerősítetted, nincs több teendőd.";

/** A beküldés hibakódjának mondata; ismeretlen kódra az api mondata, ha van, különben az "elérhetetlen". */
export const bekuldesHiba = (code: string, apiMessage?: string): string =>
  BEKULDES_HIBAK[code] ?? kiirhato(apiMessage) ?? NEM_ELERHETO;

export const megerositesHiba = (code: string, apiMessage?: string): string =>
  MEGEROSITES_HIBAK[code] ?? kiirhato(apiMessage) ?? NEM_ELERHETO;

/** Az api mondata csak akkor kerül a lapra, ha rövid, egy soros szöveg (egy átjáró hibaoldala nem az). */
const kiirhato = (text: string | undefined): string | undefined => {
  const t = text?.trim();
  return t && t.length <= 200 && !/[<>\n\r]/.test(t) ? t : undefined;
};
