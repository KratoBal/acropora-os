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
    const params = new URLSearchParams({ view: query.view });
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
      `${base}/material-requests/summary`,
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
    return action(token, id, "claim");
  },
  order(token: string, id: string) {
    return action(token, id, "order");
  },
  receiveAll(token: string, id: string) {
    return action(token, id, "receive-all");
  },
  cancel(token: string, id: string) {
    return action(token, id, "cancel");
  },
  receiveItems(
    token: string,
    id: string,
    input: MaterialRequestReceiveItemsInput,
  ) {
    return action(token, id, "receive-items", input);
  },
  reassign(token: string, id: string, handlerId: string) {
    return action(token, id, "reassign", { handlerId });
  },
  comment(token: string, id: string, body: string) {
    return action(token, id, "comments", { body });
  },
};

function action(token: string, id: string, name: string, body?: unknown) {
  return apiRequest<MaterialRequestFullDetail>(
    `${base}/material-requests/${encodeURIComponent(id)}/${name}`,
    token,
    {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
}
