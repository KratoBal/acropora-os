import { initializeOfflineDatabase } from "./database";
import type { SyncQueueRow, SyncState } from "./sync-queue";

/**
 * A SOR ÍRÁSA ÉS OLVASÁSA. Ez az a réteg, ami eddig hiányzott: a döntések
 * megvoltak (`sync-queue.ts`, `queue-drain.ts`, `queue-runner.ts`), de senki
 * nem nyúlt a táblához.
 *
 * === EGY DOLOGBAN ELTÉR AZ `asset-cache.ts`-TŐL, ÉS EZ SZÁNDÉKOS ===
 *
 * Ott az írás hibáját ELNYELJÜK: egy elhasalt gyorsítótár-mentés nem ronthat el
 * egy működő, online képernyőt, mert a másolat kényelem, nem bizonyíték.
 *
 * ITT FORDÍTVA. Ez a sor a felvitel EGYETLEN létező példánya: ha a beszúrás
 * elbukik és elnyeljük, a kolléga „elmentve" üzenetet lát, és a rögzítés SEHOL
 * nem létezik. Ezért az `enqueue` a hibát VISSZAADJA, és a hívó mondja meg a
 * kollégának, hogy a felvitel elveszett (`describeQueueWrite`).
 */

const KULDHETO: SyncState[] = ["pending", "failed"];

export interface EnqueueInput {
  /** A KLIENS-generalt muvelet-azonosito (`operationId`). */
  id: string;
  payload: unknown;
  createdAt: string;
}

export type EnqueueResult =
  { ok: true; operationId: string } | { ok: false; error: string };

/**
 * SORBA TESZ EGY FELVITELT.
 *
 * `INSERT OR IGNORE`: ugyanaz a muvelet-azonosito ketszer NEM hiba es NEM
 * masodik sor. A ketszer megnyomott gomb ugyanazt a kulcsot adja (a kulcs a
 * tartalombol szuletik), tehat a masodik beszuras csendben elesik -- es ez a
 * KIVANT viselkedes, nem egy elnyelt hiba.
 */
export async function enqueueAssetCreate(
  input: EnqueueInput,
): Promise<EnqueueResult> {
  try {
    const db = await initializeOfflineDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO sync_queue
         (id, operation, entity_type, entity_id, payload_json, created_at, attempt_count, last_error, state)
       VALUES (?, 'create', 'asset', NULL, ?, ?, 0, NULL, 'pending')`,
      [input.id, JSON.stringify(input.payload), input.createdAt],
    );
    return { ok: true, operationId: input.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Amit el LEHET kuldeni: a `pending` es a `failed` sorok, regi elore. */
export async function pendingQueueRows(): Promise<SyncQueueRow[]> {
  const db = await initializeOfflineDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    operation: string;
    entity_type: string;
    entity_id: string | null;
    payload_json: string;
    created_at: string;
    attempt_count: number;
    last_error: string | null;
    state: string;
  }>(
    `SELECT * FROM sync_queue
      WHERE state IN (${KULDHETO.map(() => "?").join(", ")})
      ORDER BY created_at ASC`,
    KULDHETO,
  );
  return rows.map((r) => ({
    id: r.id,
    operation: "create",
    entityType: "asset",
    entityId: r.entity_id,
    payloadJson: r.payload_json,
    createdAt: r.created_at,
    attemptCount: r.attempt_count,
    lastError: r.last_error,
    state: r.state as SyncState,
  }));
}

/** A szerver nyugtazta: a helyi bizonyitek mehet. CSAK ilyenkor. */
export async function removeQueueRow(id: string): Promise<void> {
  const db = await initializeOfflineDatabase();
  await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
}

export async function markQueueRetry(
  id: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const db = await initializeOfflineDatabase();
  await db.runAsync(
    `UPDATE sync_queue SET state = 'failed', attempt_count = ?, last_error = ? WHERE id = ?`,
    [attemptCount, lastError, id],
  );
}

export async function markQueueConflict(
  id: string,
  lastError: string,
): Promise<void> {
  const db = await initializeOfflineDatabase();
  await db.runAsync(
    `UPDATE sync_queue SET state = 'conflict', last_error = ? WHERE id = ?`,
    [lastError, id],
  );
}

/** Hany sor var, es hany akadt el. A felulet ebbol mondja meg, mi van hatra. */
export async function queueCounts(): Promise<{
  pending: number;
  conflict: number;
}> {
  const db = await initializeOfflineDatabase();
  const rows = await db.getAllAsync<{ state: string; db: number }>(
    `SELECT state, COUNT(*) AS db FROM sync_queue GROUP BY state`,
  );
  const szam = (allapotok: string[]) =>
    rows
      .filter((r) => allapotok.includes(r.state))
      .reduce((sum, r) => sum + r.db, 0);
  return {
    // A `syncing` a VARAKOZOKHOZ szamit: elindult, de meg nem ert celba, es a
    // kollega szempontjabol ugyanugy "meg nem ment fel".
    pending: szam(["pending", "failed", "syncing"]),
    conflict: szam(["conflict"]),
  };
}
