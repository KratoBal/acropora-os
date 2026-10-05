import type { WebshopStuckMail, WebshopStuckMailList } from "@acropora/types";

import { apiRequest } from "./client";

/** The webshop's stuck mails, through the OS (`webshop-mail-outbox.controller.ts`). */
export const webshopMailOutboxApi = {
  stuck(token: string, options: { signal?: AbortSignal } = {}) {
    return apiRequest<WebshopStuckMailList>("/webshop-mail-outbox", token, {
      signal: options.signal,
    });
  },

  retry(token: string, id: string) {
    return apiRequest<WebshopStuckMail>(
      `/webshop-mail-outbox/${encodeURIComponent(id)}/retry`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
};
