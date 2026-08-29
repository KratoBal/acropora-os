import { apiRequest } from "./client";

/**
 * One answer, as the internal test surface needs to display it.
 *
 * Mirrors what the API returns; every field is here because somebody has to be
 * able to judge the answer from the screen alone.
 */
export interface AiChatReply {
  conversationId: string | null;
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
};
