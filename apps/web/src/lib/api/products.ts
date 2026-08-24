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
  categoryOptions(token: string) {
    return apiRequest<CatalogOption[]>("/categories/options", token);
  },
  brandOptions(token: string) {
    return apiRequest<CatalogOption[]>("/brands/options", token);
  },
};
