import type {
  PartnerMigrationApplyInput,
  PartnerMigrationApplyResult,
  PartnerMigrationPlan,
  PartnerMigrationRestoreInput,
  PartnerMigrationRestorePreview,
  PartnerMigrationRestoreResult,
  PartnerMigrationRunPreview,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A partnerek átvezetése (egyszeri átvezetés). A terv és a két próba csak olvas; az írás (`apply`, `restoreApply`) a próba
 * lenyomatát kéri vissza, ahogy a `partner:migrate` parancs is.
 */
export const partnerMigrationApi = {
  plan(token: string, signal?: AbortSignal) {
    return apiRequest<PartnerMigrationPlan>("/admin/partner-migration", token, {
      signal,
    });
  },
  preview(token: string, binds: Record<string, string>) {
    return apiRequest<PartnerMigrationRunPreview>(
      "/admin/partner-migration/preview",
      token,
      {
        method: "POST",
        body: JSON.stringify({ binds }),
      },
    );
  },
  apply(token: string, input: PartnerMigrationApplyInput) {
    return apiRequest<PartnerMigrationApplyResult>(
      "/admin/partner-migration/apply",
      token,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
  restorePreview(token: string) {
    return apiRequest<PartnerMigrationRestorePreview>(
      "/admin/partner-migration/restore/preview",
      token,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  },
  restoreApply(token: string, input: PartnerMigrationRestoreInput) {
    return apiRequest<PartnerMigrationRestoreResult>(
      "/admin/partner-migration/restore/apply",
      token,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
};
