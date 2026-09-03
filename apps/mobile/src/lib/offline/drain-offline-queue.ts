import { drainQueue, type QueueRunReport } from "./queue-runner";
import {
  markQueueConflict,
  markQueueRetry,
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
export function drainOfflineQueue(deps: DrainDeps): Promise<QueueRunReport> {
  return drainQueue({
    pendingRows: pendingQueueRows,
    send: deps.send,
    remove: removeQueueRow,
    markRetry: markQueueRetry,
    markConflict: markQueueConflict,
  });
}
