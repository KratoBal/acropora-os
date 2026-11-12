import { apiRequest } from "./client";

/**
 * THE MANUFACTURER CLAIMS (T5.3): the shapes the API answers
 * (`apps/api/src/products/manufacturer-claims/manufacturer-claims.service.ts`) and the calls.
 */
export type ClaimType =
  | "DOSING"
  | "EFFECT"
  | "COMPOSITION"
  | "APPLICABILITY"
  | "SAFETY"
  | "ADVERTISING"
  | "OTHER";
export type ClaimSourceKind =
  | "DATASHEET"
  | "MANUFACTURER_PAGE"
  | "LABEL"
  | "MANUFACTURER_GUIDE"
  | "AUTHOR_ARTICLE";
export type ClaimStatus =
  | "UNVERIFIED"
  | "MATCHES_MANUFACTURER"
  | "INDEPENDENTLY_CONFIRMED"
  | "DISPUTED";
export type ClaimOutputReason =
  | "ARCHIVED"
  | "DISPUTED"
  | "UNVERIFIED"
  | "KNOWLEDGE_FACT_CHANGED"
  | "KNOWLEDGE_FACT_NOT_LINKED"
  | "ADVERTISING_NOT_CONFIRMED";

export interface ClaimOutput {
  mode: "PUBLISHABLE" | "DRAFT_ONLY" | "BLOCKED";
  effectiveStatus: ClaimStatus;
  attribution: string | null;
  placeholder: string | null;
  verbatimAllowed: boolean;
  checkRequiredBeforeSend: boolean;
  reasons: ClaimOutputReason[];
}

export interface ManufacturerClaimView {
  id: string;
  productId: string;
  productName: string;
  brand: { id: string; name: string } | null;
  claimType: ClaimType;
  claimText: string;
  sourceKind: ClaimSourceKind;
  sourceRef: string;
  sourcePublishedOn: string | null;
  sourceReadOn: string;
  valueAmount: number | null;
  valueUnit: string | null;
  note: string | null;
  recheckOn: string | null;
  knowledgeFact: {
    id: string;
    field: string;
    value: string | null;
    unit: string | null;
    revision: number;
  } | null;
  knowledgeFactRevision: number | null;
  knowledgeLink: "NONE" | "CURRENT" | "CHANGED" | "MISSING_LINK";
  status: ClaimStatus;
  version: number;
  recordedBy: { id: string; name: string } | null;
  recordedAt: string;
  verifiedBy: { id: string; name: string } | null;
  verifiedAt: string | null;
  archivedAt: string | null;
  archivedBy: { id: string; name: string } | null;
  output: ClaimOutput;
}

export interface ManufacturerClaimInput {
  claimType: ClaimType;
  claimText: string;
  sourceKind: ClaimSourceKind;
  sourceRef: string;
  sourcePublishedOn?: string;
  sourceReadOn: string;
  valueAmount?: number;
  valueUnit?: string;
  note?: string;
  knowledgeFactId?: string;
}

export interface ClaimContentItem {
  id: string;
  title: string;
  channel: string;
  state: string;
  plannedFor: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  linkedAt: string;
}

// The path shapes the route guard (apps/api/src/mobile/mobile-api-routes.spec.ts)
// can read: a string prefix and helpers whose single return is a template.
const products = "/products";
const claims = "/manufacturer-claims";

function productPath(id: string) {
  return `${products}/${encodeURIComponent(id)}/manufacturer-claims`;
}

function claimPath(id: string, suffix = "") {
  return `${claims}/${encodeURIComponent(id)}${suffix}`;
}

export const manufacturerClaimApi = {
  forProduct(token: string, productId: string) {
    return apiRequest<{ items: ManufacturerClaimView[]; truncated: boolean }>(
      productPath(productId),
      token,
    );
  },
  create(token: string, productId: string, input: ManufacturerClaimInput) {
    return apiRequest<ManufacturerClaimView>(productPath(productId), token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  list(
    token: string,
    query: { status?: ClaimStatus; claimType?: ClaimType } = {},
  ) {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.claimType) params.set("claimType", query.claimType);
    return apiRequest<{ items: ManufacturerClaimView[]; truncated: boolean }>(
      `${claims}?${params.toString()}`,
      token,
    );
  },
  setStatus(
    token: string,
    id: string,
    expectedVersion: number,
    status: ClaimStatus,
  ) {
    return apiRequest<ManufacturerClaimView>(claimPath(id, "/status"), token, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, status }),
    });
  },
  archive(token: string, id: string) {
    return apiRequest<void>(claimPath(id), token, { method: "DELETE" });
  },
  content(token: string, id: string) {
    return apiRequest<{ items: ClaimContentItem[] }>(
      claimPath(id, "/content"),
      token,
    );
  },
};
