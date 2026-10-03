import {
  ALLOW_ALL,
  DISALLOW_ALL,
  parseRobots,
  robotsAllows,
  type RobotsRules,
} from "./robots.js";

/**
 * READING A PUBLIC PRODUCT PAGE, POLITELY (PD-013 item 2).
 *
 * - **Who we are:** every request carries `ENRICHMENT_USER_AGENT`, a product
 *   token plus a contact URL. No login, no cookies, no cart, no paid content:
 *   only an anonymous GET of a public page.
 * - **robots.txt:** read once per host per run, before the first page. A path
 *   it disallows is never requested. A robots.txt that answers 401/403 means
 *   "everything is disallowed"; one that cannot be read at all (network
 *   error, 429, 5xx) makes the host unavailable for this run. A missing one
 *   (404 and the other 4xx) allows everything, as the RFC says. A redirect is
 *   followed (up to `MAX_REDIRECTS` hops, RFC 9309 2.3.1.2) only when it stays
 *   on the same site: https, and the same host give or take `www.`. Tunze
 *   (www -> bare) and marine-aquatics.eu (bare -> www) both answer this way,
 *   and without it their every page was ROBOTS_UNREADABLE (first live round,
 *   2026-10-03). A redirect anywhere else leaves the host unreadable.
 * - **Pace:** at least `HOST_DELAY_MS` between two requests to the same host,
 *   or the robots.txt `Crawl-delay` when that is longer (capped).
 * - **Cache:** one run asks for a URL once; the second ask gets the first
 *   answer.
 * - **Refusal is an answer, not a detour:** 401, 403, 429, 503, a challenge or
 *   captcha page, a redirect to another site, a non-HTML answer or an
 *   oversized one make the source UNAVAILABLE with a reason. Nothing retries,
 *   rotates, or tries another way in.
 * - **Cap:** every request (robots.txt included) counts against the run's
 *   request limit; reaching it throws `RequestLimitReached`, and the run
 *   stops there.
 */
export const ENRICHMENT_USER_AGENT =
  "AcroporaOS-JEV/1.0 (+https://acropora.hu; termekadat-ellenorzes)";
/** The product token robots.txt groups are matched against. */
export const ENRICHMENT_ROBOTS_TOKEN = "AcroporaOS-JEV";
export const HOST_DELAY_MS = 5_000;
export const MAX_CRAWL_DELAY_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_PAGE_BYTES = 2_000_000;
export const MAX_ROBOTS_BYTES = 512_000;
const MAX_REDIRECTS = 3;

export type EnrichmentFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<Response>;

export type PageUnavailableReason =
  | "ROBOTS_DISALLOWED"
  | "ROBOTS_UNREADABLE"
  | "CHALLENGE"
  | "REDIRECT_OFF_SOURCE"
  | "TOO_MANY_REDIRECTS"
  | "NOT_HTML"
  | "TOO_LARGE"
  | "TIMEOUT"
  | "NETWORK"
  | `HTTP_${number}`;

export type PageResult =
  | { ok: true; url: string; html: string; httpStatus: number; fetchedAt: Date }
  | {
      ok: false;
      reason: PageUnavailableReason;
      httpStatus: number | null;
      fetchedAt: Date;
    };

export class RequestLimitReached extends Error {
  constructor(readonly limit: number) {
    super(`REQUEST_LIMIT_REACHED (${limit})`);
    this.name = "RequestLimitReached";
  }
}

/** Markers of a bot challenge or captcha page, not a product page. */
const CHALLENGE =
  /cf-browser-verification|challenge-platform|cf_chl_|g-recaptcha|hcaptcha|h-captcha|px-captcha|captcha-delivery|datadome|<title>\s*(?:just a moment|attention required|access denied|are you a robot)/i;

export function looksLikeChallenge(html: string): boolean {
  return CHALLENGE.test(html.slice(0, 50_000));
}

/** https, and the same host as `origin` give or take a leading `www.`. */
function sameSite(url: URL, origin: URL): boolean {
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.port === origin.port &&
    bare(url.hostname) === bare(origin.hostname)
  );
}

export interface PoliteFetcherDeps {
  fetch: EnrichmentFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  requestLimit: number;
}

export class PoliteFetcher {
  private requests = 0;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robots = new Map<
    string,
    Promise<RobotsRules | "UNREADABLE">
  >();
  private readonly pages = new Map<string, Promise<PageResult>>();

  constructor(private readonly deps: PoliteFetcherDeps) {}

  get requestCount(): number {
    return this.requests;
  }

