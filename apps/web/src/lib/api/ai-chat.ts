import type {
  AiAnswerRating,
  AiAnswerRatingResult,
  AiRatingAxis,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * One answer, as the internal test surface needs to display it.
 *
 * Mirrors what the API returns; every field is here because somebody has to be
 * able to judge the answer from the screen alone.
 */
export interface AiChatReply {
  conversationId: string | null;
  /** Which answer a judgement is written against. Null when the call failed. */
  messageId: string | null;
  answer: string | null;
  model: string | null;
  customerContextStatus: string | null;
  productContext: string;
  elapsedMs: number;
  errorCode: string | null;
  providerWaitedMs: number | null;
  httpStatus: number | null;
}

/**
 * Meddig vár a böngésző egy AI-válaszra, és miért TOVÁBB, mint a szerver.
 *
 * A szerver `AI_CHAT_TIMEOUT_MS` értéke **47 másodperc**
 * (`apps/api/src/integrations/ai-chat/ai-chat.config.ts`), és lejártakor NEM
 * elhal, hanem nevesített hibát ad vissza: `ai_gateway_timeout`. Ha a böngésző
 * hamarabb szakítana, az a megírt, pontos hiba sosem érne ide, és a felhasználó
 * egy általános hálózati hibát látna a valódi ok helyett.
 *
 * Ezért ez a szám SZÁNDÉKOSAN nagyobb a szerverénél. A tizenhárom másodperc
 * különbségbe bele kell férjen a hiba összeállítása és a visszaút egy lassú
 * mobil hálózaton is.
 *
 * ÖSSZE VAN KÖTVE, ÉS EZ NEM MARADHAT SZÓBELI: ha a szerver oldali
 * `AI_CHAT_TIMEOUT_MS` valaha nő, ezt VELE EGYÜTT emelni kell. Enélkül a két
 * szám csendben helyet cserél, és a hiba, amit a szerver megírt, megint nem ér
 * el a képernyőig.
 */
export const AI_CHAT_CLIENT_TIMEOUT_MS = 60_000;

export const aiChatApi = {
  ask(
    token: string,
    body: { message: string; conversationId?: string },
    signal?: AbortSignal,
  ) {
    return apiRequest<AiChatReply>("/integrations/ai-chat", token, {
      method: "POST",
      body: JSON.stringify(body),
      // A hívó saját jelzése erősebb: ha a felület megszakítja (elnavigálás,
      // új kérdés), az azonnal érvényes. Enélkül a fenti korlát él.
      signal: signal ?? AbortSignal.timeout(AI_CHAT_CLIENT_TIMEOUT_MS),
    });
  },

  /**
   * Sends a judgement about one answer, on one axis.
   *
   * The axis is a required parameter rather than a defaulted one, all the way
   * up from the database: a call that forgot it would file a judgement about
   * wording as a judgement about facts, and afterwards nothing could tell
   * them apart.
   *
   * The author is not a parameter: the API takes it from the session. A page
   * that could name the rater would be a page that could rate as somebody
   * else.
   */
  rate(
    token: string,
    messageId: string,
    axis: AiRatingAxis,
    rating: AiAnswerRating,
    signal?: AbortSignal,
  ) {
    return apiRequest<AiAnswerRatingResult>(
      `/integrations/ai-chat/messages/${messageId}/rating`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ axis, rating }),
        signal,
      },
    );
  },
};
