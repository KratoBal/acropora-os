import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applicationHealth, doseProjectionHealth } from "./app.service.js";

/**
 * AMIT EZ A FAJL ORIZ.
 *
 * A `/health` valasza eddig egy kezzel irt verziot adott (`0.1.0`), ami minden
 * kiadasnal ugyanaz. Arra a kerdesre, hogy MELYIK kod fut a szerveren, egyetlen
 * jel volt: az `uptime` -- az viszont csak azt mondja meg, MIKOR indult a
 * folyamat, nem azt, MIT inditottak el. Egy ujraindítas es egy telepites
 * kivulrol ugyanugy nez ki.
 */

async function withCommitShas(
  image: string | undefined,
  runtime: string | undefined,
  run: () => void,
) {
  const originalImage = process.env.RELEASE_IMAGE_COMMIT_SHA;
  const originalRuntime = process.env.RELEASE_COMMIT_SHA;
  if (image === undefined) delete process.env.RELEASE_IMAGE_COMMIT_SHA;
  else process.env.RELEASE_IMAGE_COMMIT_SHA = image;
  if (runtime === undefined) delete process.env.RELEASE_COMMIT_SHA;
  else process.env.RELEASE_COMMIT_SHA = runtime;
  try {
    run();
  } finally {
    if (originalImage === undefined)
      delete process.env.RELEASE_IMAGE_COMMIT_SHA;
    else process.env.RELEASE_IMAGE_COMMIT_SHA = originalImage;
    if (originalRuntime === undefined) delete process.env.RELEASE_COMMIT_SHA;
    else process.env.RELEASE_COMMIT_SHA = originalRuntime;
  }
}

const SHA = "38ea01000ecb320e852c53ee13c0206f2658f919";

describe("applicationHealth", () => {
  it("reports absent image and runtime commits separately", async () => {
    await withCommitShas(undefined, undefined, () => {
      const application = applicationHealth();
      assert.equal(application.imageCommit, null);
      assert.equal(application.runtimeCommit, null);
      assert.equal(application.commitSourceState, "both-missing");
    });
  });

  /**
   * EZ AZ ALLITAS A LENYEG. A verzio KET KULONBOZO kiadason is azonos marad, a
   * commit viszont nem -- vagyis a valaszban van egy mezo, ami tenyleg
   * megkulonbozteti a kiadasokat, es egy, ami sosem fog.
   */
  it("distinguishes two releases that call themselves the same version", async () => {
    const other = "0000000000000000000000000000000000000001";
    let first: ReturnType<typeof applicationHealth> | null = null;
    let second: ReturnType<typeof applicationHealth> | null = null;

    await withCommitShas(SHA, SHA, () => {
      first = applicationHealth();
    });
    await withCommitShas(other, other, () => {
      second = applicationHealth();
    });

    assert.equal(first!.version, second!.version);
    assert.notEqual(first!.commit, second!.commit);
  });

  it("says null rather than guessing when nothing was baked in", async () => {
    await withCommitShas(undefined, undefined, () => {
      const application = applicationHealth();
      assert.equal(application.imageCommit, null);
      assert.equal(application.runtimeCommit, null);
      assert.equal(application.commitSourceState, "both-missing");
    });
  });

  /**
   * A ROSSZ FORMA UGYANUGY `null`, MINT A HIANY. Egy fel-azonosito vagy egy
   * helykitolto szoveg olyan valaszt adna, ami TOBBET allit, mint amennyit tud:
   * ugy nezne ki, mint egy kiadas-azonosito, csak nem az.
   */
  it("treats a malformed value as absent, not as evidence", async () => {
    for (const bad of ["not-a-sha", "38ea0100", "UNKNOWN", SHA.toUpperCase()]) {
      await withCommitShas(bad, bad, () => {
        const application = applicationHealth();
        assert.equal(application.imageCommit, null, bad);
        assert.equal(application.runtimeCommit, null, bad);
      });
    }
  });

  it("keeps the status field it always had", async () => {
    await withCommitShas(SHA, SHA, () => {
      const application = applicationHealth();

      assert.equal(application.status, "ok");
      assert.equal(application.version, "0.1.0");
    });
  });
});

/**
 * THE DOSE-LIST PROJECTION ON /health (card 2f0d7acd): read by the fleet without a login, so only
 * numbers and flags, and a failed read never throws (a 503 would make the container restart).
 */
describe("doseProjectionHealth", () => {
  it("passes the four numbers and flags, never the failure's text or times", async () => {
    const health = await doseProjectionHealth(async () => ({
      stale: true,
      maxAgeHours: 26,
      ageHours: 30.5,
      rowCount: 12,
      lastSuccess: {
        trigger: "SCHEDULED",
        startedAt: "2026-10-20T00:00:00.000Z",
        finishedAt: "2026-10-20T00:00:01.000Z",
        rowCount: 12,
      },
      lastFailure: {
        trigger: "EDIT",
        finishedAt: "2026-10-21T00:00:00.000Z",
        errorMessage: "titkos belső hiba a 10.0.0.5 gépen",
      },
      failingSinceLastSuccess: true,
    }));
    assert.deepEqual(health, {
      stale: true,
      ageHours: 30.5,
      rowCount: 12,
      failingSinceLastSuccess: true,
    });
  });

  it("a read that throws is null, not an exception", async () => {
    const health = await doseProjectionHealth(async () => {
      throw new Error("relation does not exist");
    });
    assert.equal(health, null);
  });
});
