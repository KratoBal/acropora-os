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
 * - a NO_DATA does not stand next to a dose the reader found on the page, nor
 *   next to a dose sentence it held back (a range, two doses): the page states
 *   a dose, only not one the machine can take;
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

/** Sectioning and main content: a header or footer inside one belongs to the content. */
const CONTENT_SCOPES = new Set(["article", "section", "main", "aside"]);

/**
 * THE PAGE'S OWN HEADER AND FOOTER OUT, A CONTENT HEADER KEPT (card 85c38ab1:
 * Fauna Marin Dino M states its dose in a <header> under main > section >
 * article; every header was dropped, the AI never saw the dose, and NO_DATA
 * went through). As in HTML's banner and contentinfo rule, only a header or
 * footer with no article, section, main or aside open around it is page
 * chrome. One that never closes stays, like before.
 */
function withoutPageChrome(html: string): string {
  const cuts: [number, number][] = [];
  const open: string[] = [];
  let chrome: { tag: string; start: number; depth: number } | null = null;
  for (const m of html.matchAll(
    /<(\/?)(article|section|main|aside|header|footer)\b[^>]*>/gi,
  )) {
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      const at = open.lastIndexOf(tag);
      if (at >= 0) open.splice(at);
      if (chrome && tag === chrome.tag && open.length === chrome.depth) {
        cuts.push([chrome.start, m.index + m[0].length]);
        chrome = null;
      }
      continue;
    }
    if (
      !chrome &&
      (tag === "header" || tag === "footer") &&
      !open.some((t) => CONTENT_SCOPES.has(t))
    )
      chrome = { tag, start: m.index, depth: open.length };
    open.push(tag);
  }
  let out = "";
  let from = 0;
  for (const [start, end] of cuts) {
    out += `${html.slice(from, start)} `;
    from = end;
  }
  return out + html.slice(from);
}

/**
 * THE PAGE'S CHARACTERS, NOT ITS ENTITIES (T4.4 pilot-20, third run, 2026-11-14, card 8639ac2a): only five entities were
 * decoded, so a page writing "Tropic Marin&reg;" reached the AI as "&reg;", the model copied the anchor with "®", and the
 * guard rightly found it nowhere on the page (ANCHOR_NOT_IN_PAGE at U+00AE; the Syn-Biotic dose fell the same way). Every
 * numeric entity and the named ones these pages use are decoded, in ONE pass, so "&amp;reg;" stays the text "&reg;". The
 * exact character, not an ASCII stand-in (unlike the product search's decoder): the reader and the guard compare it. A
 * soft hyphen is invisible on the page, so it goes; an unknown name stays as written.
 */
const NAMED: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  reg: "®",
  trade: "™",
  copy: "©",
  deg: "°",
  micro: "µ",
  // the salinity of a sea salt (‰), seen on the Syn-Biotic page
  permil: "‰",
  sup2: "²",
  sup3: "³",
  times: "×",
  plusmn: "±",
  divide: "÷",
  euro: "€",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  shy: "",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  lsaquo: "‹",
  rsaquo: "›",
  raquo: "»",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  odblac: "ő",
  udblac: "ű",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Odblac: "Ő",
  Udblac: "Ű",
  agrave: "à",
  egrave: "è",
  ccedil: "ç",
  ntilde: "ñ",
  oslash: "ø",
  aring: "å",
};
const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi;
function decodeEntity(whole: string, body: string): string {
  if (body.startsWith("#")) {
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
    return code === 0xad ? "" : String.fromCodePoint(code);
  }
  return NAMED[body] ?? whole;
}

/** A page's visible text: scripts, styles, navigation and the page's own header and footer out, block tags as line breaks. */
export function visiblePageText(html: string): string {
  return withoutPageChrome(
    html.replace(
      /<(script|style|noscript|svg|nav|template)\b[\s\S]*?<\/\1>/gi,
      " ",
    ),
  )
    .replace(
      /<(br|p|div|li|h\d|tr|td|th|section|article|dd|dt)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(ENTITY, decodeEntity)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** The reader's held-back reasons, without the pack-size remarks, at most three, each capped. */
export const HELD_BACK_NOTES = { max: 3, length: 300 } as const;
export function heldBackNotes(notes: readonly string[]): string[] {
  return notes
    .filter((note) => !note.startsWith("adagolás: kiszerelés-mondat"))
    .slice(0, HELD_BACK_NOTES.max)
    .map((note) =>
      note.length > HELD_BACK_NOTES.length
        ? `${note.slice(0, HELD_BACK_NOTES.length - 1)}…`
        : note,
    );
}

export interface DosingStatement {
  values: ExtractedValue[];
  /** Why no value, one line per reason; shown with the fetch. */
  notes: string[];
}

/**
 * The AI's answer, checked against this page, as the run's candidates.
 * `alreadyRead`: the dose the deterministic reader took from the page's JSON-LD
 * description (#1800), if any: a NO_DATA must not stand next to it.
 * `descriptionDoseOnPage`: that description states a dose the reader read or
 * held back; `pageText` leaves the script out, so it is passed apart
 * (barracuda, #2538).
 */
export function dosingStatement(
  answer: DosingExtractorAnswer,
  pageText: string,
  alreadyRead: string | null = null,
  descriptionDoseOnPage = false,
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
  // "no data" next to a dose sentence the reader held back: the page states a
  // dose, so a person reads it (Fauna Marin Multi Elements A, card 85c38ab1:
  // a range dose, the AI said NO_DATA, and NO_DATA went through as a value)
  // A TEST_DEPENDENT next to a held-back dose stays allowed on purpose: a range
  // or an unread sentence is what a measured, adjusted dose looks like, and
  // its guidance must still stand on the page (above).
  if (
    answer.mode === "NO_DATA" &&
    (wholePage.doseOnPage || descriptionDoseOnPage)
  )
    return {
      values: [],
      notes: [
        `adagolás (AI): az AI szerint nincs adat, az olvasó adag-mondatot talált, amit nem tudott gépi alakra hozni (${wholePage.doseOnPage ? "a lapon" : "a leírásban"})`,
        // the reader's own reasons with the page's sentence, for the person who reads it next (acrobot 51082: this is the
        // most frequent outcome of the bulk round); the description's reasons are on the fetch already (page-extract)
        ...heldBackNotes(wholePage.notes),
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
