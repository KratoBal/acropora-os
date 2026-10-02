import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantApi } from "./assistant";
afterEach(() => vi.unstubAllGlobals());
describe("Sutyerák NDJSON browser stream", () => {
  it("handles split UTF-8 and split JSON lines incrementally", async () => {
    const events: unknown[] = [];
    let enqueue!: (chunk: Uint8Array) => void;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue = (value) => controller.enqueue(value);
        close = () => controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    const pending = assistantApi.ask(
      "user-token",
      { question: "Kérdés", context: { page: "/" } },
      (event) => events.push(event),
      new AbortController().signal,
    );
    const text = new TextEncoder().encode('{"type":"text","delta":"árvíz"}\n');
    enqueue(text.slice(0, 25));
    enqueue(text.slice(25));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([{ type: "text", delta: "árvíz" }]);
    enqueue(
      new TextEncoder().encode(
        '{"type":"done","answer":"árvíz","durationMs":1,"toolCalls":0}',
      ),
    );
    close();
    await pending;
    expect(events).toHaveLength(2);
  });
  it("incomplete gateway EOF becomes a visible failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"type":"text","delta":"félbe"}\n')),
    );
    await expect(
      assistantApi.ask(
        "",
        { question: "Kérdés", context: { page: "/" } },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/megszakadt/);
  });
});
