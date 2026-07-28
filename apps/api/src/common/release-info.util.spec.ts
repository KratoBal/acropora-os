import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currentReleaseCommitSha } from "./release-info.util.js";

async function withEnv(value: string | undefined, run: () => void) {
  const original = process.env.RELEASE_COMMIT_SHA;
  if (value === undefined) delete process.env.RELEASE_COMMIT_SHA;
  else process.env.RELEASE_COMMIT_SHA = value;
  try {
    run();
  } finally {
    if (original === undefined) delete process.env.RELEASE_COMMIT_SHA;
    else process.env.RELEASE_COMMIT_SHA = original;
  }
}

describe("currentReleaseCommitSha", () => {
  it("returns null when RELEASE_COMMIT_SHA is unset", async () => {
    await withEnv(undefined, () => {
      assert.equal(currentReleaseCommitSha(), null);
    });
  });

  it("returns null when RELEASE_COMMIT_SHA is empty/whitespace-only", async () => {
    await withEnv("   ", () => {
      assert.equal(currentReleaseCommitSha(), null);
    });
  });

  it("returns the value for a well-formed 40-char lowercase hex commit SHA", async () => {
    const sha = "38ea01000ecb320e852c53ee13c0206f2658f919";
    await withEnv(sha, () => {
      assert.equal(currentReleaseCommitSha(), sha);
    });
  });

  it("trims surrounding whitespace on an otherwise well-formed SHA", async () => {
    const sha = "38ea01000ecb320e852c53ee13c0206f2658f919";
    await withEnv(`  ${sha}  `, () => {
      assert.equal(currentReleaseCommitSha(), sha);
    });
  });

  // Checkpoint 8: "malformed values must be rejected" - a malformed value
  // is treated identically to "unset" (null), never as a distinct error
  // state a caller might mistake for more trustworthy than NOT_CONFIGURED.
  it("returns null for a too-short (abbreviated) SHA", async () => {
    await withEnv("38ea010", () => {
      assert.equal(currentReleaseCommitSha(), null);
    });
  });

  it("returns null for a value containing uppercase hex characters", async () => {
    await withEnv("38EA01000ECB320E852C53EE13C0206F2658F919", () => {
      assert.equal(currentReleaseCommitSha(), null);
    });
  });

  it("returns null for an obviously-fake placeholder value", async () => {
    await withEnv("CHANGEME", () => {
      assert.equal(currentReleaseCommitSha(), null);
    });
  });

  it("returns null for a 40-character value containing non-hex characters", async () => {
    await withEnv("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", () => {
      assert.equal(currentReleaseCommitSha(), null);
    });
  });
});
