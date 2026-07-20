import type { UnasConnectionView } from "@acropora/types";

import { apiRequest } from "./client";

export const unasConnectionApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<UnasConnectionView>(
      "/integrations/unas/connection",
      token,
      { signal },
    );
  },
  replaceCredential(token: string, apiKey: string) {
    return apiRequest<UnasConnectionView>(
      "/integrations/unas/connection/credential",
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      },
    );
  },
  test(token: string) {
    return apiRequest<UnasConnectionView>(
      "/integrations/unas/connection/test",
      token,
      { method: "POST" },
    );
  },
  disable(token: string) {
    return apiRequest<UnasConnectionView>(
      "/integrations/unas/connection/credential",
      token,
      { method: "DELETE" },
    );
  },
};
