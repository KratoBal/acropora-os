// RELATIV UT, NEM `@/`: a teszt-fordito nem ismeri az aliast
// (`tsconfig.test.json`-ban nincs `paths`), es a feloldasa behuzna az Expo
// futasi kornyezetet.
import type { PickedFile } from "../api/picked-image";
import { photoOperationId, type PhotoPayload } from "../offline/photo-queue";
import type { SaveOutcome } from "../offline/save-or-queue";

/**
 * MI TORTENJEN A HELYSZINEN KESZULT KEPPEL, MIUTAN A ROGZITES ELDOLT.
 *
 * === MIERT KULON MODUL, ES MIERT NEM A KEPERNYOBEN ===
 *
 * A kepernyore nincs komponens-teszt ebben az appban. Ami a torzsben marad,
 * azt csak kezzel, eszkozon lehet kiprobalni -- es ez az a resz, amit a
 * legdragabb ugy probalni: a pinceben, terero nelkul.
 *
 * === A NEGY KIMENET NEGY KULON TEENDO ===
 *
 * A rogzitesnek negy vege van (`offline/save-or-queue.ts`), es a kep sorsa MIND A
 * NEGYNEL MAS. A legkonnyebben elsikkado a ket utolso: ott a kep marad a
 * kezunkben, es ha hallgatunk rola, a szerelo azt hiszi, felment.
 *
 *   saved     -> a szerver ismeri az eszkozt: a kep MOST felmehet
 *   queued    -> nincs meg szerver-azonosito: a kep a sorba megy, a rogzites
 *                muvelet-azonositoja ala
 *   rejected  -> a szerver elutasitotta a felvitelt: nincs mihez kotni
 *   lost      -> a rogzites SEHOL nem letezik: nincs mihez kotni
 */
export type PhotoPlan =
  /** A szerver ismeri az eszkozt: a kep mehet egybol. */
  | { type: "upload"; assetId: string; files: PickedFile[] }
  /** A rogzites a sorban var: a kep utana megy, ugyanabba a sorba. */
  | { type: "queue"; recordingOperationId: string; files: PickedFile[] }
  /**
   * NINCS MIHEZ KOTNI. Nem hiba a kepben: a ROGZITES nem jott letre, tehat a
   * kepnek nincs gazdaja. A `message` ezt mondja ki -- e nelkul a kep
   * csendben eltunne, es a szerelo azt hinne, felkerult.
   */
  | { type: "dropped"; message: string }
  /** Nem valasztott kepet: nincs teendo es nincs mit mondani. */
  | { type: "none" };

export function planPhotosAfterRecord(
  outcome: SaveOutcome,
  files: readonly PickedFile[],
): PhotoPlan {
  if (files.length === 0) return { type: "none" };
  if (outcome.type === "saved") {
    return { type: "upload", assetId: outcome.assetId, files: [...files] };
  }
  if (outcome.type === "queued") {
    return {
      type: "queue",
      recordingOperationId: outcome.operationId,
      files: [...files],
    };
  }
  return {
    type: "dropped",
    message:
      files.length === 1
        ? "A fényképet nem tudtuk hova tenni, mert a rögzítés nem jött létre."
        : `A ${files.length} fényképet nem tudtuk hova tenni, mert a rögzítés nem jött létre.`,
  };
}

/**
 * A SORBA TETEL EREDMENYE, EMBERI ALAKBAN.
 *
 * A RESZLEGES SIKER KULON MONDATOT KAP. Ha csak azt mondanank, hogy "3 kep
 * var feltoltesre", miközben egy negyedik beszurasa elbukott, a negyedik
 * CSENDBEN veszne el -- es epp az a kep, amirol a szerelo azt hiszi, megvan.
 */
export function describePhotoQueueing(counts: {
  queued: number;
  failed: number;
}): string | null {
  if (counts.queued === 0 && counts.failed === 0) return null;
  if (counts.failed === 0) {
    return `${counts.queued} fénykép is vár feltöltésre a rögzítés mellett.`;
  }
  if (counts.queued === 0) {
    return `${counts.failed} fényképet NEM sikerült a telefonra menteni: ezek elvesztek, fényképezd újra.`;
  }
  return (
    `${counts.queued} fénykép vár feltöltésre, ` +
    `${counts.failed} viszont NEM került a sorba: azokat fényképezd újra.`
  );
}

/** Amit a sorba tetel vissza tud adni. Kivulrol jon: itt nincs adatbazis. */
export type PhotoEnqueue = (input: {
  id: string;
  payload: PhotoPayload;
  createdAt: string;
}) => Promise<{ ok: true; operationId: string } | { ok: false; error: string }>;

/**
 * A KEPEK SORBA TETELE, EGYENKENT ES MEGSZAMOLVA.
 *
 * === MIERT NEM A KEPERNYOBEN ===
 *
 * Ez a ciklus dont arrol, hogy egy kep bekerult-e -- es a KIMARADT kep az,
 * amirol hallgatni a legdragabb. A kepernyore nincs komponens-teszt ebben az
 * appban, tehat ami ott marad, azt semmi nem meri.
 *
 * === A HIBA NEM ALLITJA MEG A TOBBIT ===
 *
 * Egy elbukott beszuras (tele lemez, serult adatbazis) nem ok arra, hogy a
 * tobbi kep se kerüljon a sorba. Viszont MEGSZAMOLJUK, es a hivo kimondja:
 * egy csendes reszleges siker pontosan azt a kepet vinne el, amirol a szerelo
 * azt hiszi, megvan.
 */
export async function queuePhotosForRecording(input: {
  recordingOperationId: string;
  files: readonly PickedFile[];
  createdAt: string;
  enqueue: PhotoEnqueue;
}): Promise<{ queued: number; failed: number }> {
  let queued = 0;
  let failed = 0;
  for (const file of input.files) {
    const result = await input.enqueue({
      /**
       * A KULCS A TARTALOMBOL SZULETIK, ugyanabbol az okbol, mint a rogzitese:
       * a ketszer megnyomott gomb ugyanazt a sort adja, nem kettot.
       */
      id: photoOperationId({
        recordingOperationId: input.recordingOperationId,
        uri: file.uri,
      }),
      payload: {
        uri: file.uri,
        name: file.name,
        type: file.type,
        recordingOperationId: input.recordingOperationId,
      },
      createdAt: input.createdAt,
    });
    if (result.ok) queued += 1;
    else failed += 1;
  }
  return { queued, failed };
}
