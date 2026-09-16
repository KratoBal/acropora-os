/**
 * KÉZZEL KARBANTARTOTT TÜKÖR a `packages/types/src/unit-of-measure.ts` fájlból.
 *
 * Az Expo app SZÁNDÉKOSAN nem húzza be a munkatér csomagjait (saját, app-helyi
 * npm lockfile, lásd `docs/MOBILE-DEVELOPMENT.md`), tehát importálni nem lehet
 * -- másolni kell. Ugyanaz a helyzet, mint a matricakódnál, és ugyanaz a
 * védelme: a szerver oldalán áll egy állítás, ami a két fájlt összeveti
 * (`apps/api/src/auth/performance-mirror.spec.ts`).
 *
 * MIÉRT FONTOS, HOGY EZ NE CSÚSZHASSON EL: a tárolt típus `decimal(19,6)`, és
 * a Prisma a nem felismert szövegre DOB -- mérve, a `"0,5"` alakra is. Az a
 * hiba a szolgáltatás `map` függvényének a végéig fut, ahol `throw error` áll:
 * 500 lenne belőle, nem 400.
 *
 * ÉS A TELEFONON EZ A LEGDRÁGÁBB. Offline a mentés SORBA kerül, és a szerver
 * válasza órákkal később érkezik meg. Egy elutasított érték akkor derülne ki,
 * amikor a szerelő már rég nincs a helyszínen -- az adat pedig ott és akkor
 * volt.
 */

/** A bemenet: legfeljebb 13 egész és 6 tizedes jegy, előjel nélkül. */
const PERFORMANCE_VALUE_PATTERN = /^\d{1,13}(?:\.\d{1,6})?$/;

export function normalizePerformanceValue(raw: string): string | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!PERFORMANCE_VALUE_PATTERN.test(trimmed)) return null;
  return trimmed.replace(/^0+(?=\d)/, "");
}

export function performanceValueProblem(
  raw: string,
): "empty" | "malformed" | null {
  if (raw.trim() === "") return "empty";
  return normalizePerformanceValue(raw) === null ? "malformed" : null;
}
