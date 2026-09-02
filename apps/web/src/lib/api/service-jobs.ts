import type {
  ServiceJobDetail,
  ServiceJobListResponse,
  ServiceJobStatusValue,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/service/jobs";

function jobPath(id: string, suffix = "") {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const serviceJobsApi = {
  list(token: string, scope: "open" | "all", signal?: AbortSignal) {
    return apiRequest<ServiceJobListResponse>(`${base}?scope=${scope}`, token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<ServiceJobDetail>(jobPath(id), token, { signal });
  },
  /**
   * A LÉPÉS VÁLASZA CSAK NYUGTA (`{ ok: true }`), nem a friss jegy.
   *
   * Ezért a hívó ÚJRATÖLT utána. Ha a nyugtából építenénk fel a képernyőt, a
   * napló új sora hiányozna róla - és épp az a sor a lépés bizonyítéka.
   */
  move(
    token: string,
    id: string,
    input: { to: ServiceJobStatusValue; note?: string | null },
  ) {
    return apiRequest<{ ok: true }>(jobPath(id, "/move"), token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
