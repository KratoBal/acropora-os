import { Inject, Injectable, Optional } from "@nestjs/common";

import type { AiAnswerRating, AiAnswerRatingResult } from "@acropora/types";

import {
  AI_CHAT_ENVIRONMENT,
  AI_CHAT_FETCH,
  AI_CHAT_RATING_TIMEOUT_MS,
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
  type AiChatConfig,
} from "./ai-chat.config.js";

/**
 * What the internal test surface shows about one answer.
 *
 * Every field here exists because somebody has to be able to judge the answer
 * from the screen alone: which conversation it belongs to, which mode and
 * model produced it, how long it took, and - when it failed - what failed.
 */
export interface AiChatReply {
  conversationId: string | null;
  /**
   * The id of the stored answer, which is what a judgement is written
   * against. Null when the call failed and there is nothing to judge.
   */
  messageId: string | null;
  answer: string | null;
  model: string | null;
  /** `anonymous` or `resolved`, straight from the AI service. */
  customerContextStatus: string | null;
  /**
   * Always this sentence for now, and it is Balazs's own wording. The AI has
   * no catalogue behind it, so the surface says so on every answer rather than
   * leaving a blank field that reads as "nothing to report".
   */
  productContext: string;
  /** Measured here, around the whole call, not reported by the AI. */
  elapsedMs: number;
  /** The AI's own error code, or one of ours when we never got that far. */
  errorCode: string | null;
  /** How long the AI itself waited before giving up, when it says so. */
  providerWaitedMs: number | null;
  httpStatus: number | null;
}

export const PRODUCT_CONTEXT_NOTE =
  "Nincs termékkontextus, általános modellismeret alapján adott válasz.";

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

@Injectable()
export class AiChatService {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;

  constructor(
    @Optional() @Inject(AI_CHAT_ENVIRONMENT) environment?: NodeJS.ProcessEnv,
    @Optional() @Inject(AI_CHAT_FETCH) fetchImpl?: FetchLike,
  ) {
    this.environment = environment ?? process.env;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async ask(input: {
    message: string;
    conversationId?: string;
  }): Promise<AiChatReply> {
    const startedAt = Date.now();
    const config: AiChatConfig | null = aiChatConfig(this.environment);

    if (!config) {
      return this.failure("ai_not_configured", Date.now() - startedAt, null);
    }

    let response: Response;

    try {
      response = await this.fetchImpl(`${config.baseUrl}/v1/chat`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: input.message,
          ...(input.conversationId
            ? { conversationId: input.conversationId }
            : {}),
        }),
        signal: AbortSignal.timeout(AI_CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      // The error object is never logged or returned: a transport failure can
      // carry the request it failed on, and that request holds the token.
      const name = (error as Error)?.name ?? "unknown";
      return this.failure(
        name === "TimeoutError" ? "ai_gateway_timeout" : "ai_unreachable",
        Date.now() - startedAt,
        null,
      );
    }

    const elapsedMs = Date.now() - startedAt;
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok || !body) {
      return {
        ...this.failure(
          typeof body?.error === "string" ? body.error : "ai_bad_response",
          elapsedMs,
          response.status,
        ),
        providerWaitedMs:
          typeof body?.waitedMs === "number" ? body.waitedMs : null,
      };
    }

    return {
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : null,
      messageId: typeof body.messageId === "string" ? body.messageId : null,
      answer: typeof body.answer === "string" ? body.answer : null,
      model: typeof body.model === "string" ? body.model : null,
      customerContextStatus:
        typeof body.customerContextStatus === "string"
          ? body.customerContextStatus
          : null,
      productContext: PRODUCT_CONTEXT_NOTE,
      elapsedMs,
      errorCode: null,
      providerWaitedMs: null,
      httpStatus: response.status,
    };
  }

  /**
   * Sends one judgement about one answer to the AI service.
   *
   * `ratedBy` is not in the request body of this method by accident: the
   * controller takes it from the proven session, never from what the browser
   * sent. This layer exists to be the place where a claim becomes a fact, and
   * a rating whose author is supplied by its own caller would be worth as
   * little as a customer id supplied the same way.
   *
   * Failures are reported rather than thrown, the same way `ask` reports
   * them. A judgement that did not reach the AI has to be visible on the
   * screen: the alternative is a button that looks like it worked, and a
   * measurement quietly missing a row.
   */
  async rate(input: {
    messageId: string;
    rating: AiAnswerRating;
    ratedBy: string;
  }): Promise<AiAnswerRatingResult> {
    const config: AiChatConfig | null = aiChatConfig(this.environment);

    if (!config) {
      return this.ratingFailure("ai_not_configured");
    }

    let response: Response;

    try {
      response = await this.fetchImpl(
        `${config.baseUrl}/v1/messages/${input.messageId}/rating`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            rating: input.rating,
            ratedBy: input.ratedBy,
          }),
          signal: AbortSignal.timeout(AI_CHAT_RATING_TIMEOUT_MS),
        },
      );
    } catch (error) {
      // As in `ask`: the error object can carry the request, and the request
      // carries the token, so only the name of the failure travels.
      const name = (error as Error)?.name ?? "unknown";
      return this.ratingFailure(
        name === "TimeoutError" ? "ai_gateway_timeout" : "ai_unreachable",
      );
    }

    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok || !body) {
      return this.ratingFailure(
        typeof body?.error === "string" ? body.error : "ai_bad_response",
      );
    }

    return {
      rating: (body.rating as AiAnswerRating | undefined) ?? null,
      ratedAt: typeof body.ratedAt === "string" ? body.ratedAt : null,
      errorCode: null,
    };
  }

  private ratingFailure(errorCode: string): AiAnswerRatingResult {
    return {
      rating: null,
      ratedAt: null,
      errorCode,
    };
  }

  private failure(
    errorCode: string,
    elapsedMs: number,
    httpStatus: number | null,
  ): AiChatReply {
    return {
      conversationId: null,
      messageId: null,
      answer: null,
      model: null,
      customerContextStatus: null,
      productContext: PRODUCT_CONTEXT_NOTE,
      elapsedMs,
      errorCode,
      providerWaitedMs: null,
      httpStatus,
    };
  }
}
