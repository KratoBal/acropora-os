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
  it("defaults to two minutes when nothing is configured", () => {
    assert.equal(parseLockThresholdSeconds(undefined), 120_000);
    assert.equal(parseLockThresholdSeconds("   "), 120_000);
  });

  it("reads a configured value in seconds", () => {
    assert.equal(parseLockThresholdSeconds("900"), 900_000);
  });

  it("refuses a value that is not a positive number", () => {
    assert.throws(() => parseLockThresholdSeconds("kétperc"), /Invalid/);
    assert.throws(() => parseLockThresholdSeconds("0"), /Invalid/);
    assert.throws(() => parseLockThresholdSeconds("-30"), /Invalid/);
  });

  it("refuses a threshold longer than a day", () => {
    assert.throws(() => parseLockThresholdSeconds("90000"), /maximum/);
  });
});
