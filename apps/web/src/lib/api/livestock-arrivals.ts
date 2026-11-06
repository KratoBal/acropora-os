import type {
  LivestockArrival,
  LivestockArrivalKind,
  LivestockArrivalListResponse,
  LivestockArrivalStatus,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A lista szűrői: ami nincs megadva, az nem szűr (kártya f4e4832b, V2.6 S2). */
export interface LivestockArrivalFilters {
  status?: LivestockArrivalStatus;
  kind?: LivestockArrivalKind;
  preorderable?: boolean;
  upcoming?: boolean;
}

/** Az űrlap tartalma: a három törölhető mező `null`-lal törlődik, a többi mindig megy. */
export interface LivestockArrivalInput {
  kind: LivestockArrivalKind;
  label: string;
  expectedOn: string;
  quantity: number | null;
  status: LivestockArrivalStatus;
  preorderable: boolean;
  note: string | null;
}

function query(filters: LivestockArrivalFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.preorderable !== undefined)
    params.set("preorderable", String(filters.preorderable));
  if (filters.upcoming !== undefined)
    params.set("upcoming", String(filters.upcoming));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Élő állat érkezések: lista, egy sor, felvétel, módosítás. Törlés nincs: a lemondott érkezés CANCELLED. */
export const livestockArrivalsApi = {
  list(token: string, filters: LivestockArrivalFilters, signal?: AbortSignal) {
    return apiRequest<LivestockArrivalListResponse>(
      `/livestock-arrivals${query(filters)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: LivestockArrivalInput) {
    return apiRequest<LivestockArrival>(`/livestock-arrivals`, token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  update(token: string, id: string, input: LivestockArrivalInput) {
    return apiRequest<LivestockArrival>(
      `/livestock-arrivals/${encodeURIComponent(id)}`,
      token,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
};
