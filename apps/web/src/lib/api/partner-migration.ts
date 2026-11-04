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

const post = <T>(path: string, token: string, body: unknown) =>
  apiRequest<T>(path, token, { method: "POST", body: JSON.stringify(body) });

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
    return post<PartnerMigrationRunPreview>(
      "/admin/partner-migration/preview",
      token,
      { binds },
    );
  },
  apply(token: string, input: PartnerMigrationApplyInput) {
    return post<PartnerMigrationApplyResult>(
      "/admin/partner-migration/apply",
      token,
      input,
    );
  },
  restorePreview(token: string) {
    return post<PartnerMigrationRestorePreview>(
      "/admin/partner-migration/restore/preview",
      token,
      {},
    );
  },
  restoreApply(token: string, input: PartnerMigrationRestoreInput) {
    return post<PartnerMigrationRestoreResult>(
      "/admin/partner-migration/restore/apply",
      token,
      input,
    );
  },
};
