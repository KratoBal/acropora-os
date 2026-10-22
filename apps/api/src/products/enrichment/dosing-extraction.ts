import {
  parseDose,
  parseWaterParameterCodes,
} from "@acropora/jev/product-enrichment";

import {
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
} from "../../integrations/ai-chat/ai-chat.config.js";
import { readDosing } from "./dosing-reader.js";
import type { ExtractedValue } from "./page-extract.js";

/**
 * THE MANUFACTURER'S DOSING THROUGH ACROPORA AI, CHECKED HERE AGAIN (Product
 * Knowledge, the three dosing states, slice 2; card 85c38ab1). Balázs,
 * 2026-10-21 21:46 UTC: the model reads the manufacturer's page, only a verbatim
 * excerpt counts, and a machine compares it with the downloaded text.
 *
 * The AI service (`POST /v1/dosing-extractions`, acropora-ai-agent #40, #41)
 * already refuses an excerpt the page does not hold and a dose whose numbers
 * are not in their roles. This side does not trust that: before a value
 * becomes a JEV candidate,
 * - the excerpt (and the guidance) is in THIS page's text, spacing aside;
 * - a fixed dose goes through the `dosing` field's own parser, AND the
 *   deterministic reader reads the same dose twice: on the excerpt, and on the
 *   WHOLE page (the model picks the excerpt, so on a page with three doses it
 *   could pick the clean one; barracuda, #1805). Anything else goes to a person;
 * - a NO_DATA does not stand next to a dose the reader found on the page;
 * - the parameters to measure are valid codes.
 * Anything that fails gives no value, only a note on the fetch.
 */

/** The AI endpoint's path on the AI server; unset: the run does not call it at all. */
export const AI_DOSING_PATH_ENV = "ACROPORA_AI_DOSING_PATH";

export type DosingExtractorAnswer =
  | {
      kind: "ANSWER";
      mode: "FIXED" | "TEST_DEPENDENT" | "NO_DATA";
      dose: string | null;
      tests: string[];
      guidance: string | null;
      excerpt: string | null;
      reason: string;
    }
  /** The AI service's own guard refused the model's answer. */
  | { kind: "REFUSED"; refusal: string }
  | { kind: "UNAVAILABLE"; reason: string };

export interface DosingExtractor {
  extract(input: {
    productName: string;
    pageText: string;
  }): Promise<DosingExtractorAnswer>;
}

const MODES = ["FIXED", "TEST_DEPENDENT", "NO_DATA"] as const;
const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * The AI service's detail of a refusal (acropora-ai-agent #44): where a
 * not-found excerpt leaves the page, as a field, two counts and a character
 * code. Taken only in exactly this shape: the note is shown, so no text rides
 * along.
 */
const REFUSAL_DETAIL =
  /^(?:excerpt|guidance) \d{1,4}\/\d{1,4} (?:U\+[0-9A-F]{4,6}|-)$/;

/** The answer's body as the AI service sends it; anything else is UNAVAILABLE. */
export function extractorAnswerOf(body: unknown): DosingExtractorAnswer {
  if (typeof body !== "object" || body === null)
    return { kind: "UNAVAILABLE", reason: "no JSON body" };
  const b = body as Record<string, unknown>;
  if (typeof b.refusal === "string") {
    const detail =
      typeof b.refusalDetail === "string" &&
      REFUSAL_DETAIL.test(b.refusalDetail)
        ? ` ${b.refusalDetail}`
        : "";
    return { kind: "REFUSED", refusal: `${b.refusal.slice(0, 64)}${detail}` };
  }
  if (
    typeof b.mode !== "string" ||
    !(MODES as readonly string[]).includes(b.mode)
  )
    return { kind: "UNAVAILABLE", reason: "unknown mode" };
  return {
    kind: "ANSWER",
    mode: b.mode as (typeof MODES)[number],
    dose: str(b.dose),
    tests: Array.isArray(b.tests) ? b.tests.map((t) => String(t)) : [],
    guidance: str(b.guidance),
    excerpt: str(b.excerpt),
    reason: (str(b.reason) ?? "").slice(0, 300),
  };
}

/**
 * THE AI SERVICE OVER HTTP, like the measurement recommendation's client: the
 * token is held by this process only, and neither the token nor the call's
 * error is ever written out.
 */
export class HttpDosingExtractor implements DosingExtractor {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly path: string,
  ) {}

  async extract(input: {
    productName: string;
    pageText: string;
  }): Promise<DosingExtractorAnswer> {
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
    return extractorAnswerOf(await response.json().catch(() => null));
  }
}

/** The extractor from the environment, or `null`: no path, no AI config, no call. */
export function dosingExtractorFromEnv(
  environment: NodeJS.ProcessEnv,
): DosingExtractor | null {
  const path = environment[AI_DOSING_PATH_ENV]?.trim();
  const config = aiChatConfig(environment);
  return path && config
    ? new HttpDosingExtractor(config.baseUrl, config.token, path)
    : null;
}

