import { decideDrain } from "./queue-drain";
import type { SyncQueueRow } from "./sync-queue";

/**
 * A SOR VEGIGJARASA, ES AMI EBBEN A LEGKONNYEBBEN ELROMLIK: A JELENTES.
 *
 * === EGY FUTAS SIKERE NEM AZ, HOGY LEFUTOTT ===
 *
 * Ha egy kiurites NULLA sort mozdit, az KET dolgot jelenthet:
 *
 *   nem volt mit         -> ures a sor, minden rendben
 *   volt, de nem ment    -> a felvitelek allnak, es a kollega ezt nem tudja
 *
 * A ketto ugyanugy nez ki egy "lefutott" uzenetbol, es a masodik a dragabb: a
 * telefonon a felvitel MAR sikeresnek latszott. Ezert ez a modul nem azt adja
 * vissza, hogy megtortent, hanem azt, hogy MI VALTOZOTT -- es a ket eset kulon
 * mezoben all, nem egy szamban.
 */

export interface QueueRunReport {
  /** Hany sort NEZTUNK MEG. Nulla = nem volt mit tenni. */
  attempted: number;
  /** Hany ment fel es tunt el a sorbol. */
  done: number;
  /** Hany marad, kesobbi ujraprobalasra. */
  retried: number;
  /** Hany akadt el emberi dontesre varva. */
  conflicted: number;
  /**
   * HANY ALLT MEG, MERT A SZERVER SOKADSZORRA IS HIBAT ADOTT.
   *
   * Kulon a `conflicted`-tol: ott a FELVITELT kell javitani, itt a szerverrel
   * van baj. A ket szam osszevonasa a szerelot a sajat adata javitasara
   * kuldene egy szerver-hiba miatt.
   */
  stalled: number;
  /**
   * HANY ROGZITES MENT FEL UGY, HOGY A SZERVER AZONOSITOJA NEM JOTT VISSZA.
   *
   * Nem hiba es nem is siker: a rogzites FENT VAN, de a hozza tartozo kepeket
   * mar nincs mire cimezni. Egy sikeres futas jelenteseben ez a szam az
   * egyetlen jel arrol, hogy a fenykepek soha nem fognak felmenni -- ezert all
   * kulon mezoben, nem a `done`-ban elrejtve.
   */
  unresolved: number;
}

/**
 * A JELENTES EMBERI ALAKJA, ES A HAROM ESET KULON.
 *
 * `null` CSAK akkor, ha nem volt mit tenni ES nincs is mire varni -- olyankor a
 * felulet marad csendben.
 */
export function describeQueueRun(report: QueueRunReport): string | null {
  if (report.attempted === 0) return null;
  if (report.done === report.attempted) {
    return `Minden várakozó felvitel felment (${report.done}).`;
  }
  if (report.done === 0) {
    /**
     * EZ AZ AG A LENYEG. Volt mit felkuldeni, es SEMMI nem ment fel. Egy
     * "lefutott" uzenet itt hazudna: a kollega azt hinne, hogy a sor kiurult.
     */
    return (
      `Egyetlen felvitel sem ment fel a ${report.attempted} várakozóból. ` +
      (report.conflicted > 0
        ? `${report.conflicted} elakadt, ezekhez döntés kell.`
        : "A telefon nem érte el a szervert.")
    );
  }
  return (
    `${report.done} felvitel felment, ${report.attempted - report.done} maradt` +
    (report.conflicted > 0 ? `, ebből ${report.conflicted} elakadt.` : ".")
  );
}

/**
 * A MEGALLT FELVITELEK KIMONDASA, KULON MONDATBAN.
 *
 * `null`, ha nincs ilyen. Azert nem folyik bele a futas mondataba, mert az a
 * FUTASROL szol (mi ment fel most), ez pedig egy MARADO allapotrol: ezek a
 * sorok a kovetkezo futasban SEM indulnak el maguktol.
 */
