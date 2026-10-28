import {
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
} from "../../integrations/ai-chat/ai-chat.config.js";

/**
 * The Acropora AI's two mode B calls (ai-agent #53), as the claim extractor
 * and the answer client call theirs: the shared AI token, the chat timeout,
 * and a path from the environment each. No path, no call: the start endpoint
 * answers 503.
 *
 *   - `/v1/research-queries`: the editor's question -> at most three English
 *     search expressions, already guarded to the search syntax there;
 *   - `/v1/research-summaries`: the question and the checked candidate claims
 *     -> a summary whose every sentence ends with claim markers.
 *
 * Neither call sees an abstract or a full text: the queries are made from the
 * question, the summary from the OS's checked claims.
 */
export const AI_RESEARCH_QUERIES_PATH_ENV = "ACROPORA_AI_RESEARCH_QUERIES_PATH";
export const AI_RESEARCH_SUMMARY_PATH_ENV = "ACROPORA_AI_RESEARCH_SUMMARY_PATH";

const CODE = /^[A-Z_]{1,40}$/;
const WRITTEN_BY = /^[\w.:/ -]{1,128}$/;
/** The AI service's own query guard (research-draft.ts there), checked again here: it goes to an external API. */
const QUERY = /^[A-Za-z0-9 "()-]{3,200}$/;
export const MAX_QUERIES = 3;

/**
 * The expression is wrapped (`(TITLE_ABS:(q)) AND OPEN_ACCESS:y`): an unbalanced parenthesis would
 * close the field early and bind the open-access filter to one branch only (`x)) OR (y`), and an odd
 * quotation mark would take the rest of the wrapper into a phrase (barracuda on #1934). A parenthesis
 * inside a phrase is refused too: the guard counts, it does not parse.
 */
export function balancedQuery(q: string): boolean {
  let depth = 0;
  for (const ch of q) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && --depth < 0) return false;
  }
  return (
    depth === 0 &&
    (q.match(/"/g)?.length ?? 0) % 2 === 0 &&
    !/"[^"]*[()][^"]*"/.test(q)
  );
}

export type Unavailable = { kind: "UNAVAILABLE"; reason: string };
export type Refused = { kind: "REFUSED"; refusal: string; writtenBy: string };

export type QueriesAnswer =
  | { kind: "QUERIES"; queries: string[]; refused: string[]; writtenBy: string }
  | Refused
  | Unavailable;

export type SummaryAnswer =
  | {
      kind: "SUMMARY";
      summary: string;
      kept: number;
      /** The AI side's dropped sentences, by code. */
      dropped: string[];
      /**
       * Places where the AI side's guard moved markers written after a period before it (acropora-ai-agent
       * #55, #56): each binds them to the sentence before. Null when the AI side does not say.
       */
      markersMoved: number | null;
      writtenBy: string;
    }
  | Refused
  | Unavailable;

export interface SummaryClaimInput {
  id: string;
  fields: string;
  passage: string;
  source: string;
}

export interface ResearchAsker {
  queries(question: string): Promise<QueriesAnswer>;
  summary(
    question: string,
    claims: SummaryClaimInput[],
  ): Promise<SummaryAnswer>;
}

const record = (body: unknown): Record<string, unknown> | null =>
  typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
const writtenBy = (b: Record<string, unknown>) =>
  typeof b.writtenBy === "string" && WRITTEN_BY.test(b.writtenBy)
    ? b.writtenBy
    : "unknown";
const codes = (list: unknown, key: string): string[] =>
  (Array.isArray(list) ? list : []).map((r) => {
    const code = record(r)?.[key];
    return typeof code === "string" && CODE.test(code) ? code : "UNKNOWN";
  });
const refusal = (b: Record<string, unknown>): Refused | null =>
  typeof b.refusal === "string"
    ? {
        kind: "REFUSED",
        refusal: CODE.test(b.refusal) ? b.refusal : "UNKNOWN_REFUSAL",
        writtenBy: writtenBy(b),
      }
    : null;

/** The queries answer; a query that does not pass the syntax check here is dropped as BAD_QUERY. */
export function queriesOf(body: unknown): QueriesAnswer {
  const b = record(body);
  if (!b) return { kind: "UNAVAILABLE", reason: "no JSON body" };
  const refused = refusal(b);
  if (refused) return refused;
  if (!Array.isArray(b.queries))
    return { kind: "UNAVAILABLE", reason: "no query list" };
  const queries: string[] = [];
  const dropped = codes(b.refused, "refusal");
  for (const q of b.queries) {
    if (
      typeof q === "string" &&
      QUERY.test(q) &&
      balancedQuery(q) &&
      queries.length < MAX_QUERIES &&
      !queries.includes(q)
    )
      queries.push(q);
    else dropped.push("BAD_QUERY");
  }
  return {
    kind: "QUERIES",
    queries,
    refused: dropped,
    writtenBy: writtenBy(b),
  };
}

export function summaryOf(body: unknown): SummaryAnswer {
  const b = record(body);
  if (!b) return { kind: "UNAVAILABLE", reason: "no JSON body" };
  const refused = refusal(b);
  if (refused) return refused;
  if (typeof b.summary !== "string")
    return { kind: "UNAVAILABLE", reason: "no summary" };
  return {
    kind: "SUMMARY",
    summary: b.summary,
    kept: typeof b.kept === "number" ? b.kept : 0,
    dropped: codes(b.dropped, "drop"),
    markersMoved:
      Number.isSafeInteger(b.markersMoved) && (b.markersMoved as number) >= 0
        ? (b.markersMoved as number)
        : null,
    writtenBy: writtenBy(b),
  };
}

async function post(
  url: string,
  token: string,
  body: unknown,
): Promise<{ ok: true; json: unknown } | Unavailable> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
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
  return { ok: true, json: await response.json().catch(() => null) };
}

export function httpResearchAsker(
  baseUrl: string,
  token: string,
  paths: { queries: string; summary: string },
): ResearchAsker {
  const url = (path: string) => `${baseUrl}/${path.replace(/^\/+/, "")}`;
  return {
    async queries(question) {
      const r = await post(url(paths.queries), token, { question });
      return "ok" in r ? queriesOf(r.json) : r;
    },
    async summary(question, claims) {
      const r = await post(url(paths.summary), token, { question, claims });
      return "ok" in r ? summaryOf(r.json) : r;
    },
  };
}

/** The asker from the environment, or `null`: both paths and the AI config, or no call. */
export function researchAskerFromEnv(
  environment: NodeJS.ProcessEnv,
): ResearchAsker | null {
  const queries = environment[AI_RESEARCH_QUERIES_PATH_ENV]?.trim();
  const summary = environment[AI_RESEARCH_SUMMARY_PATH_ENV]?.trim();
  const config = aiChatConfig(environment);
  return queries && summary && config
    ? httpResearchAsker(config.baseUrl, config.token, { queries, summary })
    : null;
}
