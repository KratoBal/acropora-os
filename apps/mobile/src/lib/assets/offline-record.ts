import {
  checkScannedCodeOffline,
  describeOfflineCheck,
  type CachedAssetLike,
} from "./offline-duplicate-check";
// RELATIV UT, NEM `@/`: a teszt-fordito nem ismeri az aliast
// (`tsconfig.test.json`-ban nincs `paths`), es a feloldasa behuzna az Expo
// futasi kornyezetet. A kepernyok hasznalhatjak az aliast, a teszt-forditott
// fajlok nem.
import type { QueueWriteOutcome } from "../offline/save-or-queue";
import { operationId } from "../offline/sync-queue";

/**
 * EGY ESZKOZ FELVITELE TERERO NELKUL: a dontes, sorba tetel elott es utan.
 *
 * === HAROM DOLOG, AMI ITT DOL EL, ES MINDHARMAT KULON KELL MERNI ===
 *
 * 1. SZABAD-E EGYALTALAN. A beolvasott kodot a gyorsitotar ellen ellenorizzuk:
 *    talalatnal megallunk, nem-talalatnal engedunk ES kiirjuk, hany eszkoz
 *    ellen ellenoriztunk (`offline-duplicate-check.ts`).
 *
 * 2. MI AZ AZONOSITOJA. A muvelet-azonosito a `sync-queue.ts` `operationId`
 *    fuggvenyebol jon -- UGYANABBOL, amit a szinkron kesobb hasznal. Ha az
 *    urlap sajat ideiglenes azonositot adna, egy megismetelt kuldes KET
 *    rekordot csinalna a szerveren: pontosan az a duplikatum, ami ellen az
 *    egesz szelet szol.
 *
 * 3. SIKERULT-E A SORBA TETEL. Es ez a legkonnyebben elsikkado: a felhasznalo
 *    azt latja, hogy "elmentve", ES UGYANAZT LATNA akkor is, ha a sorba tetel
 *    maga bukott el. A ket eset kulon valaszt kap.
 */

export type OfflineRecordDecision =
  /** A kod mar all egy eszkozon. A felvitel itt megall. */
  | { type: "blocked"; conflictingAssetId: string; message: string }
  /**
   * Mehet a sorba. A `message` az a mondat, amit a kollega lat: hany eszkoz
   * ellen ellenoriztunk, es mikori az adat.
   */
  | { type: "queueable"; operationId: string; message: string };

export function decideOfflineRecord(input: {
  qrToken: string;
  scannedAt: string;
  cached: CachedAssetLike | null;
  cachedCount: number;
  syncedAt: string | null;
}): OfflineRecordDecision {
  const verdict = checkScannedCodeOffline({
    found: input.cached,
    cachedCount: input.cachedCount,
    syncedAt: input.syncedAt,
  });
  const message = describeOfflineCheck(verdict);

  if (!verdict.allowed) {
    return {
      type: "blocked",
      conflictingAssetId: verdict.conflictingAssetId ?? "",
      message,
    };
  }
  return {
    type: "queueable",
    operationId: operationId({
      qrToken: input.qrToken,
      scannedAt: input.scannedAt,
    }),
    message,
  };
}

/**
 * A SORBA TETEL EREDMENYE, ES A KET ESET KULON.
 *
 * A felhasznalo mindket esetben "elkuldte" a felvitelt. A kulonbseg csak a
 * valaszban latszik -- es ha nem latszik, egy elveszett felvitelt keresne
 * napokkal kesobb valaki mas.
 */
export type { QueueWriteOutcome };

export function describeQueueWrite(
  result: { ok: true; operationId: string } | { ok: false; error: string },
  checkMessage: string,
): QueueWriteOutcome {
  if (result.ok) {
    return {
      type: "queued",
      operationId: result.operationId,
      message: `A felvitel a telefonon vár feltöltésre. ${checkMessage}`,
    };
  }
  /**
   * A SORBA TETEL BUKASA NEM "ELMENTVE". Ez a keszulek tarolojanak hibaja
   * (tele lemez, serult adatbazis), es ilyenkor a felvitel SEHOL nem letezik --
   * sem a szerveren, sem a telefonon. Ha ugyanazt a zold uzenetet adnank, a
   * kollega tovabbmenne, es az eszkoz egyszeruen nem lenne meg.
   */
  return {
    type: "queue-failed",
    message:
      `A felvitelt NEM sikerült elmenteni a telefonra (${result.error}). ` +
      "Ez a rögzítés elveszett: próbáld újra, és ha ismétlődik, szólj.",
  };
}
