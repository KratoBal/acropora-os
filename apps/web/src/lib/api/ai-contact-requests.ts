import type { AiContactRequestView } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * Az AI csevegés kapcsolat-kérései (Beállítások, kártya f5b8f7ba, 4c). A címek kiírva állnak (a repó útvonal-mérője a
 * kliens-fájlokból olvassa ki őket). Olvasni és kezeltnek jelölni is az `AI_SETTINGS_MANAGE` jog tud.
 */
export const aiContactRequestsApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<AiContactRequestView[]>(
      "/integrations/ai-contact-requests",
      token,
      { signal },
    );
  },
  handled(token: string, id: string) {
    return apiRequest<AiContactRequestView>(
      `/integrations/ai-contact-requests/${encodeURIComponent(id)}/handled`,
      token,
      { method: "POST" },
    );
  },
};
