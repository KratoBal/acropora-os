import type {
  CreatePosSaleInput,
  PosProductSearchResult,
  PosSaleDetail,
  PosSaleListResponse,
  PosSaleResult,
} from "@acropora/types";

import { apiRequest } from "./client";

export interface PosSaleListQuery {
  page?: number;
  pageSize?: number;
}

function listQueryString(query: PosSaleListQuery): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  return params.toString();
}

export const posApi = {
  searchProducts(token: string, q: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    return apiRequest<PosProductSearchResult[]>(
      `/pos/products?${params.toString()}`,
      token,
    );
  },
  createSale(token: string, input: CreatePosSaleInput) {
    return apiRequest<PosSaleResult>(`/pos/sales`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  listSales(token: string, query: PosSaleListQuery) {
    return apiRequest<PosSaleListResponse>(
      `/pos/sales?${listQueryString(query)}`,
      token,
    );
  },
  getSale(token: string, id: string) {
    return apiRequest<PosSaleDetail>(
      `/pos/sales/${encodeURIComponent(id)}`,
      token,
    );
  },
};
