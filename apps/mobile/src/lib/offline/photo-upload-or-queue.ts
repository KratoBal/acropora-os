// RELATIV UT, NEM `@/`: a teszt-fordito nem ismeri az aliast.
import type { PickedFile } from "../api/picked-image";
import { ownerPhotoOperationId } from "./photo-queue";
import type { SyncEntityType } from "./sync-queue";

/**
 * FENYKEP EGY MAR LETEZO GAZDAHOZ: ELOSZOR A SZERVERNEK, ES CSAK HALOZATI
 * HIBANAL A SORBA.
 *
 * === MIERT KULON MODUL, ES MIERT NEM A `save-or-queue.ts` ===
 *
 * Az UGYANAZT a szabalyt viszi, de EGY tetelre: egy felvitel megy el, es egy
 * azonosito jon vissza. A fenykep KOTEG, es a koteg reszlegesen is sikerulhet
 * -- a sorba tetelnel fajlonkent dol el, bekerult-e. Egy egy-tetelre irt
 * dontes ezt vagy elhallgatna, vagy az elso bukasnal eldobna a tobbit.
 *
 * === A SORBA CSAK AZ KERUL, AMIT A SZERVER MEG NEM LATOTT ===
 *
 * Egy 4xx valasz NEM halozati hiba: a szerver valaszolt, es elutasitott. Ha azt
 * is sorba tennenk, a hibas feltoltes VEGTELENUL ujraprobalna magat, es a
 * szerelo azt latna, hogy "var feltoltesre" -- holott soha nem fog atmenni.
 *
 * === MIERT NINCS BENNE `fetch`, ADATBAZIS ES `Date` ===
 *
 * Mert a kepernyore nincs komponens-teszt ebben az appban. Ami a torzsben
 * marad, azt csak kezzel, keszuleken lehet kiprobalni -- es epp ezt a resz a
 * legdragabb ugy probalni: a pinceben, terero nelkul.
 */

export type PhotoSendOutcome =
  /** A szerver elfogadta. `count` az, amit a szerver VISSZAADOTT, nem amit kuldtunk. */
  | { type: "uploaded"; count: number }
  /**
   * Nem ertuk el a szervert: a kepek a sorban varnak.
   *
   * A KET SZAM KULON ALL, mert a teendojuk mas: a sorba KERULT kep magatol
   * felmegy, a KIMARADT viszont elveszett, es ujra kell fenykepezni.
   */
  | { type: "queued"; queued: number; failed: number }
  /** A szerver VALASZOLT es elutasitott. Nem sorbol valo. */
  | { type: "rejected"; message: string }
  /** Nem volt mit kuldeni. */
  | { type: "none" };

/**
 * EGY SORBA TEENDO KEP BEJEGYZESE EGY MAR LETEZO GAZDAHOZ.
 *
 * === MIERT KULON FUGGVENY, HOLOTT TIZENOT SOR ===
 *
 * Mert HAROM kepernyo irja ugyanezt (munkalap, eszkoz es hibajegy
 * reszletlapja), es ebben az appban a fenykep-menet MAR EGYSZER negyszer
 * masolodott le, mielott valaki kiemelte. Ket dolog all benne, amit elrontani
 * NEMA hiba:
 *
 *   a KULCS a tartalombol szuletik -- kulonben a ketszer megnyomott gomb ket
 *     sort ad, es ugyanaz a kep KETSZER megy fel;
 *   a GAZDA azonositoja MOST kerul a sorra -- kulonben a kep gazdatlan lenne,
 *     es SOHA nem menne fel, ugy, hogy a sor tovabbra is varakozonak latszik.
 *
 * A `recordingOperationId` SZANDEKOSAN HIANYZIK: egy mar letezo gazdahoz
 * tartozo kep senkire nem var, es egy kitalalt azonosito ott azt jelentene,
 * hogy a sor orokre var valamire, ami soha nem jon.
 */
