import { apiRequest } from "./client";
import type {
  AcceptServiceDraftInput,
  ServiceDraftListResponse,
} from "../service-drafts/types";

/**
 * A végpont előtagja EGY HELYEN, ugyanazért az okért, mint a `partners.ts`
 * fejlécében: egy konstansnál a rossz előtag nem tud részlegesen megtörténni.
 */
const DRAFTS = "/service/drafts";

/**
 * A CÁPASULI PISZKOZATOK A TELEFONON (kártya 49210cdd).
 *
 * Az értesítés („Új Cápasuli piszkozatok”) eddig a nyitólapra vitt, mert a
 * telefonon nem volt hova vinnie: a Piszkozatok oldal csak a weben állt. Ez a
 * kliens a várakozó listát olvassa, és dönt róla: elfogadás (helyszínnel és a
 * jelentő szerzőjével) vagy elvetés, a szerver végpontjain
 * (`apps/api/src/service-drafts/service-drafts.controller.ts`). A kiszűrt
 * tételek és a „Mégis piszkozat” a weben maradnak.
 *
 * A típus SAJÁT, szűkített másolat: csak az a része a válasznak, amit a
 * képernyő megjelenít (lásd `docs/MOBILE-DEVELOPMENT.md`).
 */
export type {
  AcceptServiceDraftInput,
  ServiceDraftFilterState,
  ServiceDraftLocation,
  ServiceDraftListItem,
  ServiceDraftListResponse,
} from "../service-drafts/types";

export function listPendingServiceDrafts(): Promise<ServiceDraftListResponse> {
  return apiRequest<ServiceDraftListResponse>(`${DRAFTS}?status=PENDING`);
}

export function acceptServiceDraft(id: string, input: AcceptServiceDraftInput) {
  return apiRequest<{ serviceJobId: string }>(
    `${DRAFTS}/${encodeURIComponent(id)}/accept`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function rejectServiceDraft(id: string) {
  return apiRequest<unknown>(`${DRAFTS}/${encodeURIComponent(id)}/reject`, {
    method: "POST",
  });
}
