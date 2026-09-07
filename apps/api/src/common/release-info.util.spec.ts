import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentReleaseCommitSha,
  releaseCommitSourceState,
  releaseCommitSources,
} from "./release-info.util.js";

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

describe("releaseCommitSources", () => {
  const sha = "38ea01000ecb320e852c53ee13c0206f2658f919";
  const other = "0000000000000000000000000000000000000001";
  function withSources(
    image: string | undefined,
    runtime: string | undefined,
    run: () => void,
  ) {
    const beforeImage = process.env.RELEASE_IMAGE_COMMIT_SHA;
    const beforeRuntime = process.env.RELEASE_COMMIT_SHA;
    if (image === undefined) delete process.env.RELEASE_IMAGE_COMMIT_SHA;
    else process.env.RELEASE_IMAGE_COMMIT_SHA = image;
    if (runtime === undefined) delete process.env.RELEASE_COMMIT_SHA;
    else process.env.RELEASE_COMMIT_SHA = runtime;
    try {
      run();
    } finally {
      if (beforeImage === undefined)
        delete process.env.RELEASE_IMAGE_COMMIT_SHA;
      else process.env.RELEASE_IMAGE_COMMIT_SHA = beforeImage;
      if (beforeRuntime === undefined) delete process.env.RELEASE_COMMIT_SHA;
      else process.env.RELEASE_COMMIT_SHA = beforeRuntime;
    }
  }
  it("a beégetett oldal saját környezeti változóját olvassa", () => {
    withSources(sha, other, () =>
      assert.equal(releaseCommitSources().imageCommit, sha),
    );
  });
  it("a futásidejű oldal saját környezeti változóját olvassa", () => {
    withSources(other, sha, () =>
      assert.equal(releaseCommitSources().runtimeCommit, sha),
    );
  });
});

describe("releaseCommitSourceState", () => {
  const sha = "38ea01000ecb320e852c53ee13c0206f2658f919";
  const other = "0000000000000000000000000000000000000001";
  it("az egyezést és eltérést különbözteti meg", () => {
    assert.equal(releaseCommitSourceState(sha, sha), "match");
    assert.equal(releaseCommitSourceState(sha, other), "mismatch");
  });
  it("a hiányzó képoldalt különbözteti meg", () => {
    assert.equal(releaseCommitSourceState(null, sha), "image-missing");
  });
  it("a hiányzó futásidejű és mindkét oldalt különbözteti meg", () => {
    assert.equal(releaseCommitSourceState(sha, null), "runtime-missing");
    assert.equal(releaseCommitSourceState(null, null), "both-missing");
  });
});
