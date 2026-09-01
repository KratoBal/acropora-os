import type { ContentListResponse, ContentViewerRole } from "@acropora/types";

import { apiRequest } from "./client";

export const contentApi = {
  /**
   * AMI RÁM VÁR. Ez a lista alapértelmezett nézete, és Balázs kérésének
   * fordítása: „minden felkerul ami rank var".
   *
   * A SZEREP A HÍVÓTÓL JÖN, nem a szerverről: ugyanaz az ember lehet szerző az
   * egyik tételen és jóváhagyó a másikon, tehát a kérdés mindig az, hogy MELYIK
   * szemével nézzük.
   */
  waiting(token: string, role: ContentViewerRole, signal?: AbortSignal) {
    return apiRequest<ContentListResponse>(
      `/content/waiting?role=${role}`,
      token,
      { signal },
    );
  },

  /**
   * AMI KÉPRE VÁR. Külön hívás, nem a `waiting` egyik szűrője: a kép a
   * szövegtől független feltétel, és ma NÉGY kész szövegű poszt áll pontosan
   * itt, 2026-08-18 óta.
   */
  waitingForImage(token: string, signal?: AbortSignal) {
    return apiRequest<ContentListResponse>(
      "/content/waiting-for-image",
      token,
      { signal },
    );
  },
};
