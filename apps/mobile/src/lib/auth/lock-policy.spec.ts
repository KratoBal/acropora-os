import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_FOREGROUND_LOCK_THRESHOLD_MS,
  decideForegroundLock,
  parseLockThresholdSeconds,
} from "./lock-policy";

const THRESHOLD = DEFAULT_FOREGROUND_LOCK_THRESHOLD_MS;
const NOW = 1_700_000_000_000;

describe("decideForegroundLock", () => {
  it("lets a short trip out of the app back in without a prompt", () => {
    const decision = decideForegroundLock({
      backgroundedAt: NOW - 30_000,
      now: NOW,
      thresholdMs: THRESHOLD,
    });
    assert.equal(decision, "allow");
  });

  it("asks again once the app has been away for the threshold", () => {
    const decision = decideForegroundLock({
      backgroundedAt: NOW - THRESHOLD,
      now: NOW,
      thresholdMs: THRESHOLD,
    });
    assert.equal(decision, "lock");
  });

  it("treats one millisecond under the threshold as a short trip", () => {
    const decision = decideForegroundLock({
      backgroundedAt: NOW - THRESHOLD + 1,
      now: NOW,
      thresholdMs: THRESHOLD,
    });
    assert.equal(decision, "allow");
  });

  it("locks when we never saw the app leave", () => {
    const decision = decideForegroundLock({
      backgroundedAt: null,
      now: NOW,
      thresholdMs: THRESHOLD,
    });
    assert.equal(decision, "lock");
  });

  describe("an untrustworthy clock fails shut, never open", () => {
    it("locks when the clock moved backwards", () => {
      const decision = decideForegroundLock({
        backgroundedAt: NOW + 60_000,
        now: NOW,
        thresholdMs: THRESHOLD,
      });
      assert.equal(decision, "lock");
    });

    it("locks on a reading that is not a number", () => {
      const decision = decideForegroundLock({
        backgroundedAt: Number.NaN,
        now: NOW,
        thresholdMs: THRESHOLD,
      });
      assert.equal(decision, "lock");
    });

    it("locks on an infinite reading", () => {
      const decision = decideForegroundLock({
        backgroundedAt: NOW - 30_000,
        now: Number.POSITIVE_INFINITY,
        thresholdMs: THRESHOLD,
      });
      assert.equal(decision, "lock");
    });

    it("locks rather than trusting a nonsensical threshold", () => {
      const decision = decideForegroundLock({
        backgroundedAt: NOW - 1_000,
        now: NOW,
        thresholdMs: -1,
      });
      assert.equal(decision, "lock");
    });
  });
});

describe("parseLockThresholdSeconds", () => {
  it("defaults to fifteen minutes when nothing is configured", () => {
    assert.equal(parseLockThresholdSeconds(undefined), 900_000);
    assert.equal(parseLockThresholdSeconds("   "), 900_000);
  });

  it("reads a configured value in seconds", () => {
    assert.equal(parseLockThresholdSeconds("120"), 120_000);
  });

  describe("an unusable value falls back to the default, and never throws", () => {
    // Throwing here would run at import time, before any screen exists:
    // the app would die on launch over a mistyped tuning knob. The
    // fallback is also always the safe direction - the owner's interval,
    // never a longer one.
    it("falls back on a value that is not a positive number", () => {
      assert.equal(parseLockThresholdSeconds("kétperc"), 900_000);
      assert.equal(parseLockThresholdSeconds("0"), 900_000);
      assert.equal(parseLockThresholdSeconds("-30"), 900_000);
    });

    it("falls back on a threshold longer than a day", () => {
      assert.equal(parseLockThresholdSeconds("90000"), 900_000);
    });
  });
});
