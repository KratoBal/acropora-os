/**
 * MENTÉS: ELŐSZÖR A SZERVERNEK, ÉS CSAK HÁLÓZATI HIBÁNÁL A SORBA.
 *
 * === MIÉRT EBBEN A SORRENDBEN ===
 *
 * Ha mindig sorba tennénk, egy térerő melletti felvitel is várakozna, és a
 * kolléga nem kapná vissza a szerver-oldali azonosítót -- pedig a szerver ott
 * van. Ha viszont csak online mentenénk, a pincében semmi nem menne.
 *
 * === ÉS AMI ITT A LEGKÖNNYEBBEN ELROMLIK ===
 *
 * Egy 4xx válasz NEM hálózati hiba: a szerver válaszolt, és elutasította. Ha
 * azt is sorba tennénk, a hibás felvitel VÉGTELENÜL újrapróbálná magát, és a
 * kolléga azt látná, hogy „vár feltöltésre" -- holott soha nem fog átmenni.
 *
 * A sorba CSAK az kerül, amit a szerver MÉG NEM LÁTOTT.
 *
 * === MIÉRT AZ `offline` MAPPÁBAN, ÉS MIÉRT NEM AZ ESZKÖZÉBEN ===
 *
 * 2026-09-03-ig ez a modul `lib/assets/save-or-queue.ts` néven állt, mert
 * egyetlen felvitel használta. A munkalap felvitele UGYANEZT a szabályt kéri,
 * és két másolatból egyszer az egyik változna meg: a döntés egy helyen áll,
 * a SZÖVEG viszont hívónként külön, mert az eszközről és a munkalapról nem
 * ugyanazt kell mondani.
 */

export type SaveOutcome =
  /** A szerver elfogadta. Nincs sor, nincs várakozás. */
  | { type: "saved"; assetId: string }
  /** Nem értük el a szervert: a felvitel a sorban vár. */
  | { type: "queued"; operationId: string; message: string }
  /** A sorba tétel is elbukott: a felvitel SEHOL nem létezik. */
  | { type: "lost"; message: string }
  /** A szerver VÁLASZOLT és elutasította. Nem sorból való. */
  | { type: "rejected"; message: string };

/** A sorba tétel eredményének emberi alakja, hívónként külön szöveggel. */
export type QueueWriteOutcome =
  | { type: "queued"; operationId: string; message: string }
  | { type: "queue-failed"; message: string };

export interface SaveDeps {
  /** A felvitel elküldése. A visszatérő `id` a szerver-oldali azonosító. */
  save(): Promise<{ id: string }>;
  enqueue(): Promise<
    { ok: true; operationId: string } | { ok: false; error: string }
  >;
  /** A hibából kiolvassa a HTTP kódot; `null`, ha el sem jutott a szerverig. */
  statusOf(error: unknown): number | null;
  /**
   * A SORBA TÉTEL EREDMÉNYE, EMBERI ALAKBAN -- és ez hívónként más.
   *
   * Az eszköznél a mondat a gyorsítótár-ellenőrzést is hordozza (hány eszköz
   * ellen néztük meg a kódot); a munkalapnál nincs mit hordoznia. Egy közös
   * szöveg vagy az egyiknél mondana kevesebbet, vagy a másiknál többet, mint
   * amit tudunk.
   */
  describeWrite(
    result: { ok: true; operationId: string } | { ok: false; error: string },
  ): QueueWriteOutcome;
}

export async function saveOrQueue(deps: SaveDeps): Promise<SaveOutcome> {
  try {
    const created = await deps.save();
    return { type: "saved", assetId: created.id };
  } catch (error) {
    const status = deps.statusOf(error);
    if (status !== null) {
      /**
       * A SZERVER VÁLASZOLT. Egy elutasítás nem lesz jobb attól, hogy sorba
       * tesszük -- ugyanazt a választ adná újra és újra, és közben a felület
       * várakozást mutatna.
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
    const outcome = deps.describeWrite(written);
    return outcome.type === "queued"
      ? {
          type: "queued",
          operationId: outcome.operationId,
          message: outcome.message,
        }
      : { type: "lost", message: outcome.message };
  }
}
