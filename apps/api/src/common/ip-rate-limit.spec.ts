import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callerAddress, IpRateLimiter } from "./ip-rate-limit.js";

describe("IpRateLimiter (#1582 P4b)", () => {
  it("lets one caller through its limit, then refuses until the window turns", () => {
    const limiter = new IpRateLimiter(2, 100, 60_000);
    const at = 1_000_000;
    assert.deepEqual(
      [limiter.hit("a", at), limiter.hit("a", at), limiter.hit("a", at)],
      [true, true, false],
    );
    // another caller is counted on its own
    assert.equal(limiter.hit("b", at), true);
    // the next minute starts from zero
    assert.equal(limiter.hit("a", at + 60_000), true);
  });

  it("holds the shared ceiling when every request claims a new address", () => {
    const limiter = new IpRateLimiter(2, 3, 60_000);
    const at = 2_000_000;
    assert.deepEqual(
      ["x", "y", "z", "w"].map((caller) => limiter.hit(caller, at)),
      [true, true, true, false],
    );
  });

  it("reads the first forwarded hop, else the socket", () => {
    assert.deepEqual(
      [
        callerAddress({
          headers: { "x-forwarded-for": " 203.0.113.7, 10.0.0.1" },
          ip: "10.0.0.2",
        }),
        callerAddress({ headers: {}, ip: "10.0.0.2" }),
        callerAddress({ headers: {} }),
      ],
      ["203.0.113.7", "10.0.0.2", "unknown"],
    );
  });
});
