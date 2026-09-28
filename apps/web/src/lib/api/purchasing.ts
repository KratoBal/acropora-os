import type {
  CreatePurchaseInvoiceInput,
  CreateProjectInput,
  ExchangeRateLookupResult,
  ProjectOption,
  PurchaseInvoiceDetail,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceResult,
  PurchaseProductConflictLookup,
  PurchaseProductSearchResult,
  SupplierInvoiceImportResult,
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
  /** #1199 P-026: van-e már termék ezzel az EAN-nel vagy beszállítói cikkszámmal. */
  productConflicts(
    token: string,
    query: { ean?: string; supplierId?: string; supplierSku?: string },
  ) {
    const params = new URLSearchParams();
    if (query.ean) params.set("ean", query.ean);
    if (query.supplierId) params.set("supplierId", query.supplierId);
    if (query.supplierSku) params.set("supplierSku", query.supplierSku);
    return apiRequest<PurchaseProductConflictLookup>(
      `/purchasing/products/conflicts?${params}`,
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
  /**
   * A beszállítói számlafájl (CII XML vagy ismert PDF) beolvasása. Csak
   * előtöltés: a szerver semmit nem ment belőle (#1199 P-026).
   */
  importSupplierInvoice(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<SupplierInvoiceImportResult>(
      `/purchasing/invoices/import`,
      token,
      { method: "POST", body: form },
    );
  },
  create(token: string, input: CreatePurchaseInvoiceInput) {
    return apiRequest<PurchaseInvoiceResult>(`/purchasing/invoices`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  listProjects(token: string) {
    return apiRequest<ProjectOption[]>(`/purchasing/projects`, token);
  },
  createProject(token: string, input: CreateProjectInput) {
    return apiRequest<ProjectOption>(`/purchasing/projects`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
