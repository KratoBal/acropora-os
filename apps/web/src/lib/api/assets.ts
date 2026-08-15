import type {
  AssetDetail,
  AssetListResponse,
  AssetQrCode,
  CreateAssetInput,
  UpdateAssetInput,
} from "@acropora/types";

import { apiRequest } from "./client";

export const assetsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<AssetListResponse>(`/service/assets?${query}`, token, {
      signal,
    });
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
};
