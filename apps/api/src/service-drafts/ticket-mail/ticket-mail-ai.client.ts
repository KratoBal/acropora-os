import {
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
} from "../../integrations/ai-chat/ai-chat.config.js";
import { unavailableReason } from "../../knowledge-base/extraction/claim-extractor.js";

/**
 * THE AI SERVICE'S TICKET DRAFT OVER HTTP (acropora-ai-agent `POST /v1/ticket-drafts`, ai#106; Acropora OS card ec7b947b, S3b): the REDACTED subject and
 * text of one mail go out, a short title and a short summary come back, or a refusal. The token is held by this process only, and neither it nor a
 * call's error text is ever written out. The answer is read AGAIN here (`ticketDraftAnswerOf`): the AI service guards it, and this side does not
 * trust that: only a title and a summary that are plain text leave this module, and they are only DISPLAYED (a draft a person accepts or rejects;
 * the ticket's description stays the mail's own text).
 */
export const AI_TICKET_DRAFT_PATH_ENV = "ACROPORA_AI_TICKET_DRAFT_PATH";
export const TICKET_MAIL_AI_CLIENT = Symbol("TICKET_MAIL_AI_CLIENT");

export const MAX_AI_TITLE = 120;
export const MAX_AI_SUMMARY = 800;

export interface TicketDraftInput {
  /** The REDACTED subject and text; this module cannot check that, the caller does (`redactForAi`). */
  subject: string;
  text: string;
}

export type TicketDraftAnswer =
  | { kind: "DRAFT"; title: string; summary: string; extractedBy: string }
  /** The AI service's guard refused its own answer, or this side did: a code, never the text. */
  | { kind: "REFUSED"; refusal: string }
  /** The service could not be asked or did not answer: a fixed reason. */
  | { kind: "UNAVAILABLE"; reason: string };

export interface TicketDraftClient {
  draft(input: TicketDraftInput): Promise<TicketDraftAnswer>;
}

const CODE = /^[A-Z_]{1,40}$/;
const EXTRACTED_BY = /^[\w.:/ -]{1,128}$/;

/**
 * WHAT IN A STRING IS NOT PLAIN TEXT: a control or invisible or direction-changing character, HTML, a link, an e-mail address, a phone-like number
 * (a date or a time is not one). The same rule the AI service holds; here it is held again.
 */
function unsafe(value: string): boolean {
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/.test(
      value,
    )
  )
    return true;
  if (/<\s*\/?\s*[a-z!]/i.test(value)) return true;
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) return true;
  if (
    /(?:https?:\/\/|www\.|\b[a-z0-9.-]+\.(?:hu|com|org|net|eu)\b)/i.test(value)
  )
    return true;
  const withoutDates = value
    .replace(/\b\d{4}\s?[.\-/]\s?\d{1,2}\s?[.\-/]\s?\d{1,2}\b\.?/g, " ")
    .replace(/\b\d{1,2}\s?[.\-/]\s?\d{1,2}\s?[.\-/]\s?\d{4}\b\.?/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
  return /(?:\+|00)?\d[\d\s/().-]{7,}\d/.test(withoutDates);
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

export function ticketDraftAnswerOf(body: unknown): TicketDraftAnswer {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { kind: "REFUSED", refusal: "BAD_SHAPE" };
  const answer = body as Record<string, unknown>;
  if (typeof answer.refusal === "string")
    return {
      kind: "REFUSED",
      refusal: CODE.test(answer.refusal) ? answer.refusal : "REFUSED",
    };
  const title = typeof answer.title === "string" ? squash(answer.title) : "";
  const summary =
    typeof answer.summary === "string" ? squash(answer.summary) : "";
  if (!title || !summary) return { kind: "REFUSED", refusal: "BAD_SHAPE" };
  if (title.length > MAX_AI_TITLE || summary.length > MAX_AI_SUMMARY)
    return { kind: "REFUSED", refusal: "TOO_LONG" };
  if (unsafe(title) || unsafe(summary))
    return { kind: "REFUSED", refusal: "UNSAFE_OUTPUT" };
  return {
    kind: "DRAFT",
    title,
    summary,
    extractedBy:
      typeof answer.extractedBy === "string" &&
      EXTRACTED_BY.test(answer.extractedBy)
        ? answer.extractedBy
        : "unknown",
  };
}

export class HttpTicketDraftClient implements TicketDraftClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly path: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async draft(input: TicketDraftInput): Promise<TicketDraftAnswer> {
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/${this.path.replace(/^\/+/, "")}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          // exactly the two redacted strings and nothing else leaves
          body: JSON.stringify({ subject: input.subject, text: input.text }),
          signal: AbortSignal.timeout(AI_CHAT_TIMEOUT_MS),
        },
      );
    } catch (error) {
      return {
        kind: "UNAVAILABLE",
        reason:
          (error as Error)?.name === "TimeoutError" ? "timeout" : "unreachable",
      };
    }
    if (!response.ok)
      return { kind: "UNAVAILABLE", reason: await unavailableReason(response) };
    return ticketDraftAnswerOf(await response.json().catch(() => null));
  }
}

/** The client from the environment, or `null`: no AI configuration, no call. */
export function ticketDraftClientFromEnv(
  environment: NodeJS.ProcessEnv,
): TicketDraftClient | null {
  const config = aiChatConfig(environment);
  if (!config) return null;
  const path =
    environment[AI_TICKET_DRAFT_PATH_ENV]?.trim() || "/v1/ticket-drafts";
  return new HttpTicketDraftClient(config.baseUrl, config.token, path);
}
