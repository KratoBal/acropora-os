import type {
  CatalogActionKind,
  CatalogActionRun,
  CatalogActionsResponse,
} from "@acropora/types";
import { apiRequest } from "./client";

export const catalogActionsApi = {
  overview(token: string, signal?: AbortSignal) {
    return apiRequest<CatalogActionsResponse>("/catalog-actions", token, {
      signal,
    });
  },
  run(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<CatalogActionRun>(
      `/catalog-actions/runs/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  plan(token: string, kind: CatalogActionKind) {
    return apiRequest<CatalogActionRun>(
      `/catalog-actions/${encodeURIComponent(kind)}/plan`,
      token,
      { method: "POST" },
    );
  },
  apply(token: string, kind: CatalogActionKind, planRunId: string) {
    return apiRequest<CatalogActionRun>(
      `/catalog-actions/${encodeURIComponent(kind)}/apply`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planRunId }),
      },
    );
  },
};
