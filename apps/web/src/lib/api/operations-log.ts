import type {
  OperationsTaskTemplateDto,
  OperationsTaskTemplateInput,
  OperationsTaskTemplateListResponse,
} from "@acropora/types";

import { apiRequest } from "./client";

const base = "/operations-log/templates";
const json = { "Content-Type": "application/json" };

/** Az üzemeltetési napló feladat-sablonjai (task os-uzemeltetesi-naplo, S1). */
export const operationsLogApi = {
  /** A kivezetett sablonok csak kérésre jönnek: a rögzítés kínálata az aktívak. */
  list(token: string, includeInactive = false, signal?: AbortSignal) {
    const query = includeInactive ? "?includeInactive=true" : "";
    return apiRequest<OperationsTaskTemplateListResponse>(
      `${base}${query}`,
      token,
      { signal },
    );
  },
  get(token: string, id: string, signal?: AbortSignal) {
    return apiRequest<OperationsTaskTemplateDto>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { signal },
    );
  },
  create(token: string, input: OperationsTaskTemplateInput) {
    return apiRequest<OperationsTaskTemplateDto>(base, token, {
      method: "POST",
      headers: json,
      body: JSON.stringify(input),
    });
  },
  /** A teljes sablon a teljes mezőkészlettel (`PUT`); az `isActive` a visszaállítás. */
  update(
    token: string,
    id: string,
    input: OperationsTaskTemplateInput & { isActive?: boolean },
  ) {
    return apiRequest<OperationsTaskTemplateDto>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { method: "PUT", headers: json, body: JSON.stringify(input) },
    );
  },
  /** KIVEZET, nem töröl: a válasz `{ retired: true }`, és ez kimondja. */
  retire(token: string, id: string) {
    return apiRequest<{ retired: true }>(
      `${base}/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
  },
};
