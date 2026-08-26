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

export const aiChatApi = {
  ask(
    token: string,
    body: { message: string; conversationId?: string },
    signal?: AbortSignal,
  ) {
    return apiRequest<AiChatReply>("/integrations/ai-chat", token, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    });
  },
};
