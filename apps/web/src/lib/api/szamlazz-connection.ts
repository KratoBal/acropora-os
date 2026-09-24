import type {
  SzamlazzConnectionCredentialInput,
  SzamlazzConnectionView,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A Számlázz.hu kapcsolat végpontjai -- a Medusa mintája, egy szándékos
 * hiánnyal: NINCS `test()`. A Számlázz.hu Agent API-nak nincs ártalmatlan
 * próba-végpontja, lásd `szamlazz-connection.service.ts` (API) doc-commentjét.
 */
export const szamlazzConnectionApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<SzamlazzConnectionView>(
      "/integrations/szamlazz/connection",
      token,
      { signal },
    );
  },
  replaceCredential(
    token: string,
    credentials: SzamlazzConnectionCredentialInput,
  ) {
    return apiRequest<SzamlazzConnectionView>(
      "/integrations/szamlazz/connection/credential",
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      },
    );
  },
  disable(token: string) {
    return apiRequest<SzamlazzConnectionView>(
      "/integrations/szamlazz/connection/credential",
      token,
      { method: "DELETE" },
    );
  },
};
