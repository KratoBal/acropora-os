import { apiRequest } from "./client";

export type AssetKind =
  | "SYSTEM"
  | "EQUIPMENT"
  | "COMPONENT"
  | "SENSOR"
  | "OTHER";
export type AssetStatus =
  | "ACTIVE"
  | "OUT_OF_SERVICE"
  | "IN_REPAIR"
  | "RETIRED";
export type AssetCriticality = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  customer: { id: string; customerNumber: string; displayName: string };
  address?: { id: string; name?: string; formatted: string };
  aquarium?: { id: string; aquariumNumber: string; name: string };
  parent?: AssetHierarchyItem;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  nextServiceAt?: string;
  childCount: number;
  updatedAt: string;
}

export interface AssetDetail extends AssetListItem {
  qrToken: string;
  category?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  notes?: string;
  product?: { variantId: string; sku: string; name: string };
  ancestors: AssetHierarchyItem[];
  children: AssetHierarchyItem[];
  events: Array<{
    id: string;
    type: string;
    actor?: { id: string; displayName: string };
    occurredAt: string;
  }>;
  createdAt: string;
}

export interface AssetListResponse {
  items: AssetListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export function listAssets(page = 1, pageSize = 50) {
  return apiRequest<AssetListResponse>(
    `/service/assets?page=${page}&pageSize=${pageSize}&status=ACTIVE`,
  );
}

export function getAsset(id: string) {
  return apiRequest<AssetDetail>(`/service/assets/${encodeURIComponent(id)}`);
}

export function scanAsset(qrToken: string) {
  return apiRequest<AssetDetail>(
    `/service/assets/scan/${encodeURIComponent(qrToken)}`,
  );
}
