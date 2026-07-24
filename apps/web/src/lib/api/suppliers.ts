import type {
  CreateSupplierInput,
  SupplierListResponse,
  SupplierSummary,
  UpdateSupplierInput,
} from "@acropora/types";
import { apiRequest } from "./client";

export const suppliersApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<SupplierListResponse>(`/suppliers?${query}`, token, {
      signal,
    });
  },
  search(token: string, search: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ search, pageSize: "10" });
    return apiRequest<SupplierListResponse>(`/suppliers?${params}`, token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<SupplierSummary>(
      `/suppliers/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreateSupplierInput) {
    return apiRequest<SupplierSummary>("/suppliers", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateSupplierInput) {
    return apiRequest<SupplierSummary>(
      `/suppliers/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
