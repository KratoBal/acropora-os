import { describeQueueWrite, type QueueWriteOutcome } from "./offline-record";

/**
 * MENTES: ELOSZOR A SZERVERNEK, ES CSAK HALOZATI HIBANAL A SORBA.
 *
 * === MIERT EBBEN A SORRENDBEN ===
 *
 * Ha mindig sorba tennenk, egy terero melletti felvitel is varakozna, es a
 * kollega nem kapna vissza az eszkoz azonositojat -- pedig a szerver ott van.
 * Ha viszont csak online mentenenk, a pincében semmi nem menne.
 *
 * === ES AMI ITT A LEGKONNYEBBEN ELROMLIK ===
 *
 * Egy 4xx valasz NEM halozati hiba: a szerver valaszolt, es elutasitotta. Ha
 * azt is sorba tennenk, a hibas felvitel VEGTELENUL ujraprobalna magat, es a
 * kollega azt latna, hogy "var feltoltesre" -- holott soha nem fog atmenni.
 *
 * A sorba CSAK az kerul, amit a szerver MEG NEM LATOTT.
 */

export type SaveOutcome =
  /** A szerver elfogadta. Nincs sor, nincs varakozas. */
  | { type: "saved"; assetId: string }
  /** Nem ertuk el a szervert: a felvitel a sorban var. */
  | { type: "queued"; operationId: string; message: string }
  /** A sorba tetel is elbukott: a felvitel SEHOL nem letezik. */
  | { type: "lost"; message: string }
  /** A szerver VALASZOLT es elutasitotta. Nem sorbol valo. */
  | { type: "rejected"; message: string };

export interface SaveDeps {
  createAsset(): Promise<{ id: string }>;
  enqueue(): Promise<
    { ok: true; operationId: string } | { ok: false; error: string }
  >;
  /** A hibabol kiolvassa a HTTP kodot; `null`, ha el sem jutott a szerverig. */
  statusOf(error: unknown): number | null;
  /** A gyorsitotar-ellenorzes mondata, amit a sorba tetel valasza hordoz. */
  checkMessage: string;
}

export async function saveAssetOrQueue(deps: SaveDeps): Promise<SaveOutcome> {
  try {
    const created = await deps.createAsset();
    return { type: "saved", assetId: created.id };
  } catch (error) {
    const status = deps.statusOf(error);
    if (status !== null) {
      /**
       * A SZERVER VALASZOLT. Egy elutasitas nem lesz jobb attol, hogy sorba
       * tesszuk -- ugyanazt a valaszt adna ujra es ujra, es kozben a felulet
       * varakozast mutatna.
       */
      return {
        type: "rejected",
        message:
          error instanceof Error
            ? error.message
            : `A szerver elutasította (${status}).`,
      };
    }
    const written = await deps.enqueue();
    const outcome: QueueWriteOutcome = describeQueueWrite(
      written,
      deps.checkMessage,
    );
    return outcome.type === "queued"
      ? {
          type: "queued",
          operationId: outcome.operationId,
          message: outcome.message,
        }
      : { type: "lost", message: outcome.message };
  }
}
