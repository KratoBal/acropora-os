import type {
  WebshopGiftCard,
  WebshopGiftCardDetail,
  WebshopGiftCardIssued,
  WebshopGiftCardIssueInput,
} from "@acropora/types";

import { apiRequest } from "./client";

/** A webshop ajándékkártyái (kártya 495c0007). Az utakban csak sima `${...}` áll: a route-ellenőrzés a forrásból olvassa őket. */
export const webshopGiftCardsApi = {
  list(token: string, signal?: AbortSignal) {
    return apiRequest<{ giftCards: WebshopGiftCard[]; truncated: boolean }>(
      "/webshop-gift-cards",
      token,
      { signal },
    );
  },
  get(token: string, id: string) {
    const card = encodeURIComponent(id);
    return apiRequest<WebshopGiftCardDetail>(
      `/webshop-gift-cards/${card}`,
      token,
    );
  },
  issue(token: string, input: WebshopGiftCardIssueInput) {
    return apiRequest<WebshopGiftCardIssued>("/webshop-gift-cards", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  disable(token: string, id: string) {
    const card = encodeURIComponent(id);
    return apiRequest<WebshopGiftCard>(
      `/webshop-gift-cards/${card}/disable`,
      token,
      {
        method: "POST",
      },
    );
  },
};
