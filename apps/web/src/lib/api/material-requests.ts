import type {
  CreateMaterialRequestInput,
  MaterialRequestDetail,
  MaterialRequestFullDetail,
  MaterialRequestHandlerOption,
  MaterialRequestListResponse,
  MaterialRequestPage,
  MaterialRequestReceiveItemsInput,
  MaterialRequestStatusCounts,
  MaterialRequestStatusValue,
  MaterialRequestView,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/service";

function worksheetPath(worksheetId: string) {
  return `${base}/worksheets/${encodeURIComponent(worksheetId)}/material-requests`;
}

/**
 * ANYAGIGENYLES A MUNKALAPROL -- UGYANAZ A MINTA, MINT A `worksheetsApi`
 * MUNKANAPLO-METODUSAINAL (`entries`/`addEntry`): a felvitel es a kuldes is
 * a TELJES, friss listat adja vissza, nem az uj sort, hogy a felulet egy
 * korbol frissuljon.
 */
export const materialRequestsApi = {
  listForWorksheet(token: string, worksheetId: string, signal?: AbortSignal) {
    return apiRequest<MaterialRequestListResponse>(
      worksheetPath(worksheetId),
      token,
      { signal },
    );
  },
  /** Az UJ SORT adja vissza, nem a teljes listat -- lasd a szerver fejlecet. */
  create(
    token: string,
    worksheetId: string,
    input: CreateMaterialRequestInput,
  ) {
    return apiRequest<MaterialRequestDetail>(
      worksheetPath(worksheetId),
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /** A kuldes -- csak a SAJAT piszkozat kuldheto el, lasd a szerver fejlecet. */
  submit(token: string, id: string) {
    return apiRequest<MaterialRequestListResponse>(
      `${base}/material-requests/${encodeURIComponent(id)}/submit`,
      token,
      { method: "POST" },
    );
  },
  // -------------------------------------------------------------------------
  // V2 (docs/material-requests/v2-discovery.md). Every action returns the
  // authoritative request; the page re-reads the list and the counts after
  // it, so nobody keeps seeing "Nincs felelős" for a claimed request.

  overview(
    token: string,
    query: {
      view: MaterialRequestView;
      status?: MaterialRequestStatusValue;
      q?: string;
      cursor?: string;
    },
    signal?: AbortSignal,
  ) {
    // #1582 P5b: the web lists the project requests too (an old mobile
    // build never asks, so it never gets a request without a worksheet)
    const params = new URLSearchParams({
      view: query.view,
      includeProjects: "1",
    });
    if (query.status) params.set("status", query.status);
    if (query.q) params.set("q", query.q);
    if (query.cursor) params.set("cursor", query.cursor);
    return apiRequest<MaterialRequestPage>(
      `${base}/material-requests/overview?${params.toString()}`,
      token,
      { signal },
    );
  },
  summary(token: string, signal?: AbortSignal) {
    return apiRequest<MaterialRequestStatusCounts>(
      `${base}/material-requests/summary?includeProjects=1`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  handlerOptions(token: string, signal?: AbortSignal) {
    return apiRequest<{ items: MaterialRequestHandlerOption[] }>(
      `${base}/material-requests/handler-options`,
      token,
      { signal },
    );
  },
  claim(token: string, id: string) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/claim`,
      token,
      post(),
    );
  },
  order(token: string, id: string) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/order`,
      token,
      post(),
    );
  },
  receiveAll(token: string, id: string) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/receive-all`,
      token,
      post(),
    );
  },
  cancel(token: string, id: string) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/cancel`,
      token,
      post(),
    );
  },
  receiveItems(
    token: string,
    id: string,
    input: MaterialRequestReceiveItemsInput,
  ) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/receive-items`,
      token,
      post(input),
    );
  },
  reassign(token: string, id: string, handlerId: string) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/reassign`,
      token,
      post({ handlerId }),
    );
  },
  comment(token: string, id: string, body: string) {
    return apiRequest<MaterialRequestFullDetail>(
      `${base}/material-requests/${encodeURIComponent(id)}/comments`,
      token,
      post({ body }),
    );
  },
};

/**
 * The init of one POST action. Each path stays written out inside its own
 * `apiRequest` call, so the route-parity guard (mobile-api-routes.spec) reads
 * every one and checks it against the server.
 */
function post(body?: unknown): RequestInit {
  return {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  };
}
