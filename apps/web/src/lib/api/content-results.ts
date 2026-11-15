import type {
  ContentResultValues,
  ContentResults,
  ContentResultsSummary,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A tartalom eredménye (T5.5 S8): a tétel heti számai, a heti felvitel és az összesítő. */
export const contentResultsApi = {
  results(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ContentResults>(
      `/content/${encodeURIComponent(id)}/results`,
      token,
      { signal },
    );
  },
  /** A hét a hétfőjével; a ki nem töltött mező `null` (nem 0). */
  saveWeek(
    token: string,
    id: string,
    weekStart: string,
    values: ContentResultValues,
  ) {
    return apiRequest<ContentResults>(
      `/content/${encodeURIComponent(id)}/results/${weekStart}`,
      token,
      { method: "PUT", body: JSON.stringify(values) },
    );
  },
  summary(token: string, from: string, to: string, signal?: AbortSignal) {
    return apiRequest<ContentResultsSummary>(
      `/content/results/summary?from=${from}&to=${to}`,
      token,
      { signal },
    );
  },
};
