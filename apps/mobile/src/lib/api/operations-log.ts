import { apiRequest } from "./client";
import type {
  CreateOperationsEntryInput,
  CreateOperationsEntryResponse,
  OperationsColleague,
  OperationsTemplate,
  UploadOperationsPhotoResponse,
} from "../operations-log/types";
import { buildDocumentUpload, type PickedFile } from "./document-upload";

/** A végpont előtagja EGY HELYEN (lásd a `partners.ts` fejlécét). */
const BASE = "/operations-log";

/**
 * ÜZEMELTETÉSI NAPLÓ, A TELEFON OLDALA (task os-uzemeltetesi-naplo, S2c): az eszközhöz tartozó sablonok, a kollégák listája, a
 * bejegyzés rögzítése és a fénykép mezők képei. A típusok SAJÁT másolatok, nem a `@acropora/types` csomagból jönnek (lásd
 * `docs/MOBILE-DEVELOPMENT.md`); a szerver oldalán az `apps/api/src/operations-log/` áll, és a válasz-tükör őr
 * (`apps/api/src/mobile/mobile-response-mirror.spec.ts`) méri, hogy a két oldal nem csúszik szét.
 *
 * A SABLONOK ÉS A KOLLÉGÁK LISTÁJA OFFLINE IS KELL: a helyszínen nincs térerő, és a szerelő akkor is rögzít. A hívók ezért nem
 * közvetlenül ezeket használják, hanem a `lib/operations-log/operations-cache.ts` olvasó-függvényeit, amelyek a legutóbbi sikeres
 * választ őrzik.
 */

export type {
  CreateOperationsEntryInput,
  CreateOperationsEntryResponse,
  OperationsColleague,
  OperationsEntryCreated,
  OperationsEntryValue,
  OperationsFieldType,
  OperationsMeterRole,
  OperationsTaskFrequency,
  OperationsTemplate,
  OperationsTemplateField,
  UploadOperationsPhotoResponse,
} from "../operations-log/types";

export function listOperationsTemplatesForAsset(assetId: string) {
  return apiRequest<{ items: OperationsTemplate[] }>(
    `${BASE}/assets/${encodeURIComponent(assetId)}/templates`,
  );
}

export function listOperationsColleagues() {
  return apiRequest<{ items: OperationsColleague[] }>(`${BASE}/colleagues`);
}

export function createOperationsEntry(input: CreateOperationsEntryInput) {
  return apiRequest<CreateOperationsEntryResponse>(`${BASE}/entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * EGY KÉP EGY FÉNYKÉP MEZŐHÖZ, KÉRÉSENKÉNT EGY. A `clientOperationId` a kép sor-azonosítója: a megszakadt válasz után az
 * újraküldés ugyanazt a képet adja vissza, nem másodikat. A bejegyzés rögzítője csatolhat (a szerver 403-mal védi).
 */
export async function uploadOperationsEntryPhoto(
  entryId: string,
  input: { file: PickedFile; fieldKey: string; clientOperationId: string },
): Promise<UploadOperationsPhotoResponse> {
  const built = buildDocumentUpload({ files: [input.file] });
  if (!built.ok) throw new Error(built.reason);
  built.body.append("fieldKey", input.fieldKey);
  built.body.append("clientOperationId", input.clientOperationId);
  return apiRequest<UploadOperationsPhotoResponse>(
    `${BASE}/entries/${encodeURIComponent(entryId)}/photos`,
    { method: "POST", body: built.body },
  );
}
