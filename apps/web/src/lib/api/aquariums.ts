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
import { ApiError, apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

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
  /**
   * FÁJL-LETÖLTÉS, NEM JSON -- ugyanaz a minta, mint
   * `inventoryApi.downloadTemplate`: a válasz blob, a fájlnevet a szerver
   * `Content-Disposition`-je adja, ezt a hívó (a komponens) írja ki.
   */
  async downloadMeasurementsXlsx(
    token: string,
    aquariumId: string,
    filename: string,
  ): Promise<void> {
    const response = await fetch(
      `${API_PREFIX}/aquariums/${encodeURIComponent(aquariumId)}/measurements/export.xlsx`,
      { headers: apiAuthHeaders(token) },
    );
    if (!response.ok) {
      throw new ApiError("Az Excel export nem sikerült.", response.status);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
