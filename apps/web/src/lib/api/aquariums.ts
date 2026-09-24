import type {
  AquariumDetail,
  AquariumListResponse,
  CreateAquariumEquipmentInput,
  CreateAquariumInput,
  UpdateAquariumInput,
} from "@acropora/types";
import { apiRequest } from "./client";

export const aquariumsApi = {
  list(token: string, query: URLSearchParams, signal?: AbortSignal) {
    return apiRequest<AquariumListResponse>(`/aquariums?${query}`, token, {
      signal,
    });
  },
  detail(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<AquariumDetail>(
      `/aquariums/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: CreateAquariumInput) {
    return apiRequest<AquariumDetail>("/aquariums", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: UpdateAquariumInput) {
    return apiRequest<AquariumDetail>(
      `/aquariums/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  addEquipment(
    token: string,
    aquariumId: string,
    input: CreateAquariumEquipmentInput,
  ) {
    return apiRequest<AquariumDetail>(
      `/aquariums/${encodeURIComponent(aquariumId)}/equipment`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  removeEquipment(token: string, aquariumId: string, equipmentId: string) {
    return apiRequest<AquariumDetail>(
      `/aquariums/${encodeURIComponent(aquariumId)}/equipment/${encodeURIComponent(equipmentId)}`,
      token,
      { method: "DELETE" },
    );
  },
};
