/**
 * KÉZZEL KARBANTARTOTT TÜKÖR a `packages/types/src/asset-label.ts` fájlból.
 *
 * Az Expo app SZÁNDÉKOSAN nem húzza be a munkatér csomagjait: saját, app-helyi
 * npm lockfile-ja van, és egy pnpm-munkatér csomag behúzása innen nem
 * támogatott függőségi határ (lásd `docs/MOBILE-DEVELOPMENT.md` és
 * `src/lib/auth/types.ts`). Importálni tehát nem lehet -- másolni kell.
 *
 * EGY MÁSOLAT ANNYIT ÉR, AMENNYIRE IGAZ. Ezért a szerver oldalán áll egy
 * állítás (`apps/api/src/auth/asset-label-mirror.spec.ts`), ami összeveti a két
 * fájlt: a mintát, a kötelezőség kapcsolóját és a döntés ágait. Ha itt vagy ott
 * elmozdul valami, az az állítás pirosodik -- nem a felhasználó veszi észre a
 * helyszínen, hogy az űrlap átengedte, amit a mentés elutasít.
 *
 * A TÜKRÖZÉS HATÁRA: ez a fájl a DÖNTÉST másolja, nem a tárolt alakot. A
 * `^[A-Z][0-9]{4}$` megkötés az adatbázis tábláján áll, és oda a telefon
 * úgysem lát.
 */

/** A bemenet megengedőbb, mint a tárolt alak: a leolvasó adhat kisbetűt. */
const ASSET_LABEL_CODE_PATTERN = /^[A-Za-z][0-9]{4}$/;

/**
 * KÖTELEZŐ-E A MATRICA A FELVITELKOR. Egy helyen áll, itt és a szerveren.
 *
 * Balázs döntése, 2026-09-02 19:24: matrica nélkül is rögzíthető, utólag
 * hozzátehető. Az indok, amit elfogadott: ha kötelező lenne, egy szerelő,
 * akinél elfogyott a matrica, nem tudna eszközt felvinni a helyszínen.
 */
export const ASSET_LABEL_REQUIRED_ON_CREATE = false;

export function normalizeAssetLabelCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!ASSET_LABEL_CODE_PATTERN.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

export function assetLabelCreateProblem(
  raw: string | undefined,
): "missing" | "malformed" | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return ASSET_LABEL_REQUIRED_ON_CREATE ? "missing" : null;
  return normalizeAssetLabelCode(trimmed) === null ? "malformed" : null;
}