export function ownerPhotoQueueEntry(input: {
  entityType: SyncEntityType;
  ownerId: string;
  file: PickedFile;
  createdAt: string;
}): {
  id: string;
  payload: { uri: string; name: string; type: string };
  createdAt: string;
  entityType: SyncEntityType;
  ownerId: string;
} {
  return {
    id: ownerPhotoOperationId({
      entityType: input.entityType,
      ownerId: input.ownerId,
      uri: input.file.uri,
    }),
    payload: {
      uri: input.file.uri,
      name: input.file.name,
      type: input.file.type,
    },
    createdAt: input.createdAt,
    entityType: input.entityType,
    ownerId: input.ownerId,
  };
}

export interface PhotoSendDeps {
  files: readonly PickedFile[];
  /** A feltoltes. A visszateres a szerver altal letrehozott dokumentumok szama. */
  upload(files: readonly PickedFile[]): Promise<{ count: number }>;
  /** Egy kep sorba tetele. `false`, ha a beszuras elbukott. */
  enqueue(file: PickedFile): Promise<boolean>;
  /** A hibabol kiolvassa a HTTP kodot; `null`, ha el sem jutott a szerverig. */
  statusOf(error: unknown): number | null;
  /** Az elutasitas emberi alakja. Hivonkent mas, ezert kivulrol jon. */
  describeRejection(error: unknown): string;
}

export async function uploadOrQueuePhotos(
  deps: PhotoSendDeps,
): Promise<PhotoSendOutcome> {
  if (deps.files.length === 0) return { type: "none" };
  try {
    const { count } = await deps.upload(deps.files);
    return { type: "uploaded", count };
  } catch (cause) {
    /**
     * A SZERVER VALASZOLT: NEM SORBOL VALO. Egy 413 (tul nagy fajl) vagy egy
     * 400 (rossz formatum) ugyanugy jonne a sorbol is, orokre.
     */
    if (deps.statusOf(cause) !== null)
      return { type: "rejected", message: deps.describeRejection(cause) };

    /**
     * EGY BUKAS NEM ALLITJA MEG A TOBBIT, DE MEGSZAMOLJUK. Egy csendes
     * reszleges siker pontosan azt a kepet vinne el, amirol a szerelo azt
     * hiszi, megvan.
     */
    let queued = 0;
    let failed = 0;
    for (const file of deps.files) {
      if (await deps.enqueue(file)) queued += 1;
      else failed += 1;
    }
    return { type: "queued", queued, failed };
  }
}

/**
 * AMIT A KEPERNYON MONDUNK -- vagy `null`, ha nincs mit.
 *
 * A KIHAGYOTT FAJLOK (rossz formatum) MINDEN AGON MEGJELENNEK, mert azok a
 * KIVALASZTASNAL estek ki, nem a kuldesnel -- es egy csendben eldobott HEIC
 * ugyanugy nez ki, mint egy sikeres valasztas.
 */
export function describePhotoSend(
  outcome: PhotoSendOutcome,
  skipped: readonly string[],
): string | null {
  const kimaradt =
    skipped.length > 0
      ? ` Kimaradt (csak JPEG és PNG megy): ${skipped.join(", ")}.`
      : "";
  switch (outcome.type) {
    case "none":
      return skipped.length > 0 ? kimaradt.trim() : null;
    case "uploaded":
      return `${outcome.count} kép a laphoz került.${kimaradt}`;
    case "rejected":
      return `${outcome.message}${kimaradt}`;
    case "queued": {
      /**
       * A HAROM AG HAROM KULON MONDAT. A "nem sikerult a telefonra menteni"
       * eset a legdragabb: az a kep SEHOL nincs meg, es csak ujrafenykepezessel
       * potolhato -- egy kozos mondat ezt elhallgatna.
       */
      if (outcome.failed === 0)
        return `Nincs térerő: ${outcome.queued} kép a telefonon vár, és magától felmegy, amint visszajön a hálózat.${kimaradt}`;
      if (outcome.queued === 0)
        return `Nincs térerő, és ${outcome.failed} képet NEM sikerült a telefonra menteni: ezek elvesztek, fényképezd újra.${kimaradt}`;
      return `Nincs térerő: ${outcome.queued} kép a telefonon vár, ${outcome.failed} viszont NEM került a sorba -- azokat fényképezd újra.${kimaradt}`;
    }
  }
}
