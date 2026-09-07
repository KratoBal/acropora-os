import type {
  AddProductBarcodeInput,
  CatalogOption,
  ProductBarcodeListResponse,
  ProductBarcodeSummary,
  ProductDetail,
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
