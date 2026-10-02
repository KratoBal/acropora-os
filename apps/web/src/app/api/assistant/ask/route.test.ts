// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("passes a live stream without buffering and forwards USER cookie/CSRF only", async () => {
  vi.stubEnv("ACROPORA_API_PROXY_URL", "http://api.test");
  let push!: (value: string) => void;
  let close!: () => void;
  const upstream = new ReadableStream({
    start(controller) {
      push = (text) => controller.enqueue(new TextEncoder().encode(text));
      close = () => controller.close();
    },
  });
  const fetcher = vi.fn().mockResolvedValue(
    new Response(upstream, {
      headers: { "Content-Type": "application/x-ndjson" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const request = new Request("http://web.test/api/assistant/ask", {
    method: "POST",
    headers: {
      cookie: "acropora_session=user",
      "x-csrf-token": "csrf",
      "x-gateway-secret": "ignore",
    },
    body: "{}",
  });
  const response = await POST(request);
  const headers = fetcher.mock.calls[0]![1].headers as Headers;
  expect(headers.get("cookie")).toBe("acropora_session=user");
  expect(headers.get("x-csrf-token")).toBe("csrf");
  expect(headers.get("x-gateway-secret")).toBeNull();
  const reader = response.body!.getReader();
  push('{"type":"text","delta":"első"}\n');
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "első",
  );
  close();
  expect((await reader.read()).done).toBe(true);
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  expect(response.headers.get("content-encoding")).toBe("identity");
});
it("API connection failure produces an error event", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(
    (
      await (
        await POST(
          new Request("http://web.test", { method: "POST", body: "{}" }),
        )
      ).json()
    ).type,
  ).toBe("error");
});

it("preserves USER sliding-session cookies from the API", async () => {
  const upstream = new Response("", {
    headers: { "Content-Type": "application/x-ndjson" },
  });
  Object.defineProperty(upstream.headers, "getSetCookie", {
    value: () => [
      "acropora_session=user-refresh; HttpOnly",
      "acropora_csrf=csrf-refresh",
    ],
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
  const response = await POST(
    new Request("http://web.test", { method: "POST", body: "{}" }),
  );
  expect(response.headers.get("set-cookie")).toContain(
    "acropora_session=user-refresh",
  );
  expect(response.headers.get("set-cookie")).toContain(
    "acropora_csrf=csrf-refresh",
  );
});
