import type {
  CreateCustomerInput,
  CustomerDetail,
  CustomerListResponse,
  UpdateCustomerInput,
} from "@acropora/types";
import { apiRequest } from "./client";

export const customersApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<CustomerListResponse>(`/customers?${query}`, token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<CustomerDetail>(
      `/customers/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreateCustomerInput) {
    return apiRequest<CustomerDetail>("/customers", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateCustomerInput) {
    return apiRequest<CustomerDetail>(
      `/customers/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
