import type {
  BrandAliasInput,
  BrandDetail,
  BrandListResponse,
  CreateBrandInput,
  UpdateBrandInput,
} from "@acropora/types";
import { apiRequest } from "./client";

export const brandsApi = {
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
