import type {
  MaintenancePackageMailPreview,
  MaintenancePackageMailResult,
} from "@acropora/types";

import { apiAuthHeaders, apiRequest } from "./client";
import { API_PREFIX } from "./api-prefix";

const base = "/partners/maintenance-package";

function jobPath(id: string, suffix: string): string {
  return `${base}/${encodeURIComponent(id)}${suffix}`;
}

export const maintenancePackageApi = {
  async download(token: string, serviceJobId: string): Promise<Blob> {
    const response = await fetch(
      `${API_PREFIX}${jobPath(serviceJobId, "/download")}`,
      { credentials: "same-origin", headers: apiAuthHeaders(token) },
    );
    if (!response.ok)
      throw new Error("A karbantartási csomag nem tölthető le.");
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
