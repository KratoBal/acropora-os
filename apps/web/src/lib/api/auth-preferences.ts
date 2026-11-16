import type { ThemePreference } from "@acropora/types";

import { apiRequest } from "./client";

/** The signed-in person's own settings on the account. */
export const authPreferencesApi = {
  /** The theme, saved on the account (`PUT /auth/me/theme`; Balázs, 2026-11-09). */
  setTheme(token: string, preference: ThemePreference) {
    return apiRequest<{ themePreference: ThemePreference }>(
      "/auth/me/theme",
      token,
      {
        method: "PUT",
        body: JSON.stringify({ preference }),
      },
    );
  },
};
