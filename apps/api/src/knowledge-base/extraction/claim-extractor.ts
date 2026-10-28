import {
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
} from "../../integrations/ai-chat/ai-chat.config.js";

/**
 * THE AI SERVICE'S CLAIM EXTRACTION OVER HTTP (acropora-ai-agent
 * `POST /v1/claim-extractions`, #47-#49), like the dosing extractor: the
 * token is held by this process only, and neither the token nor the call's
 * error is ever written out. The answer's claims are passed on as they came:
 * `claim-check.ts` reads every one of them again, field by field, against
 * the text this side downloaded.
 */
export const AI_CLAIM_EXTRACTION_PATH_ENV = "ACROPORA_AI_CLAIM_EXTRACTION_PATH";

export interface ClaimExtractionInput {
  sourceText: string;
  subject: "PHOSPHATE";
  vocabulary: { taxa: string[]; environments: string[]; effects: string[] };
}

export type ClaimExtractorAnswer =
  | {
      kind: "ANSWER";
      claims: unknown[];
      /** The AI side's own refusals, as codes (counted, not shown as text). */
      refusedClaims: string[];
      /**
       * Where a refused passage or anchor left the text, as the AI service
       * measured it (acropora-ai-agent #44's form): "PASSAGE_NOT_IN_TEXT:
       * passage 22/87 U+0073", the matching length, the length and the first
       * code point that differed. Counts and a code point, never the text.
       */
      refusalDetails: string[];
      /** The model and prompt version, for `KnowledgePassage.extractedBy`. */
      extractedBy: string;
    }
  /** The AI service's guard refused the whole answer. */
  | { kind: "REFUSED"; refusal: string }
  | { kind: "UNAVAILABLE"; reason: string };

export interface ClaimExtractor {
  extract(input: ClaimExtractionInput): Promise<ClaimExtractorAnswer>;
}

const CODE = /^[A-Z_]{1,40}$/;
/** The AI service's `whereItLeaves` form, and nothing else: no text gets through. */
export const REFUSAL_DETAIL =
  /^[A-Za-z]{1,24} \d{1,7}\/\d{1,7} (?:U\+[0-9A-F]{4,6}|-)$/;
const EXTRACTED_BY = /^[\w.:/ -]{1,128}$/;

/** The answer's body as the AI service sends it; anything else is UNAVAILABLE. */
export function claimAnswerOf(body: unknown): ClaimExtractorAnswer {
  if (typeof body !== "object" || body === null)
    return { kind: "UNAVAILABLE", reason: "no JSON body" };
  const b = body as Record<string, unknown>;
  if (typeof b.refusal === "string")
    return {
      kind: "REFUSED",
      refusal: CODE.test(b.refusal) ? b.refusal : "UNKNOWN_REFUSAL",
    };
  if (!Array.isArray(b.claims))
    return { kind: "UNAVAILABLE", reason: "no claim list" };
  const extractedBy =
    typeof b.extractedBy === "string" && EXTRACTED_BY.test(b.extractedBy)
      ? b.extractedBy
      : "unknown";
  const refused: unknown[] = Array.isArray(b.refusedClaims)
    ? b.refusedClaims
    : [];
  return {
    kind: "ANSWER",
    claims: b.claims,
    refusedClaims: refused.map((r) => {
      const code = (r as Record<string, unknown>)?.refusal;
      return typeof code === "string" && CODE.test(code) ? code : "UNKNOWN";
    }),
    refusalDetails: refused.flatMap((r) => {
      const { refusal, detail } = (r ?? {}) as Record<string, unknown>;
      return typeof refusal === "string" &&
        CODE.test(refusal) &&
        typeof detail === "string" &&
        REFUSAL_DETAIL.test(detail)
        ? [`${refusal}: ${detail}`]
        : [];
    }),
    extractedBy,
  };
}

export class HttpClaimExtractor implements ClaimExtractor {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly path: string,
  ) {}

  async extract(input: ClaimExtractionInput): Promise<ClaimExtractorAnswer> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/${this.path.replace(/^\/+/, "")}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
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
      return { kind: "UNAVAILABLE", reason: `HTTP ${response.status}` };
    return claimAnswerOf(await response.json().catch(() => null));
  }
}

/** The extractor from the environment, or `null`: no path, no AI config, no call. */
export function claimExtractorFromEnv(
  environment: NodeJS.ProcessEnv,
): ClaimExtractor | null {
  const path = environment[AI_CLAIM_EXTRACTION_PATH_ENV]?.trim();
  const config = aiChatConfig(environment);
  return path && config
    ? new HttpClaimExtractor(config.baseUrl, config.token, path)
    : null;
}
