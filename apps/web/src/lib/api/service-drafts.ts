import type {
  ServiceDraftListResponse,
  ServiceDraftStatus,
  ServiceDraftSyncStatus,
} from "@acropora/types";
import { apiRequest, apiAuthHeaders, ApiError } from "./client";
import { API_PREFIX } from "./api-prefix";
export const serviceDraftsApi = {
  list: (
    token: string,
    status: ServiceDraftStatus,
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    apiRequest<ServiceDraftListResponse>(
      `/service/drafts?${new URLSearchParams({ status, ...(cursor ? { cursor } : {}) })}`,
      token,
      { signal },
    ),
  status: (token: string, signal?: AbortSignal) =>
    apiRequest<ServiceDraftSyncStatus>("/service/drafts/sync-status", token, {
      signal,
    }),
  accept: (
    token: string,
    id: string,
    departmentId: string,
    reporterPersonName: string,
  ) =>
    apiRequest<{ serviceJobId: string }>(
      `/service/drafts/${encodeURIComponent(id)}/accept`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ departmentId, reporterPersonName }),
      },
    ),
  /** "Mégis piszkozat": egy kiszűrt tétel vissza a listára. */
  promote: (token: string, id: string) =>
    apiRequest<{ id: string }>(
      `/service/drafts/${encodeURIComponent(id)}/promote`,
      token,
      { method: "POST" },
    ),
  reject: (token: string, id: string) =>
    apiRequest<{ serviceJobId: null }>(
      `/service/drafts/${encodeURIComponent(id)}/reject`,
      token,
      { method: "POST" },
    ),
  async attachment(token: string, id: string, signal?: AbortSignal) {
    const r = await fetch(
      `${API_PREFIX}/service/drafts/attachments/${encodeURIComponent(id)}`,
      { headers: apiAuthHeaders(token), signal },
    );
    if (!r.ok) throw new ApiError("A csatolmány nem tölthető be.", r.status);
    return r.blob();
  },
};
