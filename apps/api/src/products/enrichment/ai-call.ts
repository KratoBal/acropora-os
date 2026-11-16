import { AI_CHAT_TIMEOUT_MS } from "../../integrations/ai-chat/ai-chat.config.js";

/**
 * ONE AI SERVICE CALL FROM THE JEV RUN, PACED (T4.4 pilot-20 fourth run, 2026-11-14, card 8639ac2a): with two AI calls
 * per manufacturer page and the imprint pages added, the run made over fifty calls, and the AI service's rate limit
 * answered 429; the Red Sea fields went missing with no word why. acrobot 52514: the AI side's limit stays (it guards
 * the service from everyone else too); the run waits instead.
 *
 * The run already calls one at a time (no call is started before the last one answered). Here: a 429 waits as long as
 * its Retry-After says (seconds or an HTTP date; 5 s when it says nothing; never more than a minute) and tries again,
 * at most three times; one still 429 after that is RATE_LIMITED, named in the run's output, never a silent gap. The
 * token is held by this process only, and neither it nor a call's error is ever written out.
 */
export const AI_RATE_LIMIT_RETRIES = 3;
export const AI_RETRY_AFTER_DEFAULT_MS = 5_000;
export const AI_RETRY_AFTER_MAX_MS = 60_000;

export type AiCallResult =
  { ok: true; body: unknown } | { ok: false; reason: string };

export interface AiCallDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** How long a 429 asks to wait, in ms, capped. */
export function retryAfterMs(header: string | null, now: number): number {
  const value = header?.trim();
  if (value) {
    // a number of seconds, a fraction too: "1.5" must not go to Date.parse, which reads it as the year 2001 and waits 0
    // (barracuda on #2563)
    if (/^\d+(?:\.\d+)?$/.test(value))
      return Math.min(Math.ceil(Number(value) * 1000), AI_RETRY_AFTER_MAX_MS);
    const at = Date.parse(value);
    if (Number.isFinite(at))
      return Math.min(Math.max(at - now, 0), AI_RETRY_AFTER_MAX_MS);
  }
  return AI_RETRY_AFTER_DEFAULT_MS;
}

export async function aiPost(
  url: string,
  token: string,
  payload: unknown,
  deps: AiCallDeps = {},
): Promise<AiCallResult> {
  const call = deps.fetch ?? fetch;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? (() => Date.now());
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await call(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(AI_CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        reason:
          (error as Error)?.name === "TimeoutError" ? "timeout" : "unreachable",
      };
    }
    if (response.status === 429) {
      const wait = retryAfterMs(response.headers.get("retry-after"), now());
      // the 429's body is not read: closed, so the connection is not held until the garbage collector (barracuda #2563)
      await response.body?.cancel().catch(() => undefined);
      if (attempt >= AI_RATE_LIMIT_RETRIES)
        return { ok: false, reason: "RATE_LIMITED" };
      await sleep(wait);
      continue;
    }
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, body: await response.json().catch(() => null) };
  }
}
