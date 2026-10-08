import type { PublicQuoteAcceptInput } from "@acropora/types";

import { API_PREFIX } from "./api-prefix";

const id = encodeURIComponent;

/**
 * THE PUBLIC ACCEPTANCE LINK'S CALLS (#1582 P4b), without a login. They
 * answer the raw Response: the page shows the server's own sentence for a
 * link that does not work (404), a closed quote (409) or a limit (429).
 */
export const publicQuotesApi = {
  view(token: string) {
    return fetch(`${API_PREFIX}/public/quotes/${id(token)}`, {
      cache: "no-store",
    });
  },
  accept(token: string, input: PublicQuoteAcceptInput) {
    return fetch(`${API_PREFIX}/public/quotes/${id(token)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
  /** the stored PDF's address, for a link the browser opens */
  pdfHref(token: string) {
    return `${API_PREFIX}/public/quotes/${id(token)}/pdf`;
  },
};
