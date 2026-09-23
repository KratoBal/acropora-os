import type { AssetFunctionListResponse } from "@acropora/types";

import { apiRequest } from "./client";

const base = "/asset-functions";

/** SZO SZERINT AZ `asset-categories.ts` -- lasd ott a teljes indoklast. */
export const assetFunctionsApi = {
  list(token: string, includeInactive = false, signal?: AbortSignal) {
    const query = includeInactive ? "?includeInactive=true" : "";
    return apiRequest<AssetFunctionListResponse>(`${base}${query}`, token, {
      signal,
    });
  },
  create(token: string, input: { name: string; sortOrder?: number }) {
    return apiRequest(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(
    token: string,
    id: string,
    input: { name?: string; isActive?: boolean; sortOrder?: number },
  ) {
    return apiRequest(`${base}/${encodeURIComponent(id)}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /** KIVEZET, nem torol -- a valasz `{ retired: true }`, es ez kimondja. */
  retire(token: string, id: string) {
    return apiRequest<{ retired: true }>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
  },
};
