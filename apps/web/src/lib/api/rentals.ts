import type {
  Rental,
  RentalCustomerMatchResponse,
  RentalEquipmentListResponse,
  RentalListResponse,
  RentalStatus,
} from "@acropora/types";

import { apiRequest } from "./client";

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
  create(token: string, input: CreateRentalInput) {
    return apiRequest<Rental>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
