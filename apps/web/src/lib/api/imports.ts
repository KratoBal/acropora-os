import type {
  BrandReviewBulkDecisionInput,
  BrandReviewDecisionInput,
  BrandReviewListItem,
  BrandReviewListResponse,
  UnasApplySummary,
  UnasApprovalResult,
  UnasImportReport,
} from "@acropora/types";

import { ApiError, apiRequest } from "./client";

const MAX_XLSX_SIZE = 25 * 1024 * 1024;

export function validateUnasImportFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    return "Csak XLSX fájl tölthető fel.";
  if (file.size > MAX_XLSX_SIZE)
    return "A fájl legfeljebb 25 MiB méretű lehet.";
  return null;
}

function uploadDryRun(
  token: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<UnasImportReport> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/imports/unas/catalog/dry-run");
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    });
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
        onProgress(100);
        resolve(payload as UnasImportReport);
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

export const importApi = {
  uploadDryRun,
  report(token: string, batchId: string) {
    return apiRequest<UnasImportReport>(
      `/imports/unas/${encodeURIComponent(batchId)}/report`,
      token,
    );
  },
  brandReviews(
    token: string,
    batchId: string,
    query: URLSearchParams,
    signal?: AbortSignal,
  ) {
    return apiRequest<BrandReviewListResponse>(
      `/imports/unas/${encodeURIComponent(batchId)}/brand-reviews?${query}`,
      token,
      { signal },
    );
  },
  decideBrandReview(
    token: string,
    batchId: string,
    reviewId: string,
    input: BrandReviewDecisionInput,
  ) {
    return apiRequest<BrandReviewListItem>(
      `/imports/unas/${encodeURIComponent(batchId)}/brand-reviews/${encodeURIComponent(reviewId)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  decideBrandReviewsBulk(
    token: string,
    batchId: string,
    input: BrandReviewBulkDecisionInput,
  ) {
    return apiRequest<{ updated: number }>(
      `/imports/unas/${encodeURIComponent(batchId)}/brand-reviews/bulk`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  approve(token: string, batchId: string) {
    return apiRequest<UnasApprovalResult>(
      `/imports/unas/${encodeURIComponent(batchId)}/approve`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
  },
  apply(token: string, batchId: string) {
    return apiRequest<UnasApplySummary>(
      `/imports/unas/${encodeURIComponent(batchId)}/apply`,
      token,
      { method: "POST" },
    );
  },
};
