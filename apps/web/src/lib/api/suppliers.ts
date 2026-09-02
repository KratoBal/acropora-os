import type {
  PartnerDeletionPlan,
  CreateWorksheetDepartmentInput,
  WorksheetDepartmentListResponse,
  WorksheetDepartmentSummary,
  CreateSupplierInput,
  SupplierListResponse,
  SupplierSummary,
  UpdateSupplierInput,
  UpdateWorksheetDepartmentInput,
} from "@acropora/types";
import { apiRequest } from "./client";

export const suppliersApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<SupplierListResponse>(`/suppliers?${query}`, token, {
      signal,
    });
  },
  search(
    token: string,
    search: string,
    countryScope: "DOMESTIC" | "EU",
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams({
      search,
      pageSize: "10",
      countryScope,
    });
    return apiRequest<SupplierListResponse>(`/suppliers?${params}`, token, {
      signal,
    });
  },
  units(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<WorksheetDepartmentListResponse>(
      `/suppliers/${encodeURIComponent(id)}/units`,
      token,
      { signal },
    );
  },
  createUnit(token: string, id: string, input: CreateWorksheetDepartmentInput) {
    return apiRequest<WorksheetDepartmentSummary>(
      `/suppliers/${encodeURIComponent(id)}/units`,
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  /**
   * Egy meglévő alegység NEVE és ARCHIVÁLÁSA. A kód és a szülő nem megy át
   * rajta: a szerver `forbidNonWhitelisted` beállítással fut, tehát egy ilyen
   * mező 400-zal esne el, nem csendben hullana le.
   */
  updateUnit(
    token: string,
    id: string,
    unitId: string,
    input: UpdateWorksheetDepartmentInput,
  ) {
    return apiRequest<WorksheetDepartmentSummary>(
      `/suppliers/${encodeURIComponent(id)}/units/${encodeURIComponent(unitId)}`,
      token,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  /**
   * Mi történne törléskor. Külön hívás a törlés előtt, hogy a megerősítő
   * kérdés meg tudja nevezni, mit töröl, és melyik ág fut.
   */
  deletionPlan(token: string, id: string) {
    return apiRequest<PartnerDeletionPlan>(
      `/suppliers/${encodeURIComponent(id)}/deletion-plan`,
      token,
    );
  },
  remove(token: string, id: string) {
    return apiRequest<PartnerDeletionPlan>(
      `/suppliers/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
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