/** A page's visible text: scripts, styles and navigation out, block tags as line breaks. */
export function visiblePageText(html: string): string {
  return html
    .replace(
      /<(script|style|noscript|svg|nav|header|footer|template)\b[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(
      /<(br|p|div|li|h\d|tr|td|th|section|article|dd|dt)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

export interface DosingStatement {
  values: ExtractedValue[];
  /** Why no value, one line per reason; shown with the fetch. */
  notes: string[];
}

/**
 * The AI's answer, checked against this page, as the run's candidates.
 * `alreadyRead`: the dose the deterministic reader took from the page's JSON-LD
 * description (#1800), if any: a NO_DATA must not stand next to it.
 */
export function dosingStatement(
  answer: DosingExtractorAnswer,
  pageText: string,
  alreadyRead: string | null = null,
): DosingStatement {
  if (answer.kind === "UNAVAILABLE")
    return {
      values: [],
      notes: [`adagolás (AI): nem elérhető (${answer.reason})`],
    };
  if (answer.kind === "REFUSED")
    return {
      values: [],
      notes: [`adagolás (AI): az AI őre elutasította (${answer.refusal})`],
    };
  const page = squash(pageText);
  for (const text of [answer.excerpt, answer.guidance])
    if (text !== null && !page.includes(squash(text)))
      return { values: [], notes: ["adagolás (AI): a kivonat nincs a lapon"] };
  // the page's own words are an excerpt; the model's reason is not evidence and
  // is named so (barracuda, #1805): the page can steer it
  const where = (text: string | null) =>
    text !== null
      ? `AI-kivonat = ${JSON.stringify(text.slice(0, 200))}`
      : `AI-indoklás (nem lapszöveg) = ${JSON.stringify(answer.reason.slice(0, 200))}`;
  // the deterministic reader on the WHOLE page: one dose, or none it could read
  const wholePage = readDosing(pageText);
  const value = (
    field: ExtractedValue["field"],
    raw: string,
    text: string | null,
  ): ExtractedValue => ({
    field,
    raw: raw.slice(0, 200),
    excerpt: where(text),
  });

  // "no data" or "test-dependent" next to a fixed dose the reader found (on the
  // page or in the description) is a contradiction, not a state (barracuda, #1805)
  const found = wholePage.raw ?? alreadyRead;
  if (answer.mode !== "FIXED" && found !== null)
    return {
      values: [],
      notes: [
        `adagolás (AI): az AI szerint ${answer.mode === "NO_DATA" ? "nincs adat" : "tesztfüggő"}, az olvasó ${found} adagot olvasott`,
      ],
    };
  if (answer.mode === "NO_DATA") {
    return {
      values: [value("dosingMode", "NO_DATA", answer.excerpt)],
      notes: [],
    };
  }

  if (answer.mode === "FIXED") {
    const parsed = parseDose(answer.dose ?? "");
    if (!parsed.ok || answer.excerpt === null)
      return {
        values: [],
        notes: [
          `adagolás (AI): nem gépi alak (${parsed.ok ? "nincs kivonat" : parsed.reason})`,
        ],
      };
    // the second, independent reading of the same excerpt
    const own = readDosing(answer.excerpt);
    if (own.raw !== parsed.canonical)
      return {
        values: [],
        notes: [
          `adagolás (AI): a saját olvasás eltér (AI ${parsed.canonical}, olvasó ${own.raw ?? "nincs érték"}${own.notes.length ? `: ${own.notes.map((n) => n.split(": ")[1]).join("; ")}` : ""})`,
        ],
      };
    // AND on the whole page (barracuda, #1805): the model picks the excerpt, so
    // on a page with three doses it could pick the one that reads clean. The
    // page must hold exactly this dose and nothing the reader cannot read.
    if (wholePage.raw !== parsed.canonical)
      return {
        values: [],
        notes: [
          `adagolás (AI): a teljes lap olvasása eltér (AI ${parsed.canonical}, lap ${wholePage.raw ?? "nincs érték"}${wholePage.notes.length ? `: ${wholePage.notes.map((n) => n.split(": ")[1]).join("; ")}` : ""})`,
        ],
      };
    return {
      values: [
        value("dosing", parsed.canonical, answer.excerpt),
        value("dosingMode", "FIXED", answer.excerpt),
      ],
      notes: [],
    };
  }

  const codes = parseWaterParameterCodes(answer.tests.join(";"));
  if (!codes.ok || answer.guidance === null)
    return {
      values: [],
      notes: [
        `adagolás (AI): tesztfüggő, de hiányos (${codes.ok ? "nincs útmutató" : codes.reason})`,
      ],
    };
  return {
    values: [
      value("dosingMode", "TEST_DEPENDENT", answer.excerpt),
      value("dosingGuidance", answer.guidance, answer.excerpt),
      value("dosingTests", codes.canonical, answer.excerpt),
    ],
    notes: [],
  };
}
