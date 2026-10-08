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
  SupplierLineSuggestionRequest,
  SupplierLineSuggestionResult,
  PurchaseInvoiceScan,
  UpdatePurchaseInvoiceInput,
  CancelPurchaseInvoiceInput,
} from "@acropora/types";
import { API_PREFIX } from "./api-prefix";
import { pdfBlob } from "./billing-documents";
import { apiAuthHeaders, apiRequest } from "./client";

export const purchasingApi = {
  searchProducts(token: string, q: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    return apiRequest<PurchaseProductSearchResult[]>(
      `/purchasing/products/search?${params}`,
      token,
    );
  },
  /**
   * #1199 P-026: javaslat egy termék nélküli sorhoz (beszállítói leképezés,
   * EAN-egyezés, Jev). Semmit nem köt: az ember fogad el.
   */
  suggestLine(token: string, input: SupplierLineSuggestionRequest) {
    return apiRequest<SupplierLineSuggestionResult>(
      `/purchasing/invoices/line-suggestions`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
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
  /** A beszkennelt számla csatolása a rögzített számlához (5ec62e35). */
  attachScan(token: string, invoiceId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<PurchaseInvoiceScan[]>(
      `/purchasing/invoices/${encodeURIComponent(invoiceId)}/scans`,
      token,
      { method: "POST", body: form },
    );
  },
  /** Egy csatolt számlakép PDF-je (a kép csatoláskor PDF-fé alakul). */
  async scanPdf(token: string, invoiceId: string, documentId: string) {
    const response = await fetch(
      `${API_PREFIX}/purchasing/invoices/${encodeURIComponent(invoiceId)}/scans/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A számlakép nem tölthető le.");
  },
  /** A rögzített számla készlethatás nélküli mezőinek javítása (Luca, 10-08). */
  update(token: string, invoiceId: string, input: UpdatePurchaseInvoiceInput) {
    return apiRequest<PurchaseInvoiceDetail>(
      `/purchasing/invoices/${encodeURIComponent(invoiceId)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /** A rögzített számla sztornója, okkal (acrobot 28092). */
  cancel(token: string, invoiceId: string, input: CancelPurchaseInvoiceInput) {
    return apiRequest<PurchaseInvoiceDetail>(
      `/purchasing/invoices/${encodeURIComponent(invoiceId)}/cancel`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
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