export function describeStalled(report: QueueRunReport): string | null {
  if (report.stalled === 0) return null;
  return (
    `${report.stalled} felvitel megállt: a szerver többször hibát adott. ` +
    "A rögzítés megvan a telefonon, de segítség kell hozzá."
  );
}

/**
 * A CIMZETLEN KEPEK KIMONDASA, KULON MONDATBAN.
 *
 * `null`, ha nincs ilyen. Azert nem folyik bele a fenti mondatba, mert az a
 * FUTASROL szol (mi ment fel most), ez pedig egy MARADO allapotrol: ezek a
 * kepek a kovetkezo futasban sem fognak felmenni, mert nincs hova.
 */
export function describeUnresolvedRecordings(
  report: QueueRunReport,
): string | null {
  if (report.unresolved === 0) return null;
  return (
    `${report.unresolved} rögzítés felment, de a szerver azonosítója nem jött ` +
    "vissza: a hozzájuk készült fényképeket nem tudjuk feltölteni."
  );
}

export interface QueueRunnerDeps {
  /** A sorbol azok, amiket EL LEHET kuldeni. */
  pendingRows(): Promise<SyncQueueRow[]>;
  /**
   * Elkuldi a sort a szervernek. A HTTP kod `null`, ha el sem jutott oda.
   *
   * AZ `entityId` A VARRAT. Egy sikeres felvitelnel a szerver visszaadja az uj
   * eszkoz azonositojat, es ez az EGYETLEN alkalom, amikor ezt latjuk: a sor a
   * nyugtazas utan torlodik. Ha itt eldobnank, a mar sorban allo fenykepeket
   * semmi nem tudna megcimezni.
   */
  send(row: SyncQueueRow): Promise<{
    httpStatus: number | null;
    error: string | null;
    entityId?: string | null;
  }>;
  /** A felment rogziteshez tartozo kepek megkapjak a szerver azonositojat. */
  attachRecording(operationId: string, entityId: string): Promise<void>;
  /** A szerver nyugtazta: a helyi bizonyitek mehet. */
  remove(id: string): Promise<void>;
  /** A sor marad, uj kiserletszammal es hibaval. */
  markRetry(id: string, attemptCount: number, lastError: string): Promise<void>;
  /** A sor marad, es emberre var. */
  markConflict(id: string, lastError: string): Promise<void>;
  /** A sor marad, megall, es emberre var -- de MASERT, mint a conflict. */
  markStalled(
    id: string,
    attemptCount: number,
    lastError: string,
  ): Promise<void>;
}

export async function drainQueue(
  deps: QueueRunnerDeps,
): Promise<QueueRunReport> {
  const rows = await deps.pendingRows();
  const report: QueueRunReport = {
    attempted: rows.length,
    done: 0,
    retried: 0,
    conflicted: 0,
    stalled: 0,
    unresolved: 0,
  };

  for (const row of rows) {
    const { httpStatus, error, entityId } = await deps.send(row);
    const outcome = decideDrain({ row, httpStatus, errorMessage: error });
    switch (outcome.type) {
      case "done":
        if (row.operation === "create") {
          /**
           * A PAROSITAS A TORLES ELOTT MEGY. A sor torlese utan a rogzites
           * muvelet-azonositoja mar sehol nem all, tehat a kepeket nem lehetne
           * mihez kotni -- es az a hiba CSENDES lenne: a sor kiurul, a
           * jelentes zold, a kepek maradnak.
           */
          if (entityId) await deps.attachRecording(row.id, entityId);
          else report.unresolved += 1;
        }
        await deps.remove(row.id);
        report.done += 1;
        break;
      case "retry":
        await deps.markRetry(row.id, outcome.attemptCount, outcome.lastError);
        report.retried += 1;
        break;
      case "conflict":
        await deps.markConflict(row.id, outcome.lastError);
        report.conflicted += 1;
        break;
      case "stalled":
        await deps.markStalled(row.id, outcome.attemptCount, outcome.lastError);
        report.stalled += 1;
        break;
    }
  }
  return report;
}
