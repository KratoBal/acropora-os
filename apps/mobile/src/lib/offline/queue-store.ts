import { initializeOfflineDatabase } from "./database";
import { readPhotoPayload, type PhotoPayload } from "./photo-queue";
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

/**
 * SORBA TESZ EGY FENYKEPET, EGY MEG FEL NEM MENT ROGZITESHEZ.
 *
 * UGYANAZ A TABLA, MASIK `operation` -- a ket menet sorrendjet a
 * `photo-queue.ts` `nextBatch` adja, nem a tabla szerkezete.
 *
 * AZ `entity_id` ITT SZANDEKOSAN `NULL`: a szerver-oldali eszkoz-azonosito a
 * rogzites felmenetelekor keletkezik, es a kep sorba tetelekor MEG NEM
 * LETEZIK. Azt a `attachRecordingResult` irja ra kesobb, es amig nincs ott, a
 * kepet nincs is HOVA felkuldeni.
 */
export async function enqueueAssetPhoto(input: {
  id: string;
  payload: PhotoPayload;
  createdAt: string;
}): Promise<EnqueueResult> {
  try {
    const db = await initializeOfflineDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO sync_queue
         (id, operation, entity_type, entity_id, payload_json, created_at, attempt_count, last_error, state)
       VALUES (?, 'upload-photo', 'asset', NULL, ?, ?, 0, NULL, 'pending')`,
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

/**
 * A ROGZITES FELMENT: A HOZZA TARTOZO KEPEK MEGKAPJAK A SZERVER AZONOSITOT.
 *
 * EZ AZ EGYETLEN HELY, AHOL A KET MENET OSSZEER. A rogzites sora a nyugtazas
 * utan torlodik, tehat ha ez a lepes elmarad, a kepek OROKRE cimzetlenul
 * maradnak: nem hibaznak, nem akadnak el, egyszeruen sosem mennek fel -- es a
 * sor kozben "kiurul" a rogzitesektol.
 *
 * A PAROSITAS JS-BEN MEGY, NEM SQL-BEN: a `payload_json`-bol kellene
 * `json_extract`-tel kiszedni a rogzites azonositojat, es azzal a lekerdezes
 * az SQLite JSON1 kiterjesztesetol fuggne. Nehany varakozo sorrol van szo,
 * tehat az olvasas ara elhanyagolhato, a fuggese viszont nem.
 *
 * @returns hany kep kapta meg az azonositot.
 */
export async function attachRecordingResult(
  recordingOperationId: string,
  assetId: string,
): Promise<number> {
  const db = await initializeOfflineDatabase();
  const rows = await db.getAllAsync<{ id: string; payload_json: string }>(
    `SELECT id, payload_json FROM sync_queue
      WHERE operation = 'upload-photo' AND entity_id IS NULL`,
  );
  let erintett = 0;
  for (const row of rows) {
    const payload = readPhotoPayload(row.payload_json);
    if (payload?.recordingOperationId !== recordingOperationId) continue;
    await db.runAsync(`UPDATE sync_queue SET entity_id = ? WHERE id = ?`, [
      assetId,
      row.id,
    ]);
    erintett += 1;
  }
  return erintett;
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
  return rows.filter(ismertMuvelet).map((r) => ({
    id: r.id,
    operation: r.operation as SyncQueueRow["operation"],
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

/**
 * Hany sor var, es hany akadt el. A felulet ebbol mondja meg, mi van hatra.
 *
 * A VARAKOZOK KETFELE BONTVA IS MEGJONNEK (`recordings`, `photos`), es ez nem
 * kenyelmi bontas: egy sor, ami kiurult a ROGZITESEKTOL, "sikeres
 * szinkronnak" latszik, mikozben csak kepek maradtak benne. A `pending` a
 * kettot EGYUTT szamolja, tehat a ket szamot NEM szabad egymas melle irni --
 * a `describeQueueBacklog` epp ezert nem hasznalja a `pending` erteket.
 */
export async function queueCounts(): Promise<{
  pending: number;
  conflict: number;
  recordings: number;
  photos: number;
}> {
  const db = await initializeOfflineDatabase();
  const rows = await db.getAllAsync<{
    state: string;
    operation: string;
    db: number;
  }>(
    `SELECT state, operation, COUNT(*) AS db FROM sync_queue
      GROUP BY state, operation`,
  );
  const szam = (allapotok: string[], muvelet?: string) =>
    rows
      .filter(
        (r) =>
          allapotok.includes(r.state) &&
          (muvelet === undefined || r.operation === muvelet),
      )
      .reduce((sum, r) => sum + r.db, 0);
  // A `syncing` a VARAKOZOKHOZ szamit: elindult, de meg nem ert celba, es a
  // kollega szempontjabol ugyanugy "meg nem ment fel".
  const varakozo = ["pending", "failed", "syncing"];
  return {
    pending: szam(varakozo),
    conflict: szam(["conflict"]),
    recordings: szam(varakozo, "create"),
    photos: szam(varakozo, "upload-photo"),
  };
}

/**
 * CSAK AZT KULDJUK EL, AMIT ISMERUNK.
 *
 * A muvelet nevet eddig `"create"`-re ALLITOTTUK a beolvasasnal, nem olvastuk:
 * amig egyfele sor volt, ez igaz is volt. Egy `upload-photo` sor viszont igy
 * rogzitesnek latszott volna, es a szinkron egy KEP payloadjaval hivta volna a
 * felviteli vegpontot -- a hiba a SZERVEREN jelent volna meg, egy ertelmetlen
 * elutasitaskent.
 *
 * Az ISMERETLEN muveletet nem toroljuk es nem is talalgatjuk: a sorban marad
 * (egy ujabb valtozat irhatta oda), csak nem kuldjuk el.
 */
function ismertMuvelet(row: { operation: string }): boolean {
  return row.operation === "create" || row.operation === "upload-photo";
}
