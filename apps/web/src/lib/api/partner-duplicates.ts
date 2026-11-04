import type { PartnerDuplicateResponse } from "@acropora/types";

import { apiRequest } from "./client";

/** A partner-duplikátumok mérése (egy partnertörzs, 1. lépés): csak olvasó végpont. */
export const partnerDuplicatesApi = {
  report(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerDuplicateResponse>(
      "/admin/partner-duplicates",
      token,
      {
        signal,
      },
    );
  },
};
