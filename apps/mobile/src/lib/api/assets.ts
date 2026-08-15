import { apiRequest } from "./client";

export type AssetKind =
  "SYSTEM" | "EQUIPMENT" | "COMPONENT" | "SENSOR" | "OTHER";
export type AssetStatus = "ACTIVE" | "OUT_OF_SERVICE" | "IN_REPAIR" | "RETIRED";
export type AssetCriticality = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type AssetOwnerType = "CUSTOMER" | "SUPPLIER";

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  owner: {
    type: AssetOwnerType;
    id: string;
    code: string;
    displayName: string;
  };
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
  events: {
    id: string;
    type: string;
    actor?: { id: string; displayName: string };
    occurredAt: string;
  }[];
  createdAt: string;
}

export interface AssetOwnerOption {
  type: AssetOwnerType;
  id: string;
  code: string;
  displayName: string;
  isActive: boolean;
  addresses: { id: string; name?: string; formatted: string }[];
}

export interface AssetQrCode {
  assetId: string;
  assetNumber: string;
  value: string;
  svg: string;
  labelSizeMm: 30;
}

export interface CreateAssetInput {
  ownerType: AssetOwnerType;
  ownerId: string;
  customerAddressId?: string;
  parentAssetId?: string;
  kind: AssetKind;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installedAt?: string;
  serviceIntervalDays?: number;
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

export function listAssetOwners() {
  return apiRequest<{ items: AssetOwnerOption[] }>("/service/assets/owners");
}

export function createAsset(input: CreateAssetInput) {
  return apiRequest<AssetDetail>("/service/assets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAssetQr(id: string) {
  return apiRequest<AssetQrCode>(
    `/service/assets/${encodeURIComponent(id)}/qr`,
  );
}
