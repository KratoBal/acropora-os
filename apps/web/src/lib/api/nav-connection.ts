import type {
  NavConnectionCredentialInput,
  NavConnectionView,
} from "@acropora/types";

import { apiRequest } from "./client";

export const navConnectionApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<NavConnectionView>(
      "/integrations/nav/connection",
      token,
      { signal },
    );
  },
  replaceCredential(token: string, credentials: NavConnectionCredentialInput) {
    return apiRequest<NavConnectionView>(
      "/integrations/nav/connection/credential",
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      },
    );
  },
  test(token: string) {
    return apiRequest<NavConnectionView>(
      "/integrations/nav/connection/test",
      token,
      { method: "POST" },
    );
  },
  disable(token: string) {
    return apiRequest<NavConnectionView>(
      "/integrations/nav/connection/credential",
      token,
      { method: "DELETE" },
    );
  },
};
