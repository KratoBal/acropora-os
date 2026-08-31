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
 * Az ismert értékek, MÉRVE, nem kitalálva:
 * a két `Dockerfile` `production` értéket süt be, a CI egy helyen ugyanezt adja
 * át, a kódban egy `development` szerepel, a staging pedig `staging` értékkel
 * fut (acrobot mérése, 2026-08-29).
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
