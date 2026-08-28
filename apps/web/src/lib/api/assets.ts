import type {
  AssetDetail,
  AssetListResponse,
  AssetDocumentSummary,
  AssetDocumentType,
  AssetOwnerListResponse,
  AssetOwnerType,
  AssetQrCode,
  CreateAssetInput,
  UpdateAssetInput,
} from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

export const assetsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<AssetListResponse>(`/service/assets?${query}`, token, {
      signal,
    });
  },
  /**
   * A választható tulajdonosok: a szerviz-jelölt partnerek.
   *
   * A `keep` egy MÁR RÖGZÍTETT eszköz tulajdonosa. Aki szerkeszt, annak akkor is
   * látnia kell a saját tulajdonosát, ha az ma nem lenne választható -- különben
   * a kötelező mező üresen állna, és a mentés vagy elakadna, vagy más
   * tulajdonost írna a helyére.
   */
  owners(
    token: string,
    signal?: AbortSignal,
    keep?: { type: AssetOwnerType; id: string } | null,
  ) {
    const query = keep
      ? `?${new URLSearchParams({ ownerType: keep.type, ownerId: keep.id })}`
      : "";
    return apiRequest<AssetOwnerListResponse>(
      `/service/assets/owners${query}`,
      token,
      { signal },
    );
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<AssetDetail>(
      `/service/assets/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreateAssetInput) {
    return apiRequest<AssetDetail>("/service/assets", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateAssetInput) {
    return apiRequest<AssetDetail>(
      `/service/assets/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  qr(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<AssetQrCode>(
      `/service/assets/${encodeURIComponent(id)}/qr`,
      token,
      { signal },
    );
  },
  rotateQr(token: string, id: string) {
    return apiRequest<AssetDetail>(
      `/service/assets/${encodeURIComponent(id)}/qr/rotate`,
      token,
      { method: "POST" },
    );
  },
  uploadDocument(
    token: string,
    id: string,
    type: AssetDocumentType,
    file: File,
  ) {
    const body = new FormData();
    body.append("type", type);
    body.append("file", file);
    return apiRequest<AssetDocumentSummary>(
      `/service/assets/${encodeURIComponent(id)}/documents`,
      token,
      { method: "POST", body },
    );
  },
  async downloadDocument(token: string, id: string, documentId: string) {
    const response = await fetch(
      `${API_PREFIX}/service/assets/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok) throw new Error("A dokumentum nem tölthető le.");
    return response.blob();
  },
  deleteDocument(token: string, id: string, documentId: string) {
    return apiRequest<{ ok: true }>(
      `/service/assets/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
      token,
      { method: "DELETE" },
    );
  },
};
