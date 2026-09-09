import { describe, expect, it } from "vitest";

import {
  currentReleaseCommitSha,
  releaseCommitSourceState,
  releaseCommitSources,
} from "./release-info";

const SHA = "38ea01000ecb320e852c53ee13c0206f2658f919";
const OTHER_SHA = "0000000000000000000000000000000000000001";

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
    if (beforeImage === undefined) delete process.env.RELEASE_IMAGE_COMMIT_SHA;
    else process.env.RELEASE_IMAGE_COMMIT_SHA = beforeImage;
    if (beforeRuntime === undefined) delete process.env.RELEASE_COMMIT_SHA;
    else process.env.RELEASE_COMMIT_SHA = beforeRuntime;
  }
}

describe("web release commit sources", () => {
  it("returns the well-formed runtime SHA and trims it", () => {
    withSources(undefined, ` ${SHA} `, () => {
      expect(currentReleaseCommitSha()).toBe(SHA);
    });
  });

  it("treats unset, empty, placeholders and malformed SHAs alike as missing", () => {
    for (const value of [
      undefined,
      "",
      "   ",
      "CHANGEME",
      "38ea0100",
      SHA.toUpperCase(),
    ]) {
      withSources(value, value, () => {
        expect(releaseCommitSources()).toMatchObject({
          imageCommit: null,
          runtimeCommit: null,
          commitSourceState: "both-missing",
        });
      });
    }
  });

  it("keeps the baked image source separate from the running process source", () => {
    withSources(SHA, OTHER_SHA, () => {
      expect(releaseCommitSources()).toMatchObject({
        imageCommit: SHA,
        runtimeCommit: OTHER_SHA,
      });
    });
  });
});

describe("releaseCommitSourceState", () => {
  it("calls only two valid but different commits a mismatch", () => {
    expect(releaseCommitSourceState(SHA, OTHER_SHA)).toBe("mismatch");
  });

  it("expresses missing evidence as non-verifiability, not disagreement", () => {
    expect(releaseCommitSourceState(null, SHA)).toBe("image-missing");
    expect(releaseCommitSourceState(SHA, null)).toBe("runtime-missing");
    expect(releaseCommitSourceState(null, null)).toBe("both-missing");
  });
});

/*
 * Kalibráció (a teljes webteszt futásszáma a leadási jegyzetben):
 * 1. A commit-regex nagybetűt is engedő rontása pontosan a második teszt
 *    malformed-SHA állítását döntötte pirosra.
 * 2. A két érvényes, eltérő SHA `match`-re rontása pontosan a negyedik teszt
 *    állítását döntötte pirosra.
 * 3. A hiányzó image állapotát `mismatch`-re rontva pontosan az ötödik teszt
 *    image-missing állítása lett piros.
 * 4. A `timestamp` óraformátumának módosítása NULLA pirosat adott: ez szándékos
 *    lelet. A végpont kiadásazonossága védett, a diagnosztikai időbélyeg pontos
 *    alakja ma nincs szerződésként rögzítve.
 */
