import { type ServiceJobStatus } from "@acropora/database";

/**
 * MIT ÍR A LÉPÉS A JEGY SAJÁT IDŐBÉLYEGEIBE.
 *
 * TISZTA FÜGGVÉNY, ÉS EZ NEM RENDRAKÁS: a szabály így adatbázis nélkül is
 * mérhető. A tárolóréteg csak beteszi, amit ez ad, ugyanabba a tranzakcióba,
 * ahová a naplósor is megy.
 *
 * A KÉT MEZŐ MÁSOLAT, A NAPLÓSOR A FORRÁS. Azért mező és nem visszafejtés,
 * mert a „mely jegyek fejeződtek be ebben a hónapban" kérdés a számlázás
 * alapja lesz, és azt nem lehet minden lekérdezésnél a naplóból újraszámolni.
 * Egy származtatott mező nem tiltott - attól lesz veszélyes, ha nem mondjuk
 * meg, melyik a forrás. HA VALAHA ELTÉRNEK, A NAPLÓ NYER, és az eltérés HIBA.
 *
 * A `scheduledAt` NINCS ITT, és ez a különbség dönti el, hogy miért nem
 * ugyanaz a három mező: az TERV, nem esemény. Valaki beállítja, jövőbeli
 * időpontra, és a naplóból soha nem vezethető le, mert nem történt meg semmi.
 *
 * A `CANCELLED` NEM ír `completedAt`-ot: az elállt jegy lezárult, de nem
 * készült el. Egy közös mező a kettőre a számlázásnak hazudna.
 */
export function serviceJobMoveTimestamps(
  to: ServiceJobStatus,
  now: Date,
): { startedAt?: Date; completedAt?: Date } {
  if (to === "IN_PROGRESS") return { startedAt: now };
  if (to === "COMPLETED") return { completedAt: now };
  return {};
}
