export interface ProductExtensionDetail {
  variantId: string;
  preferredSupplierId: string | null;
  defaultPurchaseCurrency: string | null;
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
  minimumStock: string | null;
  optimalStock: string | null;
  reorderPoint: string | null;
  safetyStock: string | null;
  lastPurchaseNetPrice: string | null;
  lastPurchaseVatRate: string | null;
  stockTrackingEnabled: boolean;
  purchasingDisabled: boolean;
  phaseOut: boolean;
  autoReorderEnabled: boolean;
  internalNote: string | null;
  updatedAt: string;
}

export interface ProductExtensionUpdateInput {
  defaultPurchaseCurrency?: string | null;
  minimumStock?: string | null;
  optimalStock?: string | null;
  reorderPoint?: string | null;
  safetyStock?: string | null;
  lastPurchaseNetPrice?: string | null;
  lastPurchaseVatRate?: string | null;
  stockTrackingEnabled?: boolean;
  purchasingDisabled?: boolean;
  phaseOut?: boolean;
  autoReorderEnabled?: boolean;
  internalNote?: string | null;
}
