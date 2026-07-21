export interface UnasApiProduct {
  externalId: string;
  sku: string;
  name: string;
  state: "live" | "deleted";
  externalStatus: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  descriptionShort: string | null;
  descriptionLong: string | null;
  descriptionShortIsHtml: boolean | null;
  descriptionLongIsHtml: boolean | null;
  unit: string | null;
  secondaryUnit: string | null;
  secondaryUnitFactor: string | null;
  manufacturerPartNumber: string | null;
  brandName: string | null;
  vatRate: string | null;
  netPrice: string | null;
  grossPrice: string | null;
  saleNetPrice: string | null;
  saleGrossPrice: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  priceDisplay: string | null;
  minimumOrderQuantity: string | null;
  maximumOrderQuantity: string | null;
  lowStockThreshold: string | null;
  orderQuantityStep: string | null;
  backorderAllowed: boolean | null;
  variantStockEnabled: boolean | null;
  reportedStock: string | null;
  productUrl: string | null;
  sefUrl: string | null;
  manufacturerUrl: string | null;
  primaryCategoryExternalId: string | null;
  alternativeCategoryExternalIds: string[];
  images: Array<{
    type: "base" | "alt";
    id: string | null;
    sefUrl: string | null;
    filename: string | null;
    alt: string | null;
  }>;
  parameters: Array<{
    id: string;
    type: string | null;
    name: string;
    value: string;
  }>;
  seo: {
    title: string | null;
    description: string | null;
    keywords: string | null;
    robots: string | null;
  };
  rawPayload: Record<string, unknown>;
}

export interface UnasApiOrderItem {
  /** Special line ids (e.g. "shipping-cost", "discount-amount") have no SKU and aren't stock-relevant. */
  id: string;
  sku: string | null;
  name: string;
  unit: string | null;
  quantity: string;
  priceNet: string | null;
  priceGross: string | null;
  /** e.g. "27" (percent, "%" suffix already stripped). Null for non-stock lines without VAT. */
  vatRate: string | null;
}

export interface UnasApiOrder {
  /** UNAS's own order identifier, used for idempotency (ExternalReference.externalId). */
  key: string;
  internalKey: string | null;
  status: string | null;
  /** open_normal | open_prepare | close_ok | close_fault, when present. */
  statusType: string | null;
  statusId: string | null;
  /** Best-effort parse of the Date field; null if the format couldn't be recognized. */
  orderedAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  currency: string | null;
  sumPriceGross: string | null;
  /** e.g. "Bankkártya", "Utánvét" - UNAS's own payment method name, for display only. */
  paymentName: string | null;
  /** e.g. bankcard | cod | transfer | ... - UNAS's own payment type code. */
  paymentType: string | null;
  /** e.g. "paid" | "unpaid" | "partly paid" | "overpaid" - free-text per UNAS docs, not a closed enum. */
  paymentStatus: string | null;
  /** e.g. "GLS", "FoxPost" - UNAS's own shipping/courier name, for display only. */
  shippingName: string | null;
  items: UnasApiOrderItem[];
}

export interface UnasApiCategory {
  externalId: string;
  name: string;
  state: "live" | "deleted";
  parentExternalId: string | null;
  sortOrder: number | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  rawPayload: Record<string, unknown>;
}

export interface CanonicalUnasProduct extends UnasApiProduct {
  canonicalHash: string;
}

export interface UnasProductIdentitySnapshot {
  productId: string;
  externalId: string;
  sku: string;
  canonicalHash: string | null;
  mirrorState?: "ACTIVE" | "MISSING" | "CONFLICT" | null;
}

export type UnasProductSyncAction =
  "CREATE" | "UPDATE" | "UNCHANGED" | "CONFLICT";

export interface UnasProductSyncDiff {
  product: CanonicalUnasProduct;
  action: UnasProductSyncAction;
  productId: string | null;
  reason:
    "NEW" | "HASH_CHANGED" | "SAME_HASH" | "IDENTITY_CONFLICT" | "RESTORE";
}
