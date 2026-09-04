import {
  mergeQueuedAssetUpdate,
  readQueuedAssetUpdate,
  type QueuedAssetUpdate,
} from "./asset-update-queue";
import { initializeOfflineDatabase } from "./database";
import { readPhotoPayload, type PhotoPayload } from "./photo-queue";
import {
  isSyncEntityType,
  type SyncQueueRow,
  type SyncState,
} from "./sync-queue";

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
 * EGY ELAKADT FELVITEL JAVITASA ES UJRAKULDESE.
 *
 * A DONTES a `queue-resend.ts`-ben all (melyik sor javithato, es mit valtoztat
 * az ujrakuldes) -- ez a fuggveny csak vegrehajt.
 *
 * A `WHERE` NEM CSAK AZ AZONOSITOT NEZI, HANEM AZ ALLAPOTOT IS, es ez nem
 * ovintezkedes-izles: a kepernyo es ez az iras kozott eltelik ido, es a sor
 * kozben elindulhat (`syncing`) egy masik kiuritessel. Ha csak az azonositora
 * irnank, egy epp UTON LEVO felvitel torzset irnank at -- a szerver a regit
 * kapja meg, a keszuleken pedig az uj all, es a ketto kozul az egyik nemán
 * elveszik.
 *
 * A visszaadott darabszam mondja meg, tortent-e valami: nulla annyit tesz,
 * hogy a sor kozben elmozdult, es a hivonak ujra kell olvasnia.
 */
