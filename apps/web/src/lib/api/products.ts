import type {
  CatalogOption,
  ProductDetail,
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
  categoryOptions(token: string) {
    return apiRequest<CatalogOption[]>("/categories/options", token);
  },
  brandOptions(token: string) {
    return apiRequest<CatalogOption[]>("/brands/options", token);
  },
};
