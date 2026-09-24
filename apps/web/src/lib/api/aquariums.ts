import type {
  AquariumDetail,
  AquariumListResponse,
  AquariumMaintainer,
  AquariumMeasurementListResponse,
  CreateAquariumEquipmentInput,
  CreateAquariumInput,
  CreateAquariumMeasurementInput,
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
  listMeasurements(token: string, aquariumId: string, signal?: AbortSignal) {
    return apiRequest<AquariumMeasurementListResponse>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements`,
      token,
      { signal },
    );
  },
  createMeasurement(
    token: string,
    aquariumId: string,
    input: CreateAquariumMeasurementInput,
  ) {
    return apiRequest(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  /** Az `occasionId` a mérési alkalom `measuredAt` ISO-alakja -- lásd az
   * `AquariumMeasurementOccasion.id` mezőjét. */
  deleteMeasurement(token: string, aquariumId: string, occasionId: string) {
    return apiRequest<void>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}`,
      token,
      { method: "DELETE" },
    );
  },
  selectableMaintainers(token: string, signal?: AbortSignal) {
    return apiRequest<AquariumMaintainer[]>(
      "/aquariums/maintainers/selectable",
      token,
      { signal },
    );
  },
  sendMeasurementEmail(token: string, aquariumId: string, occasionId: string) {
    return apiRequest<void>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}/send-email`,
      token,
      { method: "POST" },
    );
  },
  setMaintainers(token: string, aquariumId: string, userIds: string[]) {
    return apiRequest<AquariumDetail>(
      `/aquariums/${encodeURIComponent(aquariumId)}/maintainers`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      },
    );
  },
};
