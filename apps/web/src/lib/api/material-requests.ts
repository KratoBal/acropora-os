import type {
  CreateMaterialRequestInput,
  MaterialRequestDetail,
  MaterialRequestListResponse,
  PendingMaterialRequestListResponse,
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
  /** A beszerzo sajat, "ram varo" listaja -- kulon kepessegen all, nem jogon. */
  listPending(token: string, signal?: AbortSignal) {
    return apiRequest<PendingMaterialRequestListResponse>(
      `${base}/material-requests`,
      token,
      { signal },
    );
  },
  receive(token: string, id: string) {
    return apiRequest<PendingMaterialRequestListResponse>(
      `${base}/material-requests/${encodeURIComponent(id)}/receive`,
      token,
      { method: "POST" },
    );
  },
};
