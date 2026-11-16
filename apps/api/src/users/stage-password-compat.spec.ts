import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashStagePassword,
  verifyStagePassword,
} from "@acropora/database/stage-anonymization";
import { hashPassword, verifyPassword } from "./password.util.js";

/**
 * THE STAGE PASSWORD HASH AND THE APPLICATION'S CHECK MUST AGREE (stage anonymization chain, task stage-anonim-proba). The stage
 * helper in the database package cannot import `password.util.ts`, so it writes the scheme out again (`<salt hex>:<scrypt hex>`,
 * a 64 byte key). If the application's scheme ever changes (a different cost, another algorithm), the stage password would stop
 * working after the anonymization and nobody could log in to the trial or the stage: this spec turns red first, in both directions.
 */
describe("the stage password hash and the application's password check", () => {
  it("the application accepts the hash the stage helper makes, and refuses another password", async () => {
    const stored = await hashStagePassword("stage-jelszo-kompat-1");
    assert.equal(await verifyPassword("stage-jelszo-kompat-1", stored), true);
    assert.equal(await verifyPassword("stage-jelszo-kompat-2", stored), false);
  });

  it("the stage helper accepts the hash the application makes", async () => {
    const stored = await hashPassword("alkalmazas-jelszo-kompat-1");
    assert.equal(
      await verifyStagePassword("alkalmazas-jelszo-kompat-1", stored),
      true,
    );
    assert.equal(
      await verifyStagePassword("alkalmazas-jelszo-kompat-2", stored),
      false,
    );
  });
});
