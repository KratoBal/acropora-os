import type {
  RentalEquipment,
  RentalEquipmentListResponse,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/rental-equipment";

export type RentalEquipmentInput = {
  name: string;
  serialNumber: string | null;
  dailyFeeHuf: number;
  depositHuf: number;
  replacementValueHuf: number;
  accessories: string | null;
  note: string | null;
};

/**
 * The rental equipment master (task eszkozberles, S1). No delete: a device is retired with `isActive: false`, because a
 * rental and its contract will point at it.
 */
export const rentalEquipmentApi = {
  list(token: string, includeInactive = false, signal?: AbortSignal) {
    const query = includeInactive ? "?includeInactive=true" : "";
    return apiRequest<RentalEquipmentListResponse>(`${base}${query}`, token, {
      signal,
    });
  },
  create(token: string, input: RentalEquipmentInput) {
    return apiRequest<RentalEquipment>(base, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  update(
    token: string,
    id: string,
    input: Partial<RentalEquipmentInput> & { isActive?: boolean },
  ) {
    return apiRequest<RentalEquipment>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },
};
