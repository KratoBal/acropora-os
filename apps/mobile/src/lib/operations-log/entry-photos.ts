import type { PickedFile } from "../api/picked-image";
import {
  ownerPhotoOperationId,
  photoOperationId,
  type PhotoPayload,
} from "../offline/queue-order";
import type { SaveOutcome } from "../offline/save-or-queue";
import { describePhotoQueueing } from "../assets/photo-after-record";
import type { OperationsEntryPhotoToSend } from "./entry-form";

/**
 * MI TÖRTÉNIK A FÉNYKÉP MEZŐK KÉPEIVEL, MIUTÁN A BEJEGYZÉS RÖGZÍTÉSE ELDŐLT (task os-uzemeltetesi-naplo, S2c).
 *
 * UGYANAZ A NÉGY KIMENET, MINT AZ ESZKÖZ FELVITELÉNÉL (`lib/assets/photo-after-record.ts`), két eltéréssel: a kép egy FÉNYKÉP MEZŐHÖZ
 * kötött (a mező kulcsa a sor payloadjában utazik), és a „felment" ágon a feltöltés hibája nem tartja a képernyőn a szerelőt: a kép
 * ilyenkor a sorba kerül a már ismert bejegyzés alá (`owner-photo`), és a sor magától elküldi. A bejegyzés ekkor már fent van, tehát
 * a kép nem veszik el, és nincs mit újra beírni.
 *
 *   saved     -> a szerver ismeri a bejegyzést: a képek MOST mennek, a sikertelen a sorba
 *   queued    -> a bejegyzés a sorban vár: a képek a rögzítés műveletazonosítója alá kerülnek
 *   rejected  -> a szerver elutasította a bejegyzést: nincs mihez kötni
 *   lost      -> a rögzítés SEHOL nem létezik: nincs mihez kötni
 *
 * KÜLÖN MODUL, mert a képernyőre nincs komponens-teszt, és a KIMARADT kép az, amiről hallgatni a legdrágább.
 */
export interface EntryPhotoDeps {
  /**
   * Egy kép feltöltése a már létező bejegyzéshez. Hibára dob. A `rowId` ugyanaz, amin a kép a sorba kerülne, ha a feltöltés
   * elbukik: a szerver-oldali kulcs ebből számolódik (`operationsPhotoClientKey`), így ha a kép MÁR felment, csak a válasz veszett
   * el, a sorból az újraküldés ugyanazt a képet kapja vissza (`created: false`), nem másodikat.
   */
  upload: (
    entryId: string,
    photo: OperationsEntryPhotoToSend,
    rowId: string,
  ) => Promise<unknown>;
  enqueue: (input: {
    id: string;
    payload: PhotoPayload;
    createdAt: string;
    ownerId?: string;
  }) => Promise<
    { ok: true; operationId: string } | { ok: false; error: string }
  >;
}

/** A kép sor-azonosítója: a mező kulcsa is benne van, mert ugyanaz a fájl két mezőhöz két külön kép. */
function rowKeyPart(photo: OperationsEntryPhotoToSend): string {
  return `${photo.fieldKey}:${photo.file.uri}`;
}

function payloadOf(
  photo: OperationsEntryPhotoToSend,
  recordingOperationId?: string,
): PhotoPayload {
  const file: PickedFile = photo.file;
  return {
    uri: file.uri,
    name: file.name,
    type: file.type,
    fieldKey: photo.fieldKey,
    ...(recordingOperationId ? { recordingOperationId } : {}),
  };
}

export async function handleEntryPhotos(input: {
  outcome: SaveOutcome;
  photos: readonly OperationsEntryPhotoToSend[];
  createdAt: string;
  deps: EntryPhotoDeps;
}): Promise<string | null> {
  const { outcome, photos, createdAt, deps } = input;
  if (photos.length === 0) return null;

  if (outcome.type === "rejected" || outcome.type === "lost")
    return photos.length === 1
      ? "A fényképet nem tudtuk hova tenni, mert a rögzítés nem jött létre."
      : `A ${photos.length} fényképet nem tudtuk hova tenni, mert a rögzítés nem jött létre.`;

  let uploaded = 0;
  let queued = 0;
  let failed = 0;
  for (const photo of photos) {
    if (outcome.type === "saved") {
      const rowId = ownerPhotoOperationId({
        entityType: "operations-entry",
        ownerId: outcome.id,
        uri: rowKeyPart(photo),
      });
      try {
        await deps.upload(outcome.id, photo, rowId);
        uploaded += 1;
        continue;
      } catch {
        // a bejegyzés fent van: a kép a sorba megy, és onnan magától felmegy
        const result = await deps.enqueue({
          id: rowId,
          payload: payloadOf(photo),
          createdAt,
          ownerId: outcome.id,
        });
        if (result.ok) queued += 1;
        else failed += 1;
        continue;
      }
    }
    const result = await deps.enqueue({
      id: photoOperationId({
        recordingOperationId: outcome.operationId,
        uri: rowKeyPart(photo),
      }),
      payload: payloadOf(photo, outcome.operationId),
      createdAt,
    });
    if (result.ok) queued += 1;
    else failed += 1;
  }

  const queueing = describePhotoQueueing({ queued, failed });
  if (uploaded > 0 && queueing === null)
    return `${uploaded} fénykép feltöltve.`;
  if (uploaded > 0) return `${uploaded} fénykép feltöltve. ${queueing}`;
  return queueing;
}
