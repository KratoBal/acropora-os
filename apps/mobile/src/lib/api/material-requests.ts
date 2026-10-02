import { apiRequest } from "./client";
import type {
  MaterialRequestCommentInput,
  MaterialRequestFullDetail,
  MaterialRequestHandlerOption,
  MaterialRequestPage,
  MaterialRequestReassignInput,
  MaterialRequestReceiveItemsInput,
  MaterialRequestStatusCounts,
  MaterialRequestView,
} from "@/lib/material-requests/types";
import type {
  MaterialRequestItemInput,
  MaterialRequestStatusValue,
} from "@/lib/worksheets/material-request-presentation";

export type { MaterialRequestItemInput };
export type * from "@/lib/material-requests/types";

/**
 * ANYAGIGENYLES A MUNKALAPROL -- A TELEFON KLIENSE.
 *
 * UGYANAZ A MINTA, MINT A `worksheets.ts` MUNKANAPLO-METODUSAINAL
 * (`listWorksheetEntries`/`addWorksheetEntry`): a felvitel `create()`-je az
 * UJ SORT adja vissza (a hivonak azonnal kell az azonosito a `submit`-hez),
 * a `submit()`/`receive()` a TELJES, friss listat -- lasd a szerver
 * `MaterialRequestsService` fejleceit, ugyanaz az indok.
 *
 * A TIPUSOK SAJAT MASOLATOK, NEM A `@acropora/types` CSOMAGBOL JONNEK: az
 * Expo app szandekosan nem huzza be a pnpm munkater csomagjait (lasd
 * `docs/MOBILE-DEVELOPMENT.md`). A mezoneveik a szervereet masoljak
 * (`packages/types/src/material-request-management.ts`).
 */

const BASE = "/service/worksheets";
const REQUESTS_BASE = "/service/material-requests";

export interface MaterialRequestItem {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

export interface MaterialRequestDetail {
  id: string;
  worksheetId: string;
  status: MaterialRequestStatusValue;
  /** `null`, ha a kérő azóta törölt kolléga. */
  requestedByName: string | null;
  /** A PISZKOZAT létrehozásának ideje, NEM az elküldése. */
  createdAt: string;
  submittedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  items: MaterialRequestItem[];
}

export interface MaterialRequestListResponse {
  items: MaterialRequestDetail[];
  /**
   * FIGYELMEZTETES, HOGY MA SENKI NEM TUDJA JELOLNI A BEERKEZEST -- lasd a
   * szerver `MaterialRequestsService.submit` fejleceit. ELHAGYHATO, ES
   * KIZAROLAG a `submitMaterialRequest` valaszaban toltodik ki. A kuldest
   * ez NEM akadalyozza -- tajekoztatas, nem kapu.
   */
  warning?: string;
}

/**
 * NEVESITETT TIPUS, NEM HELYBEN KIIRT `{ items }`.
 *
 * Az `apps/api/src/mobile/mobile-request-body.spec.ts` a NEVESITETT
 * kerés-torzs tipusokat veti ossze a szerver DTO-javal (`CreateMaterialRequestDto`);
 * a szomszed `mobile-request-call-site.spec.ts` csak a HELYBEN kiirt kulcsokat
 * meri, azokat, amiknek nincs nevuk. Ez a tipus azert letezik, hogy ez a hivas
 * az elsobe tartozzon, ne a masodikba.
 */
export interface CreateMaterialRequestInput {
  items: MaterialRequestItemInput[];
}

/**
 * A HIVAS HELYEN INLINE, NEM KULON HELPERBOL.
 *
 * KET OK, MINDKETTO MERT: (1) egy KULON fuggveny visszateresi tipusa
 * `string`-re widenulne, es az `apiRequest` `` `/${string}` `` alaku elso
 * parametere emiatt nem fogadna el -- ezt jelezte a `tsc`. (2) az
 * `apps/api/src/mobile/mobile-api-routes.spec.ts` a hivo-oldali helpert csak
 * a `function NAME(...) { return \`...\`; }` alakban ismeri fel (visszateresi
 * tipus-jelzes NELKUL); egy attol elutero helper nem "kihagyva" lesz, hanem
 * HANGOSAN bukik ("egy hivasbol nem olvashato ki az utvonal") -- ez jelezte
 * a `pnpm test`. Az inline sablon-string mindket problemat elkeruli: a
 * `worksheets.ts` tobbi hivasa is ezt az alakot hasznalja.
 */
export function listMaterialRequestsForWorksheet(worksheetId: string) {
  return apiRequest<MaterialRequestListResponse>(
    `${BASE}/${encodeURIComponent(worksheetId)}/material-requests`,
  );
}

/** Az ÚJ SORT adja vissza, nem a teljes listát -- lásd a szerver fejlécét. */
export function createMaterialRequest(
  worksheetId: string,
  input: CreateMaterialRequestInput,
) {
  return apiRequest<MaterialRequestDetail>(
    `${BASE}/${encodeURIComponent(worksheetId)}/material-requests`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

/** A küldés -- csak a SAJÁT piszkozat küldhető el, lásd a szerver fejlécét. */
export function submitMaterialRequest(id: string) {
  return apiRequest<MaterialRequestListResponse>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/submit`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// V2 (docs/material-requests/v2-discovery.md). The types live in
// `lib/material-requests/types.ts` (no imports, so `node --test` can compile
// the rules that read them). Every action returns the full, fresh request.

export interface MaterialRequestOverviewQuery {
  view: MaterialRequestView;
  cursor?: string;
}

/** The overview list, scoped by the server to the worksheets this user sees. */
export function listMaterialRequestOverview(
  query: MaterialRequestOverviewQuery,
) {
  const params = new URLSearchParams({ view: query.view });
  if (query.cursor) params.set("cursor", query.cursor);
  return apiRequest<MaterialRequestPage>(`${REQUESTS_BASE}/overview?${params}`);
}

export function getMaterialRequestSummary() {
  return apiRequest<MaterialRequestStatusCounts>(`${REQUESTS_BASE}/summary`);
}

export function getMaterialRequest(id: string) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}`,
  );
}

export function listMaterialRequestHandlerOptions() {
  return apiRequest<{ items: MaterialRequestHandlerOption[] }>(
    `${REQUESTS_BASE}/handler-options`,
  );
}

/** "Én intézem a beszerzést". A 409 means someone else was faster. */
export function claimMaterialRequest(id: string) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/claim`,
    { method: "POST" },
  );
}

export function orderMaterialRequest(id: string) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/order`,
    { method: "POST" },
  );
}

export function receiveAllMaterialRequest(id: string) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/receive-all`,
    { method: "POST" },
  );
}

export function cancelMaterialRequest(id: string) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
}

export function receiveMaterialRequestItems(
  id: string,
  input: MaterialRequestReceiveItemsInput,
) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/receive-items`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function reassignMaterialRequest(
  id: string,
  input: MaterialRequestReassignInput,
) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/reassign`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function commentOnMaterialRequest(
  id: string,
  input: MaterialRequestCommentInput,
) {
  return apiRequest<MaterialRequestFullDetail>(
    `${REQUESTS_BASE}/${encodeURIComponent(id)}/comments`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
