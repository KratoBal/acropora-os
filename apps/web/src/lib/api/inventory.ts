import type {
  InventoryCountApplyResult,
  InventoryCountDetail,
  InventoryCountListResponse,
  InventoryCountUploadResult,
  StockItemReconciliationPage,
  StockItemReconciliationSummary,
} from "@acropora/types";

import { ApiError, apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

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
      `${API_PREFIX}/inventory/counts/${encodeURIComponent(id)}/upload`,
    );
    request.setRequestHeader("Accept", "application/json");
    for (const [name, value] of Object.entries(apiAuthHeaders(token, "POST"))) {
      request.setRequestHeader(name, value);
    }
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
    `${API_PREFIX}/inventory/counts/${encodeURIComponent(id)}/template.xlsx`,
    { headers: apiAuthHeaders(token) },
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

/**
 * A TÉTELES KÉSZLET-ÖSSZEVETÉS: soronként egy variáns és egy raktár.
 *
 * NEM UGYANAZ, MINT a `unasOrdersApi.checkStockReconciliation` -- az egy
 * összefoglaló riport az UNAS-rendelések oldaláról, és ma azt mutatja a
 * /keszlet-egyeztetes oldal. Ez a hívás a `inventory/reconciliation` modulé,
 * és a javító végpontok EHHEZ tartoznak.
 *
 * Mérve 2026-09-01: a két összevetés ugyanazon a néven futott a fejekben, és
 * emiatt úgy tűnt, hogy már látjuk azt, amit valójában soha nem kértünk le.
 */
export const stockItemReconciliationApi = {
  page(
    token: string,
    query: { page?: number; pageSize?: number } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return apiRequest<StockItemReconciliationPage>(
      `/inventory/reconciliation${suffix}`,
      token,
      { signal },
    );
  },

  summary(token: string, signal?: AbortSignal) {
    return apiRequest<StockItemReconciliationSummary>(
      "/inventory/reconciliation/summary",
      token,
      { signal },
    );
  },
};

/**
 * A UNAS KESZLET-KIMENOSOR: az ot vegpont, aminek eddig NULLA fogyasztoja volt.
 *
 * A mert allapot (nautilus, 2026-09-02): a summary vegpont pontosan azt az
 * alakot adja, amit a #337-ben bekotottunk, es sem a web, sem a mobil nem hivja
 * (pozitiv kontrollal ellenorizve). Vagyis senki nem latja, hany tetel torlodik
 * es mikor ment ki utoljara keszlet -- epp azt a ket szamot, amit a summary ad.
 *
 * A TIPUSOK A DROTON ATJOVO ALAKOT irjak le, nem a szerver belso tipusait: a
 * `Date` ISO-stringkent, a `Prisma.Decimal` pedig stringkent erkezik. Ha ide a
 * szerver-oldali alakot masolnank, a kulonbseg CSENDBEN jelenne meg a
 * kepernyon (ugyanaz a csapda, mint a mobil tipus-masolatnal, 2026-09-02).
 */
export type StockSyncOutboxStatus =
  "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER";

export interface StockSyncOutboxSummary {
  workerEnabled: boolean;
  /** `null`, ha a munkas ki van kapcsolva -- a vegpont maga donti el. */
  intervalMs: number | null;
  counts: Record<StockSyncOutboxStatus, number>;
  /** ISO idobelyeg, vagy `null`, ha meg SOHA nem ment ki keszlet. */
  lastSuccessfulPublishAt: string | null;
}

export interface StockSyncOutboxRow {
  id: string;
  variantId: string;
  warehouseId: string;
  sku: string;
  /** Decimal a szerveren, STRING a droton. */
  targetOnHand: string;
  status: StockSyncOutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  resolutionNote: string | null;
  sourceProcess: string;
  sourceRecordId: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

const OUTBOX_BASE = "/integrations/unas/stock-sync/outbox";

export const stockSyncOutboxApi = {
  summary(token: string, signal?: AbortSignal) {
    return apiRequest<StockSyncOutboxSummary>(`${OUTBOX_BASE}/summary`, token, {
      signal,
    });
  },

  list(
    token: string,
    query: { status?: StockSyncOutboxStatus; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.limit) params.set("limit", String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return apiRequest<StockSyncOutboxRow[]>(`${OUTBOX_BASE}${suffix}`, token, {
      signal,
    });
  },

  /**
   * Egy FAILED vagy DEAD_LETTER sor ujra sorba allitasa. `inventory.manage`
   * jogot igenyel, nem `view`-t: ez ujra utemez egy IRAST a UNAS fele.
   */
  retry(token: string, id: string) {
    return apiRequest<StockSyncOutboxRow>(
      `${OUTBOX_BASE}/${encodeURIComponent(id)}/retry`,
      token,
      { method: "POST" },
    );
  },

  /** Egy koteg azonnali lefuttatasa, az utemezo sajat kodutjan. */
  run(token: string) {
    return apiRequest<unknown>(`${OUTBOX_BASE}/run`, token, { method: "POST" });
  },
};
