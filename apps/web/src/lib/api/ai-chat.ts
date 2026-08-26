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