  /**
   * One page. `stillAllowed(url)` re-checks a redirect target against the
   * source's host rule; a redirect it refuses is not followed.
   */
  page(
    url: string,
    stillAllowed: (url: string) => boolean,
  ): Promise<PageResult> {
    let pending = this.pages.get(url);
    if (!pending) {
      pending = this.load(url, stillAllowed, 0);
      this.pages.set(url, pending);
    }
    return pending;
  }

  private async load(
    url: string,
    stillAllowed: (url: string) => boolean,
    hops: number,
  ): Promise<PageResult> {
    const target = new URL(url);
    const rules = await this.robotsFor(target);
    if (rules === "UNREADABLE") return this.unavailable("ROBOTS_UNREADABLE");
    if (!robotsAllows(rules, target.pathname + target.search))
      return this.unavailable("ROBOTS_DISALLOWED");

    const delay = Math.min(
      Math.max(HOST_DELAY_MS, (rules.crawlDelaySeconds ?? 0) * 1000),
      MAX_CRAWL_DELAY_MS,
    );
    let response: Response;
    try {
      response = await this.request(
        target,
        "text/html,application/xhtml+xml",
        delay,
      );
    } catch (error) {
      if (error instanceof RequestLimitReached) throw error;
      return this.unavailable(
        error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "NETWORK",
      );
    }
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) return this.unavailable(`HTTP_${status}`, status);
      if (hops >= MAX_REDIRECTS)
        return this.unavailable("TOO_MANY_REDIRECTS", status);
      const next = new URL(location, target).toString();
      if (!stillAllowed(next))
        return this.unavailable("REDIRECT_OFF_SOURCE", status);
      return this.load(next, stillAllowed, hops + 1);
    }
    if (status < 200 || status >= 300)
      return this.unavailable(`HTTP_${status}`, status);
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type))
      return this.unavailable("NOT_HTML", status);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PAGE_BYTES) return this.unavailable("TOO_LARGE", status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PAGE_BYTES)
      return this.unavailable("TOO_LARGE", status);
    const html = new TextDecoder("utf-8").decode(bytes);
    if (looksLikeChallenge(html)) return this.unavailable("CHALLENGE", status);
    return {
      ok: true,
      url: target.toString(),
      html,
      httpStatus: status,
      fetchedAt: this.deps.now(),
    };
  }

  private robotsFor(target: URL): Promise<RobotsRules | "UNREADABLE"> {
    let pending = this.robots.get(target.host);
    if (!pending) {
      pending = this.readRobots(target);
      this.robots.set(target.host, pending);
    }
    return pending;
  }

  private async readRobots(target: URL): Promise<RobotsRules | "UNREADABLE"> {
    let url = new URL("/robots.txt", target);
    let response: Response;
    for (let hops = 0; ; hops += 1) {
      try {
        response = await this.request(url, "text/plain", HOST_DELAY_MS);
      } catch (error) {
        if (error instanceof RequestLimitReached) throw error;
        return "UNREADABLE";
      }
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || hops >= MAX_REDIRECTS) return "UNREADABLE";
      const next = new URL(location, url);
      if (!sameSite(next, target)) return "UNREADABLE";
      url = next;
    }
    const status = response.status;
    if (status === 401 || status === 403) return DISALLOW_ALL;
    if (status === 429 || status >= 500) return "UNREADABLE";
    if (status >= 400) return ALLOW_ALL;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ROBOTS_BYTES) return "UNREADABLE";
    return parseRobots(
      new TextDecoder("utf-8").decode(bytes),
      ENRICHMENT_ROBOTS_TOKEN,
    );
  }

  /** The only way out: a GET, paced per host, counted against the cap. */
  private async request(
    url: URL,
    accept: string,
    delayMs: number,
  ): Promise<Response> {
    if (this.requests >= this.deps.requestLimit)
      throw new RequestLimitReached(this.deps.requestLimit);
    const last = this.lastRequestAt.get(url.host);
    if (last !== undefined) {
      const wait = last + delayMs - this.deps.now().getTime();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.requests += 1;
    this.lastRequestAt.set(url.host, this.deps.now().getTime());
    return this.deps.fetch(url.toString(), {
      method: "GET",
      headers: { "User-Agent": ENRICHMENT_USER_AGENT, Accept: accept },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private unavailable(
    reason: PageUnavailableReason,
    httpStatus: number | null = null,
  ): PageResult {
    return { ok: false, reason, httpStatus, fetchedAt: this.deps.now() };
  }
}
