import type {
  MedusaConnectionCredentialInput,
  MedusaConnectionView,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A Medusa kapcsolat végpontjai. Ugyanaz a négy művelet, mint az UNAS és a NAV
 * kapcsolatánál, és szándékosan NINCS ötödik: a kulcs kiolvasására nincs
 * végpont, tehát a felület nem is tudná megkérni.
 */
export const medusaConnectionApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<MedusaConnectionView>(
      "/integrations/medusa/connection",
      token,
      { signal },
    );
  },
  replaceCredential(
    token: string,
    credentials: MedusaConnectionCredentialInput,
  ) {
    return apiRequest<MedusaConnectionView>(
      "/integrations/medusa/connection/credential",
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      },
    );
  },
  test(token: string) {
    return apiRequest<MedusaConnectionView>(
      "/integrations/medusa/connection/test",
      token,
      { method: "POST" },
    );
  },
  disable(token: string) {
    return apiRequest<MedusaConnectionView>(
      "/integrations/medusa/connection/credential",
      token,
      { method: "DELETE" },
    );
  },
};
