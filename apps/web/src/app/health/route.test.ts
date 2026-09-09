import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const SHA = "38ea01000ecb320e852c53ee13c0206f2658f919";
const beforeImage = process.env.RELEASE_IMAGE_COMMIT_SHA;
const beforeRuntime = process.env.RELEASE_COMMIT_SHA;

afterEach(() => {
  if (beforeImage === undefined) delete process.env.RELEASE_IMAGE_COMMIT_SHA;
  else process.env.RELEASE_IMAGE_COMMIT_SHA = beforeImage;
  if (beforeRuntime === undefined) delete process.env.RELEASE_COMMIT_SHA;
  else process.env.RELEASE_COMMIT_SHA = beforeRuntime;
});

describe("GET /health", () => {
  it("returns the release sources under application without inventing a commit", async () => {
    process.env.RELEASE_IMAGE_COMMIT_SHA = SHA;
    process.env.RELEASE_COMMIT_SHA = "CHANGEME";

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      application: {
        status: "ok",
        imageCommit: SHA,
        runtimeCommit: null,
        commitSourceState: "runtime-missing",
      },
    });
  });
});
