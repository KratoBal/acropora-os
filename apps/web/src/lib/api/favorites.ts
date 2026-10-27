import type { FavoriteListResponse } from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A SAJÁT KEDVENC OLDALAK (`/favorites`). A lista a megjelölés sorrendjében
 * jön; az add és a remove is a teljes, friss listát adja vissza, és mindkettő
 * idempotens (kétszeri megjelölés vagy kivétel nem hiba).
 */
export const favoritesApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<FavoriteListResponse>("/favorites", token, { signal });
  },

  add(token: string, href: string) {
    return apiRequest<FavoriteListResponse>("/favorites", token, {
      method: "POST",
      body: JSON.stringify({ href }),
    });
  },

  remove(token: string, href: string) {
    return apiRequest<FavoriteListResponse>(
      `/favorites?${new URLSearchParams({ href }).toString()}`,
      token,
      { method: "DELETE" },
    );
  },
};
