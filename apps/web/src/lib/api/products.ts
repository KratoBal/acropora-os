import type {
  AddProductBarcodeInput,
  CatalogOption,
  ProductBarcodeListResponse,
  ProductBarcodeSummary,
  ProductCopyBlock,
  ProductDetail,
  ProductEnrichmentReview,
  ProductKnowledge,
  ProductManualEvidenceInput,
  ProductManualEvidenceResult,
  ProductQualityQueueFilter,
  ProductQualityQueuePage,
  ProductExtensionDetail,
  ProductExtensionUpdateInput,
  ProductListApiQuery,
  ProductListResponse,
  ProductUpdateInput,
} from "@acropora/types";

import { apiRequest } from "./client";

function productQueryString(query: ProductListApiQuery): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.active !== undefined) params.set("active", String(query.active));
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.brandId) params.set("brandId", query.brandId);
  if (query.listedOn) params.set("listedOn", query.listedOn);
  if (query.shipping) params.set("shipping", query.shipping);
  if (query.shippingUnasDiffers) params.set("shippingUnasDiffers", "true");
  return params.toString();
}

/** A negy kezzel gondozott szallitasi jelzo. Mind kotelezo: reszleges iras nincs. */
export interface ProductShippingProfileInput {
  pickupOnly: boolean;
  foxpostForbidden: boolean;
  isHeavy: boolean;
  isFrozen: boolean;
}

export interface ProductShippingProfileDetail extends ProductShippingProfileInput {
  productId: string;
  updatedAt: string;
}

/** A szállítási jelzők (a82ed229); a csomagautomata-jelzőnek nincs UNAS-forrása. */
export type ShippingFlag =
  "pickupOnly" | "foxpostForbidden" | "isHeavy" | "isFrozen";

/** A tömeges szerkesztés: beállítás kézzel, vagy vissza „UNAS szerint”. */
export interface ProductShippingBulkInput {
  productIds: string[];
  set?: Partial<Record<ShippingFlag | "lockerUnsuitable", boolean>>;
  resetToUnas?: ShippingFlag[];
}

export interface ProductShippingBulkResult {
  updated: number;
  created: number;
  missing: string[];
}

