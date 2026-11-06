import { afterEach, describe, expect, it, vi } from "vitest";

import { livestockArrivalsApi } from "./livestock-arrivals";

/**
 * WHAT TURNS THIS RED (V2.6 S2c, card f4e4832b). The page test mocks this module, so what actually goes over the wire is
 * measured here: a modification without the version the form was loaded from (the server then reads fresh on every PATCH and
 * two open forms overwrite each other); a creation that carries a version it has not got; the product search term not
 * encoded, or sent when blank.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const input = {
  kind: "FISH" as const,
  label: "Paracanthurus hepatus",
  productId: null,
  expectedOn: "2026-11-20",
  quantity: null,
  status: "ORDERED" as const,
  preorderable: false,
  note: null,
};

function respond() {
  // a fresh Response per call: a body can be read once
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

describe("the arrivals client's requests", () => {
  it("a modification carries the version it was loaded from next to the fields", async () => {
    const fetchMock = respond();
    await livestockArrivalsApi.update(
      "t",
      "a 1",
      input,
      "2026-11-06T09:30:00.000Z",
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/livestock-arrivals/a%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      ...input,
      expectedUpdatedAt: "2026-11-06T09:30:00.000Z",
    });
  });

  it("a creation sends the fields only: there is no version to expect yet", async () => {
    const fetchMock = respond();
    await livestockArrivalsApi.create("t", input);
    const init = fetchMock.mock.calls[0]![1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("the product search encodes the term, and a blank term asks without one", async () => {
    const fetchMock = respond();
    await livestockArrivalsApi.productOptions("t", " zoa & mix ");
    await livestockArrivalsApi.productOptions("t", "   ");
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "/livestock-arrivals/options/products?q=zoa%20%26%20mix",
    );
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(
      /\/livestock-arrivals\/options\/products$/,
    );
  });
});
