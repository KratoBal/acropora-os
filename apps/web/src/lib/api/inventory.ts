import type {
  InventoryCountApplyResult,
  InventoryCountDetail,
  InventoryCountListResponse,
  InventoryCountUploadResult,
} from "@acropora/types";

import { ApiError, apiRequest } from "./client";

export interface InventoryCountListQuery {
  page?: number;
  pageSize?: number;
  status?: "DRAFT" | "UPLOADED" | "CORRECTED";
}

function listQueryString(query: InventoryCountListQuery): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.status) params.set("status", query.status);
  return params.toString();
}

function uploadCounts(
  token: string,
  id: string,
  file: File,
): Promise<InventoryCountUploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `/api/inventory/counts/${encodeURIComponent(id)}/upload`,
    );
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.addEventListener("error", () =>
      reject(
        new ApiError("A szerver nem érhető el. Ellenőrizd a kapcsolatot.", 0),
      ),
    );
    request.addEventListener("load", () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(payload as InventoryCountUploadResult);
        return;
      }
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : "Az XLSX feldolgozása nem sikerült.";
      reject(new ApiError(message, request.status));
    });
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}

async function downloadTemplate(
  token: string,
  id: string,
  filename: string,
): Promise<void> {
  const response = await fetch(
    `/api/inventory/counts/${encodeURIComponent(id)}/template.xlsx`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new ApiError("A sablon letöltése nem sikerült.", response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const inventoryApi = {
  list(token: string, query: InventoryCountListQuery) {
    return apiRequest<InventoryCountListResponse>(
      `/inventory/counts?${listQueryString(query)}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<InventoryCountDetail>(
      `/inventory/counts/${encodeURIComponent(id)}`,
      token,
    );
  },
  create(token: string) {
    return apiRequest<InventoryCountDetail>(`/inventory/counts`, token, {
      method: "POST",
    });
  },
  downloadTemplate,
  uploadCounts,
  updateLineCount(
    token: string,
    id: string,
    lineId: string,
    countedQty: number,
  ) {
    return apiRequest<InventoryCountDetail>(
      `/inventory/counts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedQty }),
      },
    );
  },
  apply(token: string, id: string) {
    return apiRequest<InventoryCountApplyResult>(
      `/inventory/counts/${encodeURIComponent(id)}/apply`,
      token,
      { method: "POST" },
    );
  },
};
