import { vi } from "vitest";

export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** An answer: a status and an optional JSON body. */
export function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

/**
 * Replaces `fetch` with a router over "METHOD /path" keys (the path without
 * the `/rc/v1` prefix). A call nobody routed answers 599 and is recorded, so a
 * request the test did not expect fails loudly instead of passing quietly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.replace(/^\/rc\/v1/, "");
      const method = (init?.method ?? "GET").toUpperCase();
      const call: Call = {
        method,
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return handler
        ? handler(call)
        : reply(599, { message: `unrouted ${method} ${path}` });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}
