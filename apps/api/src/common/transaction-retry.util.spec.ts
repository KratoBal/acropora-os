import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retryOnSerializationConflict } from "./transaction-retry.util.js";

class FakePrismaKnownRequestError extends Error {
  code: string;
  constructor(code: string, message = "fake prisma error") {
    super(message);
    this.code = code;
  }
}

describe("retryOnSerializationConflict", () => {
  it("returns the result immediately on first-attempt success without retrying", async () => {
    let calls = 0;
    const result = await retryOnSerializationConflict(async () => {
      calls += 1;
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  it("retries a fresh call of operation() on P2034 and succeeds once it stops conflicting", async () => {
    let calls = 0;
    const result = await retryOnSerializationConflict(async () => {
      calls += 1;
      if (calls < 3) throw new FakePrismaKnownRequestError("P2034");
      return `succeeded-on-attempt-${calls}`;
    });
    assert.equal(result, "succeeded-on-attempt-3");
    assert.equal(calls, 3);
  });

  it("rethrows immediately (no retry) for any non-P2034 error, even a real business error", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryOnSerializationConflict(async () => {
          calls += 1;
          throw new Error("A leltár nem található.");
        }),
      /A leltár nem található\./,
    );
    assert.equal(calls, 1, "must not retry a non-serialization error");
  });

  it("rethrows immediately for a P2002 (unrelated Prisma error code), no retry", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryOnSerializationConflict(async () => {
          calls += 1;
          throw new FakePrismaKnownRequestError("P2002");
        }),
      (error: unknown) =>
        error instanceof FakePrismaKnownRequestError && error.code === "P2002",
    );
    assert.equal(calls, 1);
  });

  it("gives up and rethrows the P2034 error after exhausting maxAttempts, never exceeding the cap", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryOnSerializationConflict(async () => {
          calls += 1;
          throw new FakePrismaKnownRequestError("P2034");
        }, 3),
      (error: unknown) =>
        error instanceof FakePrismaKnownRequestError && error.code === "P2034",
    );
    assert.equal(
      calls,
      3,
      "must attempt exactly maxAttempts times, no more, no fewer",
    );
  });

  it("each attempt is an independent call to operation() - no shared/leaked state assumed", async () => {
    const attemptsSeen: number[] = [];
    await retryOnSerializationConflict(async () => {
      const thisAttempt = attemptsSeen.length + 1;
      attemptsSeen.push(thisAttempt);
      if (thisAttempt < 2) throw new FakePrismaKnownRequestError("P2034");
      return "done";
    });
    assert.deepEqual(attemptsSeen, [1, 2]);
  });
});
