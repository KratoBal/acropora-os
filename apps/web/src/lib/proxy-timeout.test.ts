import { describe, expect, it } from "vitest";

import { PROXY_TIMEOUT_ENV, proxyTimeoutMs } from "./proxy-timeout";

describe("proxyTimeoutMs", () => {
  it("defaults above the limits inside the chain", () => {
    // The ladder only works one way round: the model call gives up at 40 s
    // with a named error, the socket net at 45 s, and this proxy above both.
    // If this default ever slips under them, the proxy fires first and the
    // browser is back to a bare 500 that explains nothing.
    const value = proxyTimeoutMs({});

    expect(value).toBe(50_000);
    expect(value).toBeGreaterThan(45_000);
    expect(value).toBeGreaterThan(40_000);
  });

  it("is not left at Next's own default", () => {
    // 30 000 is the inherited value nobody chose, and it is what made a slow
    // answer look like a broken server.
    expect(proxyTimeoutMs({})).not.toBe(30_000);
  });

  it("takes the value from the environment", () => {
    expect(proxyTimeoutMs({ [PROXY_TIMEOUT_ENV]: "75000" })).toBe(75_000);
  });

  it("falls back instead of breaking the build on a bad value", () => {
    // next.config.ts runs during the image build. A typo that stops the build
    // fails the deploy for a reason that looks unrelated to the number.
    for (const raw of ["", "   ", "abc", "-1", "0", "12.5", "9999999", "NaN"]) {
      expect(proxyTimeoutMs({ [PROXY_TIMEOUT_ENV]: raw })).toBe(50_000);
    }
  });
});
