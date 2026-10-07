import {
  DOCUMENT_THUMBNAIL_VARIANT,
  DOCUMENT_VARIANT_PARAM,
  type CreateMortalityInput,
  type MortalityAquariumOption,
  type MortalityDetail,
  type MortalityListResponse,
  type MortalityPhoto,
  type MortalityProductOption,
  type MortalityRecorderOption,
  type MortalitySummary,
  type MortalitySupplierOption,
  type UpdateMortalityInput,
} from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

/**
 * AZ ELHULLÁSI NAPLÓ (kártya 115c9740). A címek kiírva állnak, nem helperrel
 * összerakva: a repó útvonal-mérője (`mobile-api-routes.spec.ts`) a kliens-
 * fájlokból olvassa ki őket.
 */
export const mortalityApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<MortalityListResponse>(`/mortality?${query}`, token, {
      signal,
    });
  },
  summary(token: string, signal?: AbortSignal) {
    return apiRequest<MortalitySummary>("/mortality/summary", token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<MortalityDetail>(
      `/mortality/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreateMortalityInput) {
    return apiRequest<MortalityDetail>("/mortality", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateMortalityInput) {
    return apiRequest<MortalityDetail>(
      `/mortality/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  productOptions(token: string, q?: string, signal?: AbortSignal) {
    return apiRequest<MortalityProductOption[]>(
      `/mortality/options/products?q=${encodeURIComponent(q?.trim() ?? "")}`,
      token,
      { signal },
    );
  },
  aquariumOptions(token: string, signal?: AbortSignal) {
    return apiRequest<MortalityAquariumOption[]>(
      "/mortality/options/aquariums",
      token,
      { signal },
    );
  },
  supplierOptions(token: string, q?: string, signal?: AbortSignal) {
    return apiRequest<MortalitySupplierOption[]>(
      `/mortality/options/suppliers?q=${encodeURIComponent(q?.trim() ?? "")}`,
      token,
      { signal },
    );
  },
  recorderOptions(token: string, signal?: AbortSignal) {
    return apiRequest<MortalityRecorderOption[]>(
      "/mortality/options/recorders",
      token,
      { signal },
    );
  },
  /** Egy kérésben több kép, ugyanazon a mezőnéven (`FilesInterceptor("file")`). */
  uploadPhotos(token: string, id: string, files: File[]) {
    const body = new FormData();
    for (const file of files) body.append("file", file);
    return apiRequest<MortalityPhoto[]>(
      `/mortality/${encodeURIComponent(id)}/photos`,
      token,
      { method: "POST", body },
    );
  },
  async downloadPhotoThumbnail(token: string, id: string, photoId: string) {
    const response = await fetch(
      `${API_PREFIX}/mortality/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}?${DOCUMENT_VARIANT_PARAM}=${DOCUMENT_THUMBNAIL_VARIANT}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A fénykép nem tölthető be.");
    return response.blob();
  },
  async downloadPhoto(token: string, id: string, photoId: string) {
    const response = await fetch(
      `${API_PREFIX}/mortality/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A fénykép nem tölthető le.");
    return response.blob();
  },
};
