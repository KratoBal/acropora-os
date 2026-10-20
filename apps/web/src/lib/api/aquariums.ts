import type {
  AquariumDetail,
  AquariumListResponse,
  AquariumMaintainer,
  AquariumMeasurementListResponse,
  CreateAquariumEquipmentInput,
  CreateAquariumInput,
  CreateAquariumMeasurementInput,
  MeasurementRecommendationView,
  UpdateAquariumInput,
} from "@acropora/types";
import { ApiError, apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

/**
 * A KIADOTT REEFCLUB-KÓD (apps/api `IssuedLinkCode`, aquarium-reefclub.service.ts). A kód csak
 * ebben a válaszban látszik: a szerver csak a lenyomatát tárolja.
 */
export interface IssuedReefClubLinkCode {
  code: string;
  /** ISO időpont. */
  expiresAt: string;
  /** Ha a kód e-mailben is elment, a cím. */
  emailedTo?: string;
}

/**
 * EGY VEVŐ REEFCLUB-ÖSSZEKÖTÉSE (apps/api `CustomerReefClubLink`). Csak a ReefClub-fiók
 * e-mail címe látszik, az akváriumok adata nem.
 */
export interface ReefClubCustomerLink {
  id: string;
  accountEmail: string;
  status: "ACTIVE" | "ENDED";
  /** ISO időpont. */
  createdAt: string;
  endedAt?: string;
  /** Ki szüntette meg: a vevő a fiókjából, vagy a bolt. */
  endedBy?: "ACCOUNT" | "SHOP";
  /** Mikor kapott a vevő értesítést az összekötésről; hiányzik: még nem. */
  noticeSentAt?: string;
  /** Minden próba elbukott: a vevő NEM kapott értesítést, és több próba nem jön. */
  noticeFailed: boolean;
}

export const aquariumsApi = {
  /** GET /aquariums/customers/:customerId/reefclub-links (legújabb elöl, a megszűntek is). */
  async reefClubLinks(
    token: string,
    customerId: string,
    signal?: AbortSignal,
  ): Promise<ReefClubCustomerLink[]> {
    const response = await apiRequest<{ links: ReefClubCustomerLink[] }>(
      `/aquariums/customers/${encodeURIComponent(customerId)}/reefclub-links`,
      token,
      { signal },
    );
    return response.links;
  },
  /** DELETE /aquariums/customers/:customerId/reefclub-links/:linkId (204; csak aktív link szüntethető meg). */
  endReefClubLink(token: string, customerId: string, linkId: string) {
    return apiRequest<void>(
      `/aquariums/customers/${encodeURIComponent(customerId)}/reefclub-links/${encodeURIComponent(linkId)}`,
      token,
      { method: "DELETE" },
    );
  },
  /** POST /aquariums/customers/:customerId/reefclub-link-code (ReefClub terv v6.1, 3.3). */
  issueReefClubCode(token: string, customerId: string, sendEmail: boolean) {
    return apiRequest<IssuedReefClubLinkCode>(
      `/aquariums/customers/${encodeURIComponent(customerId)}/reefclub-link-code`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmail }),
      },
    );
  },
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
  /** A mérés termékajánlása (2b3983e1); `null`, ha még nincs. */
  measurementRecommendation(
    token: string,
    aquariumId: string,
    occasionId: string,
  ) {
    return apiRequest<MeasurementRecommendationView | null>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}/recommendation`,
      token,
    );
  },
  requestMeasurementRecommendation(
    token: string,
    aquariumId: string,
    occasionId: string,
  ) {
    return apiRequest<MeasurementRecommendationView>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}/recommendation/request`,
      token,
      { method: "POST" },
    );
  },
  saveMeasurementRecommendation(
    token: string,
    aquariumId: string,
    occasionId: string,
    input: { text: string; expectedUpdatedAt: string },
  ) {
    return apiRequest<MeasurementRecommendationView>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}/recommendation`,
      token,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  approveMeasurementRecommendation(
    token: string,
    aquariumId: string,
    occasionId: string,
    input: { expectedUpdatedAt: string },
  ) {
    return apiRequest<MeasurementRecommendationView>(
      `/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}/recommendation/approve`,
      token,
      { method: "POST", body: JSON.stringify(input) },
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
  /**
   * THE MEASUREMENT REPORT PDF OF ONE OCCASION (card 77767969): the same
   * file download as the Excel export below.
   */
  async downloadMeasurementReportPdf(
    token: string,
    aquariumId: string,
    occasionId: string,
    filename: string,
  ): Promise<void> {
    const response = await fetch(
      `${API_PREFIX}/aquariums/${encodeURIComponent(aquariumId)}/measurements/${encodeURIComponent(occasionId)}/pdf`,
      { headers: apiAuthHeaders(token) },
    );
    if (!response.ok) {
      throw new ApiError(
        "A mérési PDF letöltése nem sikerült.",
        response.status,
      );
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
