import type {
  Rental,
  RentalCustomerMatchResponse,
  RentalEquipmentListResponse,
  RentalListResponse,
  RentalReturnInput,
  RentalReturnPreview,
  RentalStatus,
} from "@acropora/types";

import { API_PREFIX } from "./api-prefix";
import { pdfBlob } from "./billing-documents";
import { apiAuthHeaders, apiRequest } from "./client";

const base = "/rentals";

export type RentalNewCustomerInput = {
  type: "PERSON" | "COMPANY";
  displayName: string;
  email: string;
  phone: string;
  address: { postalCode: string; city: string; line1: string };
};

export type CreateRentalInput = {
  equipmentId: string;
  customerId?: string;
  newCustomer?: RentalNewCustomerInput;
  startsAt: string;
  plannedReturnAt: string;
  depositHuf?: number;
  note?: string;
};

/** The rental desk (task eszkozberles, S2): reads under `rentals.view`, recording under `rentals.manage`. */
export const rentalsApi = {
  list(token: string, status?: RentalStatus, signal?: AbortSignal) {
    const query = status ? `?status=${status}` : "";
    return apiRequest<RentalListResponse>(`${base}${query}`, token, {
      signal,
    });
  },
  availableEquipment(token: string, signal?: AbortSignal) {
    return apiRequest<RentalEquipmentListResponse>(
      `${base}/available-equipment`,
      token,
      { signal },
    );
  },
  customerMatches(
    token: string,
    input: { name?: string; phone?: string; email?: string },
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input))
      if (value && value.trim() !== "") query.set(key, value.trim());
    return apiRequest<RentalCustomerMatchResponse>(
      `${base}/customer-matches?${query.toString()}`,
      token,
      { signal },
    );
  },
  /** The contract PDF, with the current template (S3). */
  async contractPdf(token: string, id: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${base}/${encodeURIComponent(id)}/contract.pdf`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    return pdfBlob(response, "A szerződés PDF-je nem tölthető le.");
  },
  /** What the return would settle at `returnedAt` (the server's now without it), before the desk confirms (S4). */
  returnPreview(
    token: string,
    id: string,
    returnedAt?: string,
    signal?: AbortSignal,
  ) {
    const query = returnedAt
      ? `?returnedAt=${encodeURIComponent(returnedAt)}`
      : "";
    return apiRequest<RentalReturnPreview>(
      `${base}/${encodeURIComponent(id)}/return-preview${query}`,
      token,
      { signal },
    );
  },
  /** Takes the device back; the server counts the fee and the surcharge (S4). */
  returnRental(token: string, id: string, input: RentalReturnInput) {
    return apiRequest<Rental>(
      `${base}/${encodeURIComponent(id)}/return`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
  create(token: string, input: CreateRentalInput) {
    return apiRequest<Rental>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
