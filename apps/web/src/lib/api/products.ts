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

import { API_PREFIX } from "./api-prefix";
import { apiAuthHeaders, apiRequest } from "./client";

function productQueryString(query: ProductListApiQuery): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.active !== undefined) params.set("active", String(query.active));
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.brandId) params.set("brandId", query.brandId);
  if (query.listedOn) params.set("listedOn", query.listedOn);
  return params.toString();
}

/** A negy kezzel gondozott szallitasi jelzo. Mind kotelezo: reszleges iras nincs. */
export interface ProductShippingProfileInput {
  pickupOnly: boolean;
  foxpostForbidden: boolean;
  isHeavy: boolean;
  isFrozen: boolean;
  /** Csomagautomatába nem fér (a82ed229): csak kézi, a UNAS nem ismeri. */
  lockerUnsuitable?: boolean;
}

/** Egy jelző forrása: a UNAS-szinkroné, vagy kézzel írt (a #1654 óta). */
export type ShippingFlagSource = "UNAS" | "MANUAL";

export interface ProductShippingProfileDetail extends ProductShippingProfileInput {
  productId: string;
  updatedAt: string;
  lockerUnsuitable?: boolean;
  sources?: Partial<
    Record<
      "pickupOnly" | "foxpostForbidden" | "isHeavy" | "isFrozen",
      ShippingFlagSource
    >
  >;
}

export const productApi = {
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
  /** A változat saját bruttó ára (T4.1-D3); csak OS-gazdájú terméknél, a szerver 409-cel utasítja el a többit. */
  setVariantPrice(
    token: string,
    id: string,
    variantId: string,
    grossPrice: string,
  ) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}/price`,
      token,
      { method: "PUT", body: JSON.stringify({ grossPrice }) },
    );
  },
  /** Egy kép alt-szövege (T4.1-D3); üres: nincs kézi alt, a kirakat a nevet adja. */
  setImageAlt(token: string, id: string, imageId: string, altText: string) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
      token,
      { method: "PATCH", body: JSON.stringify({ altText }) },
    );
  },
  /** A képek sorrendje: a termék minden képe, pontosan egyszer (T4.1-D3). */
  setImageOrder(token: string, id: string, imageIds: string[]) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}/images/order`,
      token,
      { method: "PUT", body: JSON.stringify({ imageIds }) },
    );
  },
  /** Egy kép feltöltése a lista végére (T4.1-D3); a mező neve `file`, mint a szerveren. */
  uploadImage(token: string, id: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}/images`,
      token,
      { method: "POST", body },
    );
  },
  /** Egy kép törlése (T4.1-D3); a fájlt a szerver a sor után viszi el. */
  deleteImage(token: string, id: string, imageId: string) {
    return apiRequest<ProductDetail>(
      `/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
      token,
      { method: "DELETE" },
    );
  },
  /** A tárolt kép fájlja: a feltöltött képnek nincs webcíme, a lap innen mutatja. */
  async downloadImage(token: string, id: string, imageId: string) {
    const response = await fetch(
      `${API_PREFIX}/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}/file`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A kép nem tölthető be.");
    return response.blob();
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