export async function applyQueueResend(
  id: string,
  patch: { payloadJson: string; attemptCount: number; lastError: null },
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  try {
    const db = await initializeOfflineDatabase();
    const result = await db.runAsync(
      `UPDATE sync_queue
          SET payload_json = ?, state = 'pending', attempt_count = ?, last_error = NULL
        WHERE id = ? AND state = 'conflict'`,
      [patch.payloadJson, patch.attemptCount, id],
    );
    return { ok: true, changed: result.changes };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * EGY ELAKADT FELVITEL ELVETESE.
 *
 * A DONTES es a megerosites szovege a `queue-discard.ts`-ben all -- ez a
 * fuggveny csak vegrehajt.
 *
 * NEM `DELETE`, HANEM `UPDATE`. Ha a sor eltunne, az kivulrol
 * megkulonboztethetetlen lenne attol, mintha sikeresen kiment volna: ugyanaz a
 * felvitel hianyzik a szerverrol, es senki nem tudna megmondani, hogy
 * elvetettek-e vagy elveszett. Az allapot maga a nyom, es a torzs meg a
 * hibauzenet ott marad mellette.
 *
 * A `WHERE` AZ ALLAPOTRA IS SZUR, ugyanabbol az okbol, mint a javitasnal: a
 * keperno es az iras kozott a sor elindulhat egy masik kiuritessel, es egy
 * EPP FELMENO felvitelt nem szabad elvetettnek jelolni -- a szerveren letre
 * jonne, a telefonon elvetettkent allna, es a ketto egymasnak mondana ellent.
 *
 * A nulla mozdult sor NEM siker: a hivo mondja meg, hogy a sor kozben
 * elmozdult.
 */
export async function discardQueueRow(
  id: string,
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  try {
    const db = await initializeOfflineDatabase();
    const result = await db.runAsync(
      `UPDATE sync_queue SET state = 'discarded'
        WHERE id = ? AND state = 'conflict'`,
      [id],
    );
    return { ok: true, changed: result.changes };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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
 * SORBA TESZ EGY ESZKOZ-MODOSITAST -- ES OSSZEFESUL, HA MAR ALL OTT EGY.
 *
 * === MIERT NEM `INSERT OR IGNORE`, MINT A HAROM FELVITELNEL ===
 *
 * A felvitelnel az azonos kulcsu masodik sor ugyanaz a felvitel, tehat a
 * csendes elejtes a KIVANT viselkedes. A modositasnal nem: ugyanarrol a
 * verziorol ket kulon szerkesztes ket kulon MEZOT allithat at, es az `IGNORE`
 * a masodikat nyelne el -- a szerelo "elmentve" uzenetet latna, es a javitasa
 * sehol nem lenne. Ezert a torzsek osszefesulnek
 * (`mergeQueuedAssetUpdate`), es a kesobbi ertek nyer mezonkent.
 *
 * === AZ ALLAPOT-FELTETEL AZ `UPDATE`-EN NEM OVINTEZKEDES-IZLES ===
 *
 * Ugyanaz az ok, mint a javitasnal es az elvetesnel: a kepernyo es ez az iras
 * kozott a sor elindulhat egy masik kiuritessel (`syncing`). Egy epp UTON LEVO
 * torzs atirasa azt jelentene, hogy a szerver a REGIT kapja meg, a keszuleken
 * pedig az uj all -- es a ketto kozul az egyik nemán elveszik.
 *
 * Ezert ha a sor kozben elmozdult, ez a fuggveny NEM ir, hanem HIBAT AD, es a
 * kepernyo mondja meg a szerelonek, hogy probalja ujra. Egy elmaradt mentes,
 * amirol tud, jobb, mint egy elveszett, amirol nem.
 */
export async function enqueueAssetUpdate(input: {
  /** A muvelet kulcsa: `assetUpdateOperationId`. */
  id: string;
  /** A MODOSITOTT eszkoz szerver-oldali azonositoja. Mar letezik. */
  assetId: string;
  payload: QueuedAssetUpdate;
  createdAt: string;
}): Promise<EnqueueResult> {
  try {
    const db = await initializeOfflineDatabase();
    const letezo = await db.getFirstAsync<{
      payload_json: string;
      state: string;
    }>(`SELECT payload_json, state FROM sync_queue WHERE id = ?`, [input.id]);

    if (!letezo) {
      await db.runAsync(
        `INSERT INTO sync_queue
           (id, operation, entity_type, entity_id, payload_json, created_at, attempt_count, last_error, state)
         VALUES (?, 'update', 'asset', ?, ?, ?, 0, NULL, 'pending')`,
        [
          input.id,
          input.assetId,
          JSON.stringify(input.payload),
          input.createdAt,
        ],
      );
      return { ok: true, operationId: input.id };
    }

    if (letezo.state !== "pending" && letezo.state !== "failed")
      return {
        ok: false,
        error: `az előző módosítás állapota most: ${letezo.state}`,
      };

    /**
     * AZ OLVASHATATLAN ELOZO TORZS NEM VESZHET EL CSENDBEN. Ha nem tudjuk
     * ertelmezni, nem "fesuljuk ossze" ures alapon: az pontosan az a felulras
     * lenne, ami ellen ez az ag szol.
     */
    const elozo = readQueuedAssetUpdate(letezo.payload_json);
    if (elozo === null)
      return {
        ok: false,
        error: "az előző módosítás törzse olvashatatlan",
      };

    const osszefesult = mergeQueuedAssetUpdate(elozo, input.payload);
    const result = await db.runAsync(
      `UPDATE sync_queue
          SET payload_json = ?, created_at = ?, state = 'pending', attempt_count = 0, last_error = NULL
        WHERE id = ? AND state IN ('pending', 'failed')`,
      [JSON.stringify(osszefesult), input.createdAt, input.id],
    );
    if (result.changes === 0)
      return {
        ok: false,
        error: "az előző módosítás közben elindult a feltöltés",
      };
    return { ok: true, operationId: input.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * SORBA TESZ EGY MUNKALAPOT.
 *
 * UGYANAZ A TABLA, MAS ENTITAS. A kulcs a tartalombol szuletik
 * (`worksheetOperationId`), es ugyanez a kulcs megy fel a szervernek is
 * `clientOperationId` neven -- tehat egy megszakadt kuldes ujrakuldese a
 * MEGLEVO lapot adja vissza, nem masodikat hoz letre.
 */
export async function enqueueWorksheetCreate(
  input: EnqueueInput,
): Promise<EnqueueResult> {
  try {
    const db = await initializeOfflineDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO sync_queue
         (id, operation, entity_type, entity_id, payload_json, created_at, attempt_count, last_error, state)
       VALUES (?, 'create', 'worksheet', NULL, ?, ?, 0, NULL, 'pending')`,
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
 * SORBA TESZ EGY TETELT EGY MAR LETEZO MUNKALAPRA.
 *
 * === AMIBEN ELTER A MASIK KETTOTOL: A GAZDA MAR MEGVAN ===
 *
 * Az eszkoznel es a munkalapnal az `entity_id` `NULL`, mert a szerver-oldali
 * azonosito csak a felmenetelkor keletkezik. ITT FORDITVA: tetelt csak MEGLEVO
 * lapra lehet felvenni, tehat a lap azonositoja mar a sorba tetelkor ismert, es
 * a sor ezt hordozza. A kuldes ebbol tudja, MELYIK lap sor-vegpontjara menjen.
 *
 * === A SOR AZONOSITOJA MAGA A TETEL AZONOSITOJA ===
 *
 * Nem ket kulcs: a `worksheetLineId` egyszer keletkezik, es ugyanaz megy a
 * sorba kulcskent ES a szerverre a tetel `id` mezojekent. A szerver erre
 * IDEMPOTENS (`alreadyPresent`): ha a valasz elveszett es a sor ujrakuld, a
 * MEGLEVO tetelt talalja meg, nem masodikat hoz letre. Ket kulon kulcs mellett
 * epp ez a vedelem esne ki.
 */
export async function enqueueWorksheetLine(input: {
  /** A tetel azonositoja, egyben a sor kulcsa. */
  id: string;
  /** A GAZDA lap szerver-oldali azonositoja. Mar letezik. */
  worksheetId: string;
  payload: unknown;
  createdAt: string;
}): Promise<EnqueueResult> {
  try {
    const db = await initializeOfflineDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO sync_queue
         (id, operation, entity_type, entity_id, payload_json, created_at, attempt_count, last_error, state)
       VALUES (?, 'create', 'worksheet-line', ?, ?, ?, 0, NULL, 'pending')`,
      [
        input.id,
        input.worksheetId,
        JSON.stringify(input.payload),
        input.createdAt,
      ],
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
export async function enqueuePhoto(input: {
  id: string;
  payload: PhotoPayload;
  createdAt: string;
  /**
   * MIHEZ TARTOZIK A KEP. A sor ebbol tudja, MELYIK vegpontra kell kuldeni:
   * eszkoz-dokumentum vagy munkalap-dokumentum. Nem uj mezo a payloadban --
   * a sor mar hordozza a gazdat, es ket helyen tarolva a ketto elcsuszhatna.
   */
  entityType: SyncQueueRow["entityType"];
}): Promise<EnqueueResult> {
  try {
    const db = await initializeOfflineDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO sync_queue
         (id, operation, entity_type, entity_id, payload_json, created_at, attempt_count, last_error, state)
       VALUES (?, 'upload-photo', ?, NULL, ?, ?, 0, NULL, 'pending')`,
      [
        input.id,
        input.entityType,
        JSON.stringify(input.payload),
        input.createdAt,
      ],
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
    last_attempt_at: string | null;
    state: string;
  }>(
    `SELECT * FROM sync_queue
      WHERE state IN (${KULDHETO.map(() => "?").join(", ")})
      ORDER BY created_at ASC`,
    KULDHETO,
  );
  return rows.filter(ismertSor).map((r) => ({
    id: r.id,
    operation: r.operation as SyncQueueRow["operation"],
    entityType: r.entity_type as SyncQueueRow["entityType"],
    entityId: r.entity_id,
    payloadJson: r.payload_json,
    createdAt: r.created_at,
    attemptCount: r.attempt_count,
    lastError: r.last_error,
    lastAttemptAt: r.last_attempt_at,
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
    /**
     * AZ IDOPONT IS FELKERUL, ES E NELKUL A VARAKOZTATAS NEM LETEZIK. Az
     * `attempt_count` megmondja, HANYSZOR probaltuk; a varakoztatashoz azt kell
     * tudni, MIKOR volt az utolso.
     */
    `UPDATE sync_queue
        SET state = 'failed', attempt_count = ?, last_error = ?, last_attempt_at = ?
      WHERE id = ?`,
    [attemptCount, lastError, new Date().toISOString(), id],
  );
}

/**
 * A SZERVER SOKADSZORRA IS HIBAT ADOTT: A SOR MEGALL, ES EMBERRE VAR.
 *
 * NEM torles: a felvitel egyetlen letezo peldanya tovabbra is a keszuleken van.
 * Es nem `conflict`: ott a FELVITELT kell javitani, itt a szerverrel van baj --
 * a felulet a ket esetrol mast mond.
 */
export async function markQueueStalled(
  id: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const db = await initializeOfflineDatabase();
  await db.runAsync(
    `UPDATE sync_queue
        SET state = 'stalled', attempt_count = ?, last_error = ?, last_attempt_at = ?
      WHERE id = ?`,
    [attemptCount, lastError, new Date().toISOString(), id],
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
  stalled: number;
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
    /**
     * A MEGALLT SOROK KULON SZAMBAN: nem varakoznak (nem indulnak el maguktol)
     * es nem is elutasitottak. Ha a `pending` alatt allnanak, a felulet azt
     * mondana rolok, hogy fel fognak menni.
     */
    stalled: szam(["stalled"]),
    recordings: szam(varakozo, "create"),
    photos: szam(varakozo, "upload-photo"),
  };
}

/**
 * HANY TETEL VAR MEG FELTOLTESRE EGY ADOTT LAPHOZ.
 *
 * A MONDAT a `worksheet-line.ts`-ben all (`describeQueuedWorksheetLines`), ez
 * csak a szam. A `discarded` sorok KIMARADNAK: azokat a szerelo eldobta, es
 * nem fognak felmenni -- egy kozos szamban a lapon ugy latszananak, mintha meg
 * varnanak.
 */
export async function queuedWorksheetLineCount(
  worksheetId: string,
): Promise<number> {
  const db = await initializeOfflineDatabase();
  const row = await db.getFirstAsync<{ db: number }>(
    `SELECT COUNT(*) AS db FROM sync_queue
      WHERE operation = 'create' AND entity_type = 'worksheet-line'
        AND entity_id = ? AND state <> 'discarded'`,
    [worksheetId],
  );
  return row?.db ?? 0;
}

/**
 * CSAK AZT KULDJUK EL, AMIT ISMERUNK -- ES EZ KET MEZORE ALL.
 *
 * A muvelet nevet eddig `"create"`-re, az entitast `"asset"`-re ALLITOTTUK a
 * beolvasasnal, nem olvastuk. Amig egyfele sor volt, mind a ketto igaz is volt.
 * Egy `upload-photo` sor igy rogzitesnek latszott volna, egy MUNKALAP sor pedig
 * eszkoznek -- es a szinkron a munkalap payloadjaval hivta volna az ESZKOZ
 * vegpontjat. A hiba a SZERVEREN jelent volna meg, ertelmetlen elutasitaskent.
 *
 * Az ISMERETLENT nem toroljuk es nem talalgatjuk: a sorban marad (egy ujabb
 * valtozat irhatta oda), csak nem kuldjuk el.
 */
function ismertSor(row: { operation: string; entity_type: string }): boolean {
  const muvelet =
    row.operation === "create" ||
    row.operation === "update" ||
    row.operation === "upload-photo";
  /**
   * AZ ISMERT FAJTAK LISTAJA A `sync-queue.ts`-BEN ALL, NEM ITT.
   *
   * Korabban ez a sor sajat felsorolast vezetett (`=== "asset" || ===
   * "worksheet"`), es ez a szures NEMA: egy uj fajta bekerult volna a tipusba,
   * a fordito hallgatott volna, es a sorai innen CSENDBEN kiestek volna --
   * sem a kuldesbe, sem a listaba nem jutnak be, tehat a felvitel ugy tunt
   * volna el, mintha soha nem is lett volna.
   */
  return muvelet && isSyncEntityType(row.entity_type);
}

/**
 * HANY KISERLET UTAN MONDJUK KI, HOGY EZ A TETEL ISMETELTEN ELBUKIK.
 *
 * A HATAR NEM IDO, HANEM ESEMENY, es ezert alacsony. A kiuritest a kezdolap
 * inditja: egy kiserlet nagyjabol egy app-indulas vagy egy offline-online
 * atmenet. Harom kiserlet tehat HAROM KULON alkalom, amikor volt halozat es
 * megsem ment fel -- az mar nem "eppen nincs terero".
 *
 * EZ CSAK A KIMONDAS HATARA. Nem allit meg semmit: a felso hatar es a backoff
 * kulon szelet (cde22311), mas kockazattal.
 */
export const ISMETLODO_HIBA_HATAR = 3;

export interface RepeatedFailures {
  /** Hany varakozo sor bukott el legalabb a hatarnyi alkalommal. */
  rows: number;
  /** A legtobbszor probalt sor kiserletszama. */
  maxAttempts: number;
  /** Annak a sornak az utolso hibaja. `null`, ha nincs ilyen sor. */
  lastError: string | null;
}

/**
 * AZ ISMETELTEN ELBUKO SOROK -- AZ AZ ADAT, AMI EDDIG IROTT, DE OLVASATLAN VOLT.
 *
 * Az `attempt_count` mezot a sor minden bukasnal noveli, a `last_error` mezobe
 * beirja a hibat, es 2026-09-03-ig EGYIKET SEM olvasta senki. Emiatt egy tetel,
 * ami SOSEM fog atmenni, a telefonon PONTOSAN ugyanugy nezett ki, mint az, ami
 * csak terero nelkul var.
 *
 * A `conflict` sorok KIMARADNAK: azoknak mar van sajat mondatuk (a szerver
 * elutasitotta, ember kell hozza), es ket mondat ugyanarrol a sorrol azt
 * sugallna, hogy ket kulon baj van.
 */
export async function repeatedFailures(
  threshold: number = ISMETLODO_HIBA_HATAR,
): Promise<RepeatedFailures> {
  const db = await initializeOfflineDatabase();
  const rows = await db.getAllAsync<{
    attempt_count: number;
    last_error: string | null;
  }>(
    `SELECT attempt_count, last_error FROM sync_queue
      WHERE state IN ('pending', 'failed', 'syncing') AND attempt_count >= ?
      ORDER BY attempt_count DESC`,
    [threshold],
  );
  const elso = rows[0];
  return {
    rows: rows.length,
    maxAttempts: elso?.attempt_count ?? 0,
    lastError: elso?.last_error ?? null,
  };
}

/**
 * A SOR MINDEN SORA, ALLAPOTTOL FUGGETLENUL -- A LISTANAK, NEM A KULDESNEK.
 *
 * A `pendingQueueRows` SZANDEKOSAN szur (csak amit el LEHET kuldeni). Ez a
 * fuggveny az ellenkezoje: a szerelo epp azokat akarja latni, amik NEM mennek
 * -- a megallt es az elakadt sorokat.
 *
 * A `syncing` is bekerul: az elindult, es a kollega szempontjabol ugyanugy
 * „meg nem ment fel".
 */
export async function allQueueRows(): Promise<SyncQueueRow[]> {
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
    last_attempt_at: string | null;
    state: string;
  }>(`SELECT * FROM sync_queue ORDER BY created_at ASC`);
  return rows.filter(ismertSor).map((r) => ({
    id: r.id,
    operation: r.operation as SyncQueueRow["operation"],
    entityType: r.entity_type as SyncQueueRow["entityType"],
    entityId: r.entity_id,
    payloadJson: r.payload_json,
    createdAt: r.created_at,
    attemptCount: r.attempt_count,
    lastError: r.last_error,
    lastAttemptAt: r.last_attempt_at,
    state: r.state as SyncState,
  }));
}

/**
 * KEZI UJRAPROBALAS: A MEGALLT SOR VISSZAKERUL A VARAKOZOK KOZE.
 *
 * A KISERLETSZAM NULLAZODIK, es ez nem kozmetika: e nelkul a nyolcas hatar a
 * kovetkezo bukasnal AZONNAL ujra elsulne, es a gomb semmit nem erne. A kezi
 * ujraprobalas azt jelenti, hogy egy EMBER azt mondja: a szerver rendben van.
 *
 * A varakoztatas belyege is torlodik, kulonben a sor a felórás backoff vegeig
 * meg akkor sem indulna el, amikor a szerelo epp most kerte.
 *
 * A `last_error` MEGMARAD: a lista tovabbra is mutassa, mi volt a baj, amig az
 * ujrakuldes eredmenye meg nem erkezik.
 */
export async function retryQueueRow(id: string): Promise<void> {
  const db = await initializeOfflineDatabase();
  await db.runAsync(
    `UPDATE sync_queue
        SET state = 'pending', attempt_count = 0, last_attempt_at = NULL
      WHERE id = ?`,
    [id],
  );
}
