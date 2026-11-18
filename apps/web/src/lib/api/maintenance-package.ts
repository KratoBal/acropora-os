import type {
  MaintenancePackageMailPreview,
  MaintenancePackageMailResult,
} from "@acropora/types";

import { ApiError, apiAuthHeaders, apiErrorOf, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/maintenance-package";

function jobPath(id: string, suffix: string) {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const maintenancePackageApi = {
  async download(token: string, serviceJobId: string): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(
        `${API_PREFIX}${jobPath(serviceJobId, "/download")}`,
        { credentials: "same-origin", headers: apiAuthHeaders(token) },
      );
    } catch {
      throw new ApiError(
        "A szerver nem érhető el. Ellenőrizd a kapcsolatot.",
        0,
      );
    }
    // the server's own reason (Luca, 2026-11-18: no completion certificate, not signed, not closed), the same error every apiRequest call gives
    if (!response.ok) throw await apiErrorOf(response);
    return response.blob();
  },

  mailPreview(token: string, serviceJobId: string) {
    return apiRequest<MaintenancePackageMailPreview>(
      jobPath(serviceJobId, "/mail"),
      token,
    );
  },

  sendMail(
    token: string,
    serviceJobId: string,
    input: { subject?: string; message: string },
  ) {
    return apiRequest<MaintenancePackageMailResult>(
      jobPath(serviceJobId, "/mail"),
      token,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
};
