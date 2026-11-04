import type {
  PartnerMergeExecuteInput,
  PartnerMergeLogEntry,
  PartnerMergePreview,
  PartnerMergeUndoResult,
} from "@acropora/types";

import { apiRequest } from "./client";

const post = <T>(path: string, token: string, body: unknown) =>
  apiRequest<T>(path, token, { method: "POST", body: JSON.stringify(body) });

/** Két vevő-sor összevonása a partnertörzsben: előnézet, végrehajtás a lenyomattal, napló, visszavonás. */
export const partnerMergeApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerMergeLogEntry[]>("/admin/partner-merges", token, {
      signal,
    });
  },
  preview(token: string, keptId: string, mergedId: string) {
    return post<PartnerMergePreview>("/admin/partner-merges/preview", token, {
      keptId,
      mergedId,
    });
  },
  execute(token: string, input: PartnerMergeExecuteInput) {
    return post<PartnerMergeLogEntry>(
      "/admin/partner-merges/execute",
      token,
      input,
    );
  },
  undo(token: string, logId: string) {
    return post<PartnerMergeUndoResult>(
      `/admin/partner-merges/${encodeURIComponent(logId)}/undo`,
      token,
      {},
    );
  },
};