export const productApi = {
  bulkShippingProfiles(token: string, input: ProductShippingBulkInput) {
    return apiRequest<ProductShippingBulkResult>(
      "/products/shipping-profiles/bulk",
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  list(token: string, query: ProductListApiQuery) {
    return apiRequest<ProductListResponse>(
      `/products?${productQueryString(query)}`,
      token,
    );
  },
  detail(token: string, id: string) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}`,
      token,
    );
  },
  /** The catalogue data-quality queue (PD-013): one page, filtered on the server. */
  qualityQueue(
    token: string,
    filter: ProductQualityQueueFilter,
    cursor: string | null,
  ) {
    const query = new URLSearchParams({ filter });
    if (cursor) query.set("cursor", cursor);
    return apiRequest<ProductQualityQueuePage>(
      `/products/enrichment/queue?${query}`,
      token,
    );
  },
  /**
   * The JEV data review of one product, read only
   * (docs/jev-product-intelligence/v1-discovery.md §11/1): the availability
   * for this user and the latest stored shadow run (PD-013).
   */
  enrichment(token: string, id: string) {
    return apiRequest<ProductEnrichmentReview>(
      `/products/${encodeURIComponent(id)}/enrichment`,
      token,
    );
  },
  /**
   * PRODUCT KNOWLEDGE (#1431): the accepted facts and the customer copy. The
   * writes need `products.knowledge.approve`; the server checks it.
   */
  knowledge(token: string, id: string) {
    return apiRequest<ProductKnowledge>(
      `/products/${encodeURIComponent(id)}/knowledge`,
      token,
    );
  },
  addKnowledgeEvidence(
    token: string,
    id: string,
    input: ProductManualEvidenceInput,
  ) {
    return apiRequest<ProductManualEvidenceResult>(
      `/products/${encodeURIComponent(id)}/knowledge/evidence`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  acceptKnowledge(token: string, id: string, fieldResultId: string) {
    return apiRequest<ProductKnowledge>(
      `/products/${encodeURIComponent(id)}/knowledge/accept`,
      token,
      { method: "POST", body: JSON.stringify({ fieldResultId }) },
    );
  },
  saveKnowledgeCopy(
    token: string,
    id: string,
    block: ProductCopyBlock,
    body: string,
    usedFields: string[],
  ) {
    return apiRequest<ProductKnowledge>(
      `/products/${encodeURIComponent(id)}/knowledge/copy/${block}`,
      token,
      { method: "PUT", body: JSON.stringify({ body, usedFields }) },
    );
  },
  approveKnowledgeCopy(token: string, id: string, block: ProductCopyBlock) {
    return apiRequest<ProductKnowledge>(
      `/products/${encodeURIComponent(id)}/knowledge/copy/${block}/approve`,
      token,
      { method: "POST" },
    );
  },
  /**
   * Takes the master data of a webshop product over to Acropora OS. One
   * direction only, and the direction is in the path rather than in a body:
   * there is no decided answer yet for what should happen to local edits if
   * the product were ever handed back.
   */
  /**
   * A SZALLITASI PROFIL HIANYA `null`, ES A HIVO EZT LATJA.
   *
   * Nem negy hamisra esunk vissza: a sor hianya azt jelenti, hogy a termeket
   * MEG SENKI NEM NEZTE MEG, es ez mas allapot, mint egy megvizsgalt termek,
   * amelyikre egyik jelzo sem all.
   */
  getShippingProfile(token: string, productId: string) {
    return apiRequest<ProductShippingProfileDetail | null>(
      `/products/${encodeURIComponent(productId)}/shipping-profile`,
      token,
    );
  },
  saveShippingProfile(
    token: string,
    productId: string,
    input: ProductShippingProfileInput,
  ) {
    return apiRequest<ProductShippingProfileDetail>(
      `/products/${encodeURIComponent(productId)}/shipping-profile`,
      token,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
  takeCatalogAuthority(token: string, id: string) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}/catalog-authority/acropora`,
      token,
      { method: "POST" },
    );
  },
  updateExtension(
    token: string,
    variantId: string,
    input: ProductExtensionUpdateInput,
  ) {
    return apiRequest<ProductExtensionDetail>(
      `/product-extensions/${encodeURIComponent(variantId)}`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  addBarcode(token: string, variantId: string, input: AddProductBarcodeInput) {
    return apiRequest<ProductBarcodeSummary>(
      `/product-barcodes/${encodeURIComponent(variantId)}`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  setPrimaryBarcode(token: string, variantId: string, barcodeId: string) {
    return apiRequest<ProductBarcodeListResponse>(
      `/product-barcodes/${encodeURIComponent(variantId)}/${encodeURIComponent(barcodeId)}/primary`,
      token,
      { method: "PATCH" },
    );
  },
  removeBarcode(token: string, variantId: string, barcodeId: string) {
    return apiRequest<ProductBarcodeListResponse>(
      `/product-barcodes/${encodeURIComponent(variantId)}/${encodeURIComponent(barcodeId)}`,
      token,
      { method: "DELETE" },
    );
  },
  /**
   * A termék üzleti mezőinek módosítása. A szerver csak akkor engedi, ha a
   * törzsadat gazdája az Acropora OS; UNAS-gazdájú terméknél 409-cel válaszol.
   * A tiltás nem itt van, hanem a szolgáltatásban.
   */
  update(token: string, id: string, input: ProductUpdateInput) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}`,
      token,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  categoryOptions(token: string) {
    return apiRequest<CatalogOption[]>("/categories/options", token);
  },
  brandOptions(token: string) {
    return apiRequest<CatalogOption[]>("/brands/options", token);
  },
};
