import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applicationHealth } from "./app.service.js";

/**
 * AMIT EZ A FAJL ORIZ.
 *
 * A `/health` valasza eddig egy kezzel irt verziot adott (`0.1.0`), ami minden
 * kiadasnal ugyanaz. Arra a kerdesre, hogy MELYIK kod fut a szerveren, egyetlen
 * jel volt: az `uptime` -- az viszont csak azt mondja meg, MIKOR indult a
 * folyamat, nem azt, MIT inditottak el. Egy ujraindítas es egy telepites
 * kivulrol ugyanugy nez ki.
 */

async function withCommitSha(value: string | undefined, run: () => void) {
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

const SHA = "38ea01000ecb320e852c53ee13c0206f2658f919";

describe("applicationHealth", () => {
  it("reports the commit the image was built from", async () => {
    await withCommitSha(SHA, () => {
      assert.equal(applicationHealth().commit, SHA);
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

    await withCommitSha(SHA, () => {
      first = applicationHealth();
    });
    await withCommitSha(other, () => {
      second = applicationHealth();
    });

    assert.equal(first!.version, second!.version);
    assert.notEqual(first!.commit, second!.commit);
  });

  it("says null rather than guessing when nothing was baked in", async () => {
    await withCommitSha(undefined, () => {
      assert.equal(applicationHealth().commit, null);
    });
  });

  /**
   * A ROSSZ FORMA UGYANUGY `null`, MINT A HIANY. Egy fel-azonosito vagy egy
   * helykitolto szoveg olyan valaszt adna, ami TOBBET allit, mint amennyit tud:
   * ugy nezne ki, mint egy kiadas-azonosito, csak nem az.
   */
  it("treats a malformed value as absent, not as evidence", async () => {
    for (const bad of ["not-a-sha", "38ea0100", "UNKNOWN", SHA.toUpperCase()]) {
      await withCommitSha(bad, () => {
        assert.equal(applicationHealth().commit, null, bad);
      });
    }
  });

  it("keeps the status field it always had", async () => {
    await withCommitSha(SHA, () => {
      const application = applicationHealth();

      assert.equal(application.status, "ok");
      assert.equal(application.version, "0.1.0");
    });
  });
});
