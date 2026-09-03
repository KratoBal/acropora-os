import { batchForPass } from "./photo-queue";
import { isDueForRetry } from "./queue-drain";
import { drainQueue, type QueueRunReport } from "./queue-runner";
import {
  attachRecordingResult,
  markQueueConflict,
  markQueueRetry,
  markQueueStalled,
  pendingQueueRows,
  removeQueueRow,
} from "./queue-store";
import type { SyncQueueRow } from "./sync-queue";

/**
 * A FUTTATO ES A TAROLO OSSZEKOTESE -- ez a nehany sor volt a hianyzo lancszem.
 *
 * A `queue-runner.ts` INJEKTALT alakokkal dolgozik, hogy merheto legyen
 * adatbazis nelkul; a `queue-store.ts` az SQLite oldalt adja. Amig ez a fajl
 * nem letezett, MINDKETTO helyes volt onmagaban, es SENKI nem kotötte ossze --
 * pontosan az a szakadas-alak, amit ma tobbszor gyujtottunk.
 */

export interface DrainDeps {
  /** A felvitel elkuldese a szervernek. Kivulrol jon: itt nincs API-kliens. */
  send(row: SyncQueueRow): Promise<{
    httpStatus: number | null;
    error: string | null;
  }>;
}

/**
 * Vegigmegy a soron a VALODI tarolo folott.
 *
 * A `send` marad kivul: az API-kliens a keperno retegben el, es ha ide huznank,
 * ez a modul sem lenne merheto -- ugyanaz a hiba egy szinttel feljebb.
 */
export async function drainOfflineQueue(
  deps: DrainDeps,
): Promise<QueueRunReport> {
  /**
   * KET MENET, EGY SOR -- ES A MASODIK MENET UJRAOLVAS.
   *
   * Az elso menet a rogziteseket viszi. Kozben a `attachRecordingResult` a
   * kepek soraira felirja az uj szerver-azonositot -- vagyis az elso menet
   * ELOTT kiolvasott sorok mar ELAVULTAK: bennuk a kepek `entityId` mezoje meg
   * `null`. Ha a masodik menet ugyanazokbol dolgozna, minden kep gazdatlannak
   * latszana, es SOHA egy sem menne fel.
   *
   * Ezert a masodik menet friss olvasassal indul, es a `nextBatch` dont ujra:
   * ha maradt fel nem ment rogzites, a kepek megint varnak.
   */
  const elso = await egyMenet(deps, "create");
  const masodik = await egyMenet(deps, "upload-photo");
  return {
    attempted: elso.attempted + masodik.attempted,
    done: elso.done + masodik.done,
    retried: elso.retried + masodik.retried,
    conflicted: elso.conflicted + masodik.conflicted,
    stalled: elso.stalled + masodik.stalled,
    unresolved: elso.unresolved + masodik.unresolved,
  };
}

/**
 * EGY MENET: amit a `nextBatch` EPP most enged el.
 *
 * A futtato eddig KOZVETLENUL a tarolobol olvasott, tehat a ket menet szabalya
 * (`photo-queue.ts`) le volt irva, es senki nem kerdezte meg. Ez a fuggveny az
 * a hivas -- e nelkul a kepek a rogzitesekkel egyutt, sorrend nelkul indultak
 * volna el, es a szerver utasitotta volna el oket.
 */
function egyMenet(
  deps: DrainDeps,
  muvelet: SyncQueueRow["operation"],
): Promise<QueueRunReport> {
  return drainQueue({
    pendingRows: async () => {
      /**
       * A VARAKOZTATAS ITT SZUR, ES NEM IDOZITO.
       *
       * A kiuritest esemeny inditja (app-indulas, halozat visszaterese), tehat
       * nincs, ami kesobb visszajonne. Amit tenni lehet: a KOVETKEZO alkalommal
       * atugorjuk azt a sort, aminek az elozo kiserlete ota meg nem telt el
       * eleg ido. Igy egy sorozatosan bukó tetel nem indul el minden egyes
       * halozat-valtasnal ujra.
       */
      const most = new Date();
      const sorok = (await pendingQueueRows()).filter((row) =>
        isDueForRetry(row, most),
      );
      return batchForPass(sorok, muvelet);
    },
    send: deps.send,
    /**
     * A VISSZAADOTT SZAM ITT ELMARAD, es ez nem elnyelt hiba: a
     * `attachRecordingResult` azt mondja meg, HANY kep kapta meg az
     * azonositot, es a nulla a NORMALIS eset -- egy rogzites, amihez nem
     * keszult fenykep. A futtatonak nincs mit kezdenie vele.
     */
    attachRecording: async (operationId, entityId) => {
      await attachRecordingResult(operationId, entityId);
    },
    remove: removeQueueRow,
    markRetry: markQueueRetry,
    markConflict: markQueueConflict,
    markStalled: markQueueStalled,
  });
}
