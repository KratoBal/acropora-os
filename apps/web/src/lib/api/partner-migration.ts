import type { PartnerMigrationPlan } from "@acropora/types";

import { apiRequest } from "./client";

/** A partnerek átvezetésének terve (egyszeri átvezetés): csak olvasó végpont. */
export const partnerMigrationApi = {
  plan(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerMigrationPlan>("/admin/partner-migration", token, {
      signal,
    });
  },
};
