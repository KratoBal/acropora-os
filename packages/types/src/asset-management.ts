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

export type AssetEventType =
  | "CREATED"
  | "UPDATED"
  | "PLACEMENT_CHANGED"
  | "PARENT_CHANGED"
  | "STATUS_CHANGED"
  | "QR_ROTATED";

export interface AssetCustomerSummary {
  id: string;
  customerNumber: string;
  displayName: string;
}

export interface AssetAddressSummary {
  id: string;
  name?: string;
  formatted: string;
}

export interface AssetAquariumSummary {
  id: string;
  aquariumNumber: string;
  name: string;
}

export interface AssetHierarchyItem {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
}

export interface AssetProductSummary {
  variantId: string;
  sku: string;
  name: string;
}

export interface AssetListItem extends AssetHierarchyItem {
  criticality: AssetCriticality;
  customer: AssetCustomerSummary;
  address?: AssetAddressSummary;
  aquarium?: AssetAquariumSummary;
  parent?: AssetHierarchyItem;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  nextServiceAt?: string;
  childCount: number;
  updatedAt: string;
}

export interface AssetEventSummary {
  id: string;
  type: AssetEventType;
  actor?: {
    id: string;
    displayName: string;
  };
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface AssetDetail extends AssetListItem {
  qrToken: string;
  category?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  purchasedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  notes?: string;
  archivedAt?: string;
  product?: AssetProductSummary;
  ancestors: AssetHierarchyItem[];
  children: AssetHierarchyItem[];
  events: AssetEventSummary[];
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

export interface CreateAssetInput {
  customerId: string;
  customerAddressId?: string;
  aquariumId?: string;
  parentAssetId?: string;
  productVariantId?: string;
  kind: AssetKind;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  name: string;
  category?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  inventoryNumber?: string;
  description?: string;
  installedAt?: string;
  purchasedAt?: string;
  warrantyExpiresAt?: string;
  serviceIntervalDays?: number;
  lastServicedAt?: string;
  nextServiceAt?: string;
  notes?: string;
}

export interface UpdateAssetInput {
  customerAddressId?: string | null;
  aquariumId?: string | null;
  parentAssetId?: string | null;
  productVariantId?: string | null;
  kind?: AssetKind;
  status?: AssetStatus;
  criticality?: AssetCriticality;
  name?: string;
  category?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  inventoryNumber?: string | null;
  description?: string | null;
  installedAt?: string | null;
  purchasedAt?: string | null;
  warrantyExpiresAt?: string | null;
  serviceIntervalDays?: number | null;
  lastServicedAt?: string | null;
  nextServiceAt?: string | null;
  notes?: string | null;
  expectedUpdatedAt: string;
}

export interface AssetQrCode {
  assetId: string;
  assetNumber: string;
  value: string;
  svg: string;
}
