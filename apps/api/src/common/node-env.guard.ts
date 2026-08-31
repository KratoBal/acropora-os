/**
 * A `NODE_ENV` értékének ellenőrzése indulásnál - egy ELGÉPELÉS ellen.
 *
 * MIÉRT KELL, ÉS MI A KONKRÉT KÁR. Az API hat helyen ágazik a `NODE_ENV`
 * értékére, és öt közülük ÚGY ág el, hogy egy ismeretlen érték a rendszert
 * MEGENGEDŐBBÉ teszi:
 *
 *   unas-connection-startup.validator.ts    az indulási ellenőrzés kimarad
 *   nav-connection-startup.validator.ts     az indulási ellenőrzés kimarad
 *   medusa-connection-startup.validator.ts  az indulási ellenőrzés kimarad
 *   auth/cookie.util.ts                     a session-süti nem lesz `secure`
 *   auth/auth.service.ts                    a FEJLESZTŐI BEJELENTKEZÉS megnyílik
 *
 * Vagyis egy elgépelt érték az éles példányon EGYSZERRE kapcsolna ki három
 * ellenőrzést, venné le a `secure` jelzőt, és nyitná meg a fejlesztői
 * bejelentkezést - és mindezt CSENDBEN, mert minden ág a „nem production"
 * oldalra esik.
 *
 * EZ AZ ŐRZŐ NEM DÖNTI EL, MELYIK KÖRNYEZETBEN MI FUSSON. Nem változtat egyetlen
 * szabályon sem: csak azt veszi el, hogy egy ELÍRÁS észrevétlen maradjon. Hogy
 * a három indulási ellenőrzésnek stagingen is futnia kell-e, az külön kérdés,
 * és nem itt dől el.
 *
 * AZ ÜRES ÉRTÉK MEGENGEDETT, ÉS EZ MÉRÉS: a CI a `NODE_ENV` értékét egyetlen
 * helyen állítja (egy `docker run` sorban), egyébként nem, és a helyi futás is
 * beállítás nélkül megy. Egy őrző, ami ezeket megállítaná, többet rontana, mint
 * amennyit javít.
 */

/**
 * Az ismert értékek. HÁROM MÉRT, EGY BIZONYTALAN, és a különbséget ki kell írni,
 * mert egy listában minden elem egyformán magabiztosnak látszik:
 *
 *   production   MÉRVE: mindkét `Dockerfile` ezt süti be, és a CI egy helyen
 *                ugyanezt adja át.
 *   development  MÉRVE: a kódban szerepel.
 *   test         a teszt-futtatás bevett értéke.
 *   staging      NEM MÉRT ÁLLAPOT. Egy 2026-08-29-i mérés (acrobot) szerint a
 *                staging példány ezzel az értékkel futott, DE a staging azóta
 *                átköltözött és újratelepült, tehát a mérés nem a mai állapotról
 *                szól. A health végpontja nem adja vissza a környezetet, tehát
 *                kívülről nem dönthető el.
 *
 * MIÉRT MARAD BENT A `staging` ADDIG IS: egy TÖBBLET ismert érték soha nem állít
 * meg semmit, csak egy elírást enged át, ami történetesen pont ezt a szót adja.
 * A kivétele viszont MEGÁLLÍTANÁ azt a példányt, ahol az érték tényleg ez -- és
 * az a kár aszimmetrikus. Ezért a bizonytalanság a bennhagyás irányába dönt.
 *
 * ÉS A KIVÉTELE NEM INGYENES, HA VALAHA SZÓBA JÖN: nem csak a mai környezetekről
 * szól, hanem arról is, hogy ezt az értéket a JÖVŐBEN se lehessen beállítani
 * indulási hiba nélkül. Az „szigorúbb lesz, és nem állít meg semmit" csak a
 * ma futó példányokra igaz.
 */
export const KNOWN_NODE_ENVS = [
  "production",
  "staging",
  "development",
  "test",
] as const;

export type KnownNodeEnv = (typeof KNOWN_NODE_ENVS)[number];

export class UnknownNodeEnvError extends Error {}

/**
 * `null`, ha az érték rendben van (ismert vagy nincs beállítva); különben a
 * hibaüzenet, ami MEGMONDJA, mit kell tenni.
 *
 * Tiszta függvény, hogy a szabály a bootstrap elindítása nélkül is mérhető
 * legyen - egy teszt, aminek a szabály ellenőrzéséhez fel kellene húznia az
 * API-t, mást mérne.
 */
export function describeNodeEnvProblem(
  value: string | undefined,
): string | null {
  // A BEÁLLÍTATLAN ÉRTÉK SZÁNDÉKOSAN ÉRVÉNYES, EZT NE "JAVÍTSD KI". A CI a
  // NODE_ENV értékét egyetlen helyen állítja, egyébként nem, és a helyi futás
  // is beállítás nélkül megy: egy őrző, ami ezeket megállítaná, működő
  // környezeteket törne el. Az üres string ugyanez, csak más alakban.
  if (value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  if ((KNOWN_NODE_ENVS as readonly string[]).includes(trimmed)) return null;

  return (
    `A NODE_ENV értéke "${value}", ami nem ismert környezet. Ismert értékek: ` +
    `${KNOWN_NODE_ENVS.join(", ")} - vagy hagyd üresen. ` +
    `EZ NEM FORMASÁG: egy elírt érték CSENDBEN kikapcsolja az UNAS, a NAV és a ` +
    `Medusa indulási ellenőrzését, leveszi a session-sütiről a secure jelzőt, ` +
    `és megnyitja a fejlesztői bejelentkezést, mert mindegyik a "nem ` +
    `production" ágra esik. Javítsd az értéket, ne ezt az ellenőrzést.`
  );
}

/**
 * Indulásnál hívva: HANGOSAN áll meg egy ismeretlen értéken.
 *
 * A megállás szándékos, és a csendes indulásnál jobb: egy el nem induló API-t
 * egy percen belül észrevesz valaki, egy csendben védtelenné vált API-t viszont
 * senki.
 */
export function assertKnownNodeEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problem = describeNodeEnvProblem(env.NODE_ENV);
  if (problem) throw new UnknownNodeEnvError(problem);
}
