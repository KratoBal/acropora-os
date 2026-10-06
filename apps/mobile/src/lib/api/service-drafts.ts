import { apiRequest } from "./client";
import type { ServiceDraftListResponse } from "../service-drafts/types";

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
 * kliens EGYELŐRE CSAK OLVAS: a lista a szerver `GET service/drafts`
 * végpontjáé (`apps/api/src/service-drafts/service-drafts.controller.ts`). Az
 * elfogadás, az elutasítás és a kiszűrt tétel visszavétele a weben marad; a
 * képernyő ezt ki is mondja.
 *
 * A típus SAJÁT, szűkített másolat: csak az a része a válasznak, amit a
 * képernyő megjelenít (lásd `docs/MOBILE-DEVELOPMENT.md`).
 */
export type {
  ServiceDraftFilterState,
  ServiceDraftListItem,
  ServiceDraftListResponse,
} from "../service-drafts/types";

export function listPendingServiceDrafts(): Promise<ServiceDraftListResponse> {
  return apiRequest<ServiceDraftListResponse>(`${DRAFTS}?status=PENDING`);
}
