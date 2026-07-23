import type {
  CreatePurchaseInvoiceInput,
  ExchangeRateLookupResult,
  PurchaseInvoiceDetail,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceResult,
  PurchaseProductSearchResult,
} from "@acropora/types";
import { apiRequest } from "./client";

export const purchasingApi = {
  searchProducts(token: string, q: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    return apiRequest<PurchaseProductSearchResult[]>(
      `/purchasing/products/search?${params}`,
      token,
    );
  },
  getExchangeRate(token: string, currency: string, date: string) {
    const params = new URLSearchParams({ currency, date });
    return apiRequest<ExchangeRateLookupResult>(
      `/purchasing/exchange-rate?${params}`,
      token,
    );
  },
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<PurchaseInvoiceListResponse>(
      `/purchasing/invoices?${query}`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<PurchaseInvoiceDetail>(
      `/purchasing/invoices/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreatePurchaseInvoiceInput) {
    return apiRequest<PurchaseInvoiceResult>(`/purchasing/invoices`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
