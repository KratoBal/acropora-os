import type {
  OperationsReportResponse,
  OperationsTaskTemplateDto,
  OperationsTaskTemplateInput,
  OperationsTaskTemplateListResponse,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { apiAuthHeaders, apiRequest } from "./client";
import { readExport, type FileExport } from "./file-export";

const base = "/operations-log/templates";
const json = { "Content-Type": "application/json" };

/** Az üzemeltetési napló feladat-sablonjai (task os-uzemeltetesi-naplo, S1). */
export const operationsLogApi = {
  /** A kivezetett sablonok csak kérésre jönnek: a rögzítés kínálata az aktívak. */
  list(token: string, includeInactive = false, signal?: AbortSignal) {
    const query = includeInactive ? "?includeInactive=true" : "";
    return apiRequest<OperationsTaskTemplateListResponse>(
      `${base}${query}`,
      token,
      { signal },
    );
  },
  get(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<OperationsTaskTemplateDto>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: OperationsTaskTemplateInput) {
    return apiRequest<OperationsTaskTemplateDto>(base, token, {
      method: "POST",
      headers: json,
      body: JSON.stringify(input),
    });
  },
  /** A teljes sablon a teljes mezőkészlettel (`PUT`); az `isActive` a visszaállítás. */
  update(
    token: string,
    id: string,
    input: OperationsTaskTemplateInput & { isActive?: boolean },
  ) {
    return apiRequest<OperationsTaskTemplateDto>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { method: "PUT", headers: json, body: JSON.stringify(input) },
    );
  },
  /** KIVEZET, nem töröl: a válasz `{ retired: true }`, és ez kimondja. */
  retire(token: string, id: string) {
    return apiRequest<{ retired: true }>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
  },
  /** A havi kimutatás (S4): a hónap és a hatókör (helyszín VAGY eszköz). */
  report(token: string, query: OperationsReportQuery, signal?: AbortSignal) {
    return apiRequest<OperationsReportResponse>(
      `/operations-log/report?${reportQueryString(query)}`,
      token,
      { signal },
    );
  },
  /** A havi kimutatás PDF-ben: a fájl és a szerver adta név. */
  async reportPdf(
    token: string,
    query: OperationsReportQuery,
  ): Promise<FileExport> {
    const response = await fetch(
      `${API_PREFIX}/operations-log/report/pdf?${reportQueryString(query)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return readExport(
      response,
      `uzemeltetesi-naplo-${query.month}.pdf`,
      "A PDF nem tölthető le.",
    );
  },
};

export interface OperationsReportQuery {
  /** `ÉÉÉÉ-HH`. */
  month: string;
  departmentId?: string;
  assetId?: string;
}

function reportQueryString(query: OperationsReportQuery): string {
  const params = new URLSearchParams({ month: query.month });
  if (query.departmentId) params.set("departmentId", query.departmentId);
  if (query.assetId) params.set("assetId", query.assetId);
  return params.toString();
}
