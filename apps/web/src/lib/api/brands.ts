import type {
  BrandAliasInput,
  BrandDetail,
  BrandListResponse,
  CreateBrandInput,
  UpdateBrandInput,
  BrandImportAssistantResponse,
  BrandImportAssistantSummary,
  BrandImportBatchOption,
  BrandImportMutationResult,
  BulkCreateBrandsInput,
  BulkBrandCreateResponse,
  CreateBrandFromImportInput,
  MapBrandAliasInput,
} from "@acropora/types";
import { apiRequest } from "./client";

export const brandsApi = {
  importBatches(token: string, signal?: AbortSignal) {
    return apiRequest<BrandImportBatchOption[]>(
      "/brands/import-assistant/batches",
      token,
      { signal },
    );
  },
  importSummary(token: string, batchId: string, signal?: AbortSignal) {
    return apiRequest<BrandImportAssistantSummary>(
      `/brands/import-assistant/batches/${encodeURIComponent(batchId)}`,
      token,
      { signal },
    );
  },
  importRows(
    token: string,
    batchId: string,
    query: URLSearchParams,
    signal?: AbortSignal,
  ) {
    return apiRequest<BrandImportAssistantResponse>(
      `/brands/import-assistant/batches/${encodeURIComponent(batchId)}/rows?${query}`,
      token,
      { signal },
    );
  },
  createFromImport(
    token: string,
    batchId: string,
    rowId: string,
    input: CreateBrandFromImportInput,
  ) {
    return apiRequest<BrandImportMutationResult>(
      `/brands/import-assistant/batches/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}/create-brand`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  mapImportAlias(
    token: string,
    batchId: string,
    rowId: string,
    input: MapBrandAliasInput,
  ) {
    return apiRequest<BrandImportMutationResult>(
      `/brands/import-assistant/batches/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}/map-alias`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  bulkCreateFromImport(
    token: string,
    batchId: string,
    input: BulkCreateBrandsInput,
  ) {
    return apiRequest<BulkBrandCreateResponse>(
      `/brands/import-assistant/batches/${encodeURIComponent(batchId)}/bulk-create`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<BrandListResponse>(`/brands?${query}`, token, { signal });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<BrandDetail>(`/brands/${encodeURIComponent(id)}`, token, {
      signal,
    });
  },
  create(token: string, input: CreateBrandInput) {
    return apiRequest<BrandDetail>("/brands", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateBrandInput) {
    return apiRequest<BrandDetail>(`/brands/${encodeURIComponent(id)}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  archive(token: string, id: string) {
    return apiRequest<BrandDetail>(
      `/brands/${encodeURIComponent(id)}/archive`,
      token,
      { method: "POST" },
    );
  },
  restore(token: string, id: string) {
    return apiRequest<BrandDetail>(
      `/brands/${encodeURIComponent(id)}/restore`,
      token,
      { method: "POST" },
    );
  },
  addAlias(token: string, id: string, input: BrandAliasInput) {
    return apiRequest<BrandDetail>(
      `/brands/${encodeURIComponent(id)}/aliases`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  removeAlias(token: string, id: string, aliasId: string) {
    return apiRequest<BrandDetail>(
      `/brands/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`,
      token,
      { method: "DELETE" },
    );
  },
};
