import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  AI_CHAT_ENVIRONMENT,
  AI_CHAT_FETCH,
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

  private failure(
    errorCode: string,
    elapsedMs: number,
    httpStatus: number | null,
  ): AiChatReply {
    return {
      conversationId: null,
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
