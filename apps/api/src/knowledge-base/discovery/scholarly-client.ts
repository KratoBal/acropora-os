/**
 * READING THE THREE SCHOLARLY APIS, POLITELY (research engine S2).
 *
 * - **Who we are:** every request carries `DISCOVERY_USER_AGENT`. No key, no
 *   e-mail, no account (the pilot runs on the keyless budget, acrobot 35560).
 * - **Pace:** at least `API_DELAY_MS[api]` between two requests to one API.
 *   Crossref's keyless public pool allows one request a second and one at a
 *   time (measured 2026-10-23, `x-api-pool: public-array`); the run never
 *   sends two at once to anybody.
 * - **A 429 is waited out, a little:** the API said "slower", so the client
 *   waits what `Retry-After` asks (or `RETRY_429_MS` without it) and asks
 *   again, at most `RETRY_429_MS.length` times, each retry counted against
 *   the limit. A wait longer than `MAX_RETRY_WAIT_MS` (OpenAlex's daily
 *   keyless budget gone, say) is not waited: the API is unavailable. Measured
 *   2026-10-23: Crossref answered 429 to the first request of a run started
 *   seconds after a 50-request run, at the pace its headers allow, and 200
 *   again a minute later.
 * - **Refusal is an answer:** a 5xx, a timeout, a network error, a non-JSON or
 *   oversized answer, or a 429 that outlasts the retries, makes THAT API
 *   unavailable for the rest of the run, with the reason in the report.
 *   Nothing else retries or tries another way in. A 404 is an answer about
 *   the one URL, not about the API.
 * - **Cap:** every request counts against the run's limit; reaching it throws
 *   `RequestLimitReached`, and the run stops there, reported.
 */
export const DISCOVERY_USER_AGENT =
  "AcroporaOS-Research/1.0 (+https://acropora.hu; kutatasi-forras-felderites)";

export type ScholarlyApi = "OPENALEX" | "CROSSREF" | "EUROPE_PMC";

export const API_DELAY_MS: Record<ScholarlyApi, number> = {
  OPENALEX: 200,
  CROSSREF: 1_100,
  EUROPE_PMC: 200,
};
export const REQUEST_TIMEOUT_MS = 30_000;
/** The waits before the retries of a 429 without `Retry-After`. */
export const RETRY_429_MS = [15_000, 45_000] as const;
export const MAX_RETRY_WAIT_MS = 60_000;
export const MAX_ANSWER_BYTES = 10_000_000;

export type ApiFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<Response>;

export type ApiAnswer =
  | { ok: true; json: unknown; httpStatus: number }
  | { ok: false; reason: string; httpStatus: number | null };

export class RequestLimitReached extends Error {
  constructor(readonly limit: number) {
    super(`request limit ${limit} reached`);
  }
}

export interface ScholarlyClientDeps {
  fetch: ApiFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  requestLimit: number;
}

export class ScholarlyClient {
  private count = 0;
  private readonly last = new Map<ScholarlyApi, number>();
  /** APIs that refused during this run, with the first reason. */
  readonly unavailable = new Map<ScholarlyApi, string>();
  /** The last 429's `Retry-After`, in ms; null when it sent none. */
  private retryAfterMs: number | null = null;

  constructor(private readonly deps: ScholarlyClientDeps) {}

  get requestCount(): number {
    return this.count;
  }

  async getJson(api: ScholarlyApi, url: string): Promise<ApiAnswer> {
    for (let attempt = 0; ; attempt += 1) {
      const answer = await this.getOnce(api, url);
      if (answer !== "TOO_MANY") return answer;
      if (attempt >= RETRY_429_MS.length)
        return this.refuse(api, "HTTP_429", 429);
      const wait = this.retryAfterMs ?? RETRY_429_MS[attempt]!;
      if (wait > MAX_RETRY_WAIT_MS) return this.refuse(api, "HTTP_429", 429);
      await this.deps.sleep(wait);
    }
  }

  private async getOnce(
    api: ScholarlyApi,
    url: string,
  ): Promise<ApiAnswer | "TOO_MANY"> {
    const refused = this.unavailable.get(api);
    if (refused)
      return {
        ok: false,
        reason: `API_UNAVAILABLE:${refused}`,
        httpStatus: null,
      };
    if (this.count >= this.deps.requestLimit)
      throw new RequestLimitReached(this.deps.requestLimit);
    const previous = this.last.get(api);
    if (previous !== undefined) {
      const wait = previous + API_DELAY_MS[api] - this.deps.now().getTime();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.count += 1;
    this.last.set(api, this.deps.now().getTime());
    let response: Response;
    try {
      response = await this.deps.fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": DISCOVERY_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "NETWORK";
      return this.refuse(api, reason, null);
    }
    if (response.status === 404)
      return { ok: false, reason: "HTTP_404", httpStatus: 404 };
    if (response.status === 429) {
      // Retry-After in seconds; an HTTP date is not read (none seen), the default wait applies
      const header = Number(response.headers.get("retry-after") ?? "");
      this.retryAfterMs =
        Number.isFinite(header) && header > 0 ? header * 1000 : null;
      return "TOO_MANY";
    }
    if (response.status !== 200)
      return this.refuse(api, `HTTP_${response.status}`, response.status);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_ANSWER_BYTES)
      return this.refuse(api, "TOO_LARGE", response.status);
    const text = await response.text();
    if (text.length > MAX_ANSWER_BYTES)
      return this.refuse(api, "TOO_LARGE", response.status);
    try {
      return { ok: true, json: JSON.parse(text), httpStatus: response.status };
    } catch {
      return this.refuse(api, "NOT_JSON", response.status);
    }
  }

  private refuse(
    api: ScholarlyApi,
    reason: string,
    httpStatus: number | null,
  ): ApiAnswer {
    if (!this.unavailable.has(api)) this.unavailable.set(api, reason);
    return { ok: false, reason, httpStatus };
  }
}
