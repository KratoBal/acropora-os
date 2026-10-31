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
  /**
   * The AI service's guard refused the whole answer. `detail`, in the same
   * form as `refusalDetails`, says why an answer was not JSON (acropora-ai-
   * agent #58): "parse 18234/18240 U+0022" or "truncated 31877/31877 -".
   */
  | { kind: "REFUSED"; refusal: string; detail?: string }
  | { kind: "UNAVAILABLE"; reason: string };

export interface ClaimExtractor {
  extract(input: ClaimExtractionInput): Promise<ClaimExtractorAnswer>;
}

const CODE = /^[A-Z_]{1,40}$/;
/**
 * The AI service's `whereItLeaves` form, and nothing else: no text gets
 * through. Since acropora-ai-agent #57 the source's code point may follow
 * ("passage 22/87 U+0073 src U+0064"): a PDF's line-end hyphen shows as
 * "src U+002D" where the passage goes on with a letter.
 */
export const REFUSAL_DETAIL =
  /^[A-Za-z]{1,24} \d{1,7}\/\d{1,7} (?:U\+[0-9A-F]{4,6}|-)(?: src (?:U\+[0-9A-F]{4,6}|-))?$/;
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
      ...(typeof b.detail === "string" && REFUSAL_DETAIL.test(b.detail)
        ? { detail: b.detail }
        : {}),
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

/** An identifier the AI service passes on from the provider (acropora-ai-agent #64). */
const PROVIDER_ID = /^[A-Za-z0-9_.[\]]{1,64}$/;

/**
 * "HTTP 502", and when the AI service's answer names the provider's own
 * codes, those after it: "HTTP 502 provider 400 invalid_request_error
 * invalid_value input". On stage (2026-10-31) every claim call answered 502,
 * and why stood only in the AI service's log, which the fleet cannot read.
 * Identifiers only, checked again here; never a message.
 */
export async function unavailableReason(response: Response): Promise<string> {
  const base = `HTTP ${response.status}`;
  const body = (await response.json().catch(() => null)) as {
    provider?: Record<string, unknown>;
  } | null;
  const p = body?.provider;
  if (!p || typeof p !== "object") return base;
  const parts = [
    typeof p.status === "number" && Number.isInteger(p.status)
      ? String(p.status)
      : null,
    ...["type", "code", "param"].map((k) =>
      typeof p[k] === "string" && PROVIDER_ID.test(p[k] as string)
        ? (p[k] as string)
        : null,
    ),
  ].filter((x): x is string => x !== null);
  return parts.length ? `${base} provider ${parts.join(" ")}` : base;
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
      return {
        kind: "UNAVAILABLE",
        reason: await unavailableReason(response),
      };
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

/**
 * THE AI SERVICE'S FIGURE CLAIM EXTRACTION (acropora-ai-agent
 * `POST /v1/figure-claim-extractions`, #59; research-kepes-ut): one figure,
 * its caption and its image tiles. The answer is the text answer's shape,
 * plus one transcript per tile (the text printed in it, as the model reads
 * it) and each claim's origin. `claim-check.ts` reads every claim again, here
 * against the paper's sections, the caption and these transcripts; a passage
 * or an anchor that stands only in a transcript is the model's word, and is
 * stored as not verified verbatim.
 */
export const AI_FIGURE_EXTRACTION_PATH_ENV =
  "ACROPORA_AI_FIGURE_EXTRACTION_PATH";
/** The figure call's image tiles: PNG or JPEG bytes, in reading order. */
export interface FigureExtractionInput {
  subject: "PHOSPHATE";
  vocabulary: { taxa: string[]; environments: string[]; effects: string[] };
  figure: string;
  caption: string;
  images: { contentType: "image/png" | "image/jpeg"; bytes: Uint8Array }[];
}
export type FigureExtractorAnswer =
  | (Extract<ClaimExtractorAnswer, { kind: "ANSWER" }> & {
      transcripts: string[];
    })
  | Exclude<ClaimExtractorAnswer, { kind: "ANSWER" }>;
export interface FigureClaimExtractor {
  extract(input: FigureExtractionInput): Promise<FigureExtractorAnswer>;
}
/**
 * A caption at most: the AI service's own cap (acropora-ai-agent #59, 400
 * past it). Checked before the image is fetched, so a too long caption is
 * counted by its own reason, not as an unavailable AI (barracuda, #1979).
 */
export const MAX_FIGURE_CAPTION = 4_000;
/** A transcript at most (the AI service's own cap, 6 000, with room). */
export const MAX_TRANSCRIPT = 8_000;

/** The figure answer's body; a transcript list of another length is UNAVAILABLE. */
export function figureAnswerOf(
  body: unknown,
  tiles: number,
): FigureExtractorAnswer {
  const answer = claimAnswerOf(body);
  if (answer.kind !== "ANSWER") return answer;
  const transcripts = (body as Record<string, unknown>).transcripts;
  if (
    !Array.isArray(transcripts) ||
    transcripts.length !== tiles ||
    !transcripts.every(
      (t) => typeof t === "string" && t.length <= MAX_TRANSCRIPT,
    )
  )
    return { kind: "UNAVAILABLE", reason: "no transcripts" };
  return { ...answer, transcripts: transcripts as string[] };
}

export class HttpFigureClaimExtractor implements FigureClaimExtractor {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly path: string,
  ) {}

  async extract(input: FigureExtractionInput): Promise<FigureExtractorAnswer> {
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
          body: JSON.stringify({
            subject: input.subject,
            vocabulary: input.vocabulary,
            figure: input.figure,
            caption: input.caption,
            images: input.images.map((i) => ({
              contentType: i.contentType,
              data: Buffer.from(i.bytes).toString("base64"),
            })),
          }),
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
      return {
        kind: "UNAVAILABLE",
        reason: await unavailableReason(response),
      };
    return figureAnswerOf(
      await response.json().catch(() => null),
      input.images.length,
    );
  }
}

/** The figure extractor from the environment, or `null`: no path, no figure reading. */
export function figureExtractorFromEnv(
  environment: NodeJS.ProcessEnv,
): FigureClaimExtractor | null {
  const path = environment[AI_FIGURE_EXTRACTION_PATH_ENV]?.trim();
  const config = aiChatConfig(environment);
  return path && config
    ? new HttpFigureClaimExtractor(config.baseUrl, config.token, path)
    : null;
}
