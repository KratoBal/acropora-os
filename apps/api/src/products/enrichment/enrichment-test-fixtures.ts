/**
 * Invented pages and a scripted network for the enrichment specs. No real
 * product, shop page or response is in here.
 */
export function productPage(product: Record<string, unknown>): string {
  return `<!doctype html><html><head><title>Kitalált termék</title>
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    ...product,
  })}</script></head><body><h1>Kitalált</h1></body></html>`;
}

export const CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title></head><body><div id="cf-browser-verification"></div></body></html>';

export interface ScriptedAnswer {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/** A network that answers from a table and records every request. */
export function scriptedNetwork(table: Record<string, ScriptedAnswer>) {
  const requests: {
    url: string;
    method: string;
    userAgent: string | undefined;
  }[] = [];
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string> },
  ): Promise<Response> => {
    requests.push({
      url,
      method: init.method,
      userAgent: init.headers["User-Agent"],
    });
    const answer =
      table[url] ??
      (url.endsWith("/robots.txt") ? { status: 404 } : { status: 404 });
    const headers = new Headers(answer.headers ?? {});
    if (!headers.has("content-type"))
      headers.set(
        "content-type",
        url.endsWith("/robots.txt") ? "text/plain" : "text/html; charset=utf-8",
      );
    return new Response(answer.status === 204 ? null : (answer.body ?? ""), {
      status: answer.status,
      headers,
    });
  };
  return { fetch, requests };
}

/** A clock that only moves when the code sleeps. */
export function fakeClock(start = Date.parse("2026-10-02T21:00:00.000Z")) {
  let now = start;
  const slept: number[] = [];
  return {
    now: () => new Date(now),
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    slept,
  };
}
