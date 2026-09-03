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

export interface QueueRunnerDeps {
  /** A sorbol azok, amiket EL LEHET kuldeni. */
  pendingRows(): Promise<SyncQueueRow[]>;
  /** Elkuldi a sort a szervernek. A HTTP kod `null`, ha el sem jutott oda. */
  send(
    row: SyncQueueRow,
  ): Promise<{ httpStatus: number | null; error: string | null }>;
  /** A szerver nyugtazta: a helyi bizonyitek mehet. */
  remove(id: string): Promise<void>;
  /** A sor marad, uj kiserletszammal es hibaval. */
  markRetry(id: string, attemptCount: number, lastError: string): Promise<void>;
  /** A sor marad, es emberre var. */
  markConflict(id: string, lastError: string): Promise<void>;
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
  };

  for (const row of rows) {
    const { httpStatus, error } = await deps.send(row);
    const outcome = decideDrain({ row, httpStatus, errorMessage: error });
    switch (outcome.type) {
      case "done":
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
    }
  }
  return report;
}
