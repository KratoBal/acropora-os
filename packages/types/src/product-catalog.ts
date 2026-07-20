export type ProductType = "PHYSICAL" | "SERVICE" | "LIVESTOCK";

export interface ProductBrandSummary {
  id: string;
  name: string;
}

export interface ProductCategorySummary {
  id: string;
  name: string;
  isPrimary: boolean;
  sortOrder: number | null;
}

export interface ProductVariantSummary {
  id: string;
  sku: string;
  name: string | null;
  unit: string;
  isActive: boolean;
  vatRate: string | null;
  manufacturerPartNumber: string | null;
  secondaryUnit: string | null;
  secondaryUnitFactor: string | null;
  extension: import("./product-extension.js").ProductExtensionDetail | null;
}

export interface UnasProductMirrorDetail {
  source: "UNAS";
  state: "ACTIVE" | "MISSING" | "CONFLICT" | null;
  externalId: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  missingSince: string | null;
  currency: string | null;
  netPrice: string | null;
  grossPrice: string | null;
  saleNetPrice: string | null;
  saleGrossPrice: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  priceDisplay: string | null;
  productUrl: string | null;
  manufacturerUrl: string | null;
  minimumOrderQuantity: string | null;
  maximumOrderQuantity: string | null;
  orderQuantityStep: string | null;
  lowStockThreshold: string | null;
  backorderAllowed: boolean | null;
  variantStockEnabled: boolean | null;
  reportedStock: string | null;
  reportedStockSyncedAt: string | null;
}

export interface ProductImageSummary {
  id: string;
  url: string;
  sortOrder: number;
  altText: string | null;
  title: string | null;
}

export interface ProductChannelListingSummary {
  channel: "UNAS";
  externalStatus: string | null;
  isPublished: boolean;
  slug: string | null;
  productUrl: string | null;
  seoTitle: string | null;
  backorderAllowed: boolean;
}

export interface ProductListItem {
  id: string;
  name: string;
  productType: ProductType;
  isActive: boolean;
  archivedAt: string | null;
  brand: ProductBrandSummary | null;
  primaryCategory: ProductCategorySummary | null;
  primarySku: string | null;
  thumbnail: ProductImageSummary | null;
  unasListing: ProductChannelListingSummary | null;
}

export interface ProductListResponse {
  items: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  categories: ProductCategorySummary[];
  variants: ProductVariantSummary[];
  images: ProductImageSummary[];
  channelListings: ProductChannelListingSummary[];
  unasMirror: UnasProductMirrorDetail | null;
}

export interface CatalogOption {
  id: string;
  label: string;
}

export interface ProductListApiQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  active?: boolean;
  categoryId?: string;
  brandId?: string;
}
