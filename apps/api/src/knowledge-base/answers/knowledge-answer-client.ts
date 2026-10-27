import {
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
} from "../../integrations/ai-chat/ai-chat.config.js";
import type { AiAnswer, AiAnswerRequest } from "./knowledge-answer.js";

/**
 * The Acropora AI's `/v1/knowledge-answers` (ai-agent #52), as the claim
 * extractor calls `/v1/claim-extractions`: the shared AI token, the chat
 * timeout, and a path from the environment. No path, no call: the endpoint
 * answers 503.
 */
export const AI_KNOWLEDGE_ANSWER_PATH_ENV = "ACROPORA_AI_KNOWLEDGE_ANSWER_PATH";

const CODE = /^[A-Z_]{1,40}$/;
const ANSWERED_BY = /^[\w.:/ -]{1,128}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The answer's body as the AI service sends it; anything else is UNAVAILABLE. */
export function aiAnswerOf(body: unknown): AiAnswer {
  if (typeof body !== "object" || body === null)
    return { kind: "UNAVAILABLE", reason: "no JSON body" };
  const b = body as Record<string, unknown>;
  if (typeof b.refusal === "string")
    return {
      kind: "REFUSED",
      refusal: CODE.test(b.refusal) ? b.refusal : "UNKNOWN_REFUSAL",
    };
  if (!Array.isArray(b.sentences))
    return { kind: "UNAVAILABLE", reason: "no sentence list" };
  const sentences: { claimId: string | null; text: string }[] = [];
  for (const s of b.sentences) {
    const e = (s ?? {}) as Record<string, unknown>;
    const claimId =
      e.claimId === null
        ? null
        : typeof e.claimId === "string"
          ? e.claimId
          : undefined;
    // a malformed entry is left out here; what is kept still goes through the gate
    if (claimId === undefined || typeof e.text !== "string") continue;
    if (claimId !== null && !ID.test(claimId)) continue;
    sentences.push({ claimId, text: e.text });
  }
  return {
    kind: "ANSWER",
    sentences,
    refused: (Array.isArray(b.refused) ? b.refused : []).map((r) => {
      const code = (r as Record<string, unknown>)?.refusal;
      return typeof code === "string" && CODE.test(code) ? code : "UNKNOWN";
    }),
    answeredBy:
      typeof b.answeredBy === "string" && ANSWERED_BY.test(b.answeredBy)
        ? b.answeredBy
        : "unknown",
  };
}

export type KnowledgeAsker = (request: AiAnswerRequest) => Promise<AiAnswer>;

export function httpKnowledgeAsker(
  baseUrl: string,
  token: string,
  path: string,
): KnowledgeAsker {
  return async (request) => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${path.replace(/^\/+/, "")}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(AI_CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        kind: "UNAVAILABLE",
        reason:
          (error as Error)?.name === "TimeoutError" ? "timeout" : "unreachable",
      };
    }
    if (!response.ok)
      return { kind: "UNAVAILABLE", reason: `HTTP ${response.status}` };
    return aiAnswerOf(await response.json().catch(() => null));
  };
}

/** The asker from the environment, or `null`: no path, no AI config, no call. */
export function knowledgeAskerFromEnv(
  environment: NodeJS.ProcessEnv,
): KnowledgeAsker | null {
  const path = environment[AI_KNOWLEDGE_ANSWER_PATH_ENV]?.trim();
  const config = aiChatConfig(environment);
  return path && config
    ? httpKnowledgeAsker(config.baseUrl, config.token, path)
    : null;
}
