import { apiRequest } from "./client";

/**
 * THE PRODUCT DOSE LIST (ReefClub plan v6.1, 6.2; slice 7): the shapes the API
 * answers (`apps/api/src/products/dose-effects/dose-effects.service.ts`) and
 * the calls. Kept beside the other product calls, like the shipping profile.
 */
export type DoseEffectDirection = "EMEL" | "CSOKKENT";
export type DoseUnit = "ML" | "G" | "CSEPP";
export type DoseEffectRefusal =
  | "ARCHIVED"
  | "NO_SOURCE"
  | "NOT_VERIFIED"
  | "SAME_COLLEAGUE"
  | "NO_MAX_DAILY"
  | "JEV_DISAGREES"
  | "NOT_PURCHASABLE";

export interface DoseEffectView {
  id: string;
  productId: string;
  productName: string;
  parameterCode: string;
  direction: DoseEffectDirection;
  effectPer100L: number;
  doseUnit: DoseUnit;
  doseStep: number;
  maxDailyDosePer100L: number | null;
  effectHours: number | null;
  source: string;
  version: number;
  recordedBy: { id: string; name: string } | null;
  /** Also when the recorder's account is gone (then `recordedBy` is null). */
  recordedByName: string | null;
  recordedAt: string;
  verifiedBy: { id: string; name: string } | null;
  verifiedAt: string | null;
  archivedAt: string | null;
  archivedBy: { id: string; name: string } | null;
  usable: boolean;
  refusals: DoseEffectRefusal[];
  jevStatus: "VERIFIED" | "UNVERIFIED" | "CONFLICTING" | "NONE";
}

export interface DoseEffectInput {
  parameterCode: string;
  direction: DoseEffectDirection;
  effectPer100L: number;
  doseUnit: DoseUnit;
  doseStep: number;
  maxDailyDosePer100L?: number;
  effectHours?: number;
  source: string;
}

export interface DoseEffectEdit {
  expectedVersion: number;
  effectPer100L?: number;
  doseUnit?: DoseUnit;
  doseStep?: number;
  maxDailyDosePer100L?: number | null;
  effectHours?: number | null;
  source?: string;
}

export interface DoseEffectSuggestion {
  productId: string;
  jev: {
    status: "VERIFIED" | "UNVERIFIED" | "CONFLICTING" | "NONE";
    effects: { parameterCode: string; direction: DoseEffectDirection }[];
    sourceRef: string | null;
  };
  dosing: { status: string; value: string } | null;
  rows: {
    parameterCode: string;
    direction: DoseEffectDirection;
    source: string | null;
  }[];
}

// The path shapes the route guard (apps/api/src/mobile/mobile-api-routes.spec.ts)
// can read: a string prefix and helpers whose single return is a template.
const products = "/products";
const doseEffects = "/dose-effects";

function productPath(id: string, suffix = "") {
  return `${products}/${encodeURIComponent(id)}/dose-effects${suffix}`;
}

function rowPath(id: string, suffix = "") {
  return `${doseEffects}/${encodeURIComponent(id)}${suffix}`;
}

export const doseEffectApi = {
  forProduct(token: string, productId: string) {
    return apiRequest<{ items: DoseEffectView[] }>(
      productPath(productId),
      token,
    );
  },
  suggestion(token: string, productId: string) {
    return apiRequest<DoseEffectSuggestion>(
      productPath(productId, "/suggestion"),
      token,
    );
  },
  create(token: string, productId: string, input: DoseEffectInput) {
    return apiRequest<DoseEffectView>(productPath(productId), token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  list(token: string, query: { parameterCode?: string } = {}) {
    const params = new URLSearchParams();
    if (query.parameterCode) params.set("parameterCode", query.parameterCode);
    return apiRequest<{ items: DoseEffectView[] }>(
      `${doseEffects}?${params.toString()}`,
      token,
    );
  },
  update(token: string, id: string, edit: DoseEffectEdit) {
    return apiRequest<DoseEffectView>(rowPath(id), token, {
      method: "PATCH",
      body: JSON.stringify(edit),
    });
  },
  verify(token: string, id: string, expectedVersion: number) {
    return apiRequest<DoseEffectView>(rowPath(id, "/verify"), token, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  },
  archive(token: string, id: string) {
    return apiRequest<void>(rowPath(id), token, { method: "DELETE" });
  },
};
