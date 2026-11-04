import type {
  PartnerMergeExecuteInput,
  PartnerMergeLogEntry,
  PartnerMergePreview,
  PartnerMergeUndoResult,
} from "@acropora/types";

import { apiRequest } from "./client";

/** Két vevő-sor összevonása a partnertörzsben: előnézet, végrehajtás a lenyomattal, napló, visszavonás. */
export const partnerMergeApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerMergeLogEntry[]>("/admin/partner-merges", token, {
      signal,
    });
  },
  preview(token: string, keptId: string, mergedId: string) {
    return apiRequest<PartnerMergePreview>(
      "/admin/partner-merges/preview",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          keptId,
          mergedId,
        }),
      },
    );
  },
  execute(token: string, input: PartnerMergeExecuteInput) {
    return apiRequest<PartnerMergeLogEntry>(
      "/admin/partner-merges/execute",
      token,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
  undo(token: string, logId: string) {
    return apiRequest<PartnerMergeUndoResult>(
      `/admin/partner-merges/${encodeURIComponent(logId)}/undo`,
      token,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  },
};
