import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hashStagePassword,
  MIN_STAGE_PASSWORD_LENGTH,
  verifyStagePassword,
} from "./stage-password.js";

/*
  THE STAGE PASSWORD HASH. WHAT TURNS THIS RED: a hash in a shape the application would not read (`<salt hex>:<scrypt hex>`); a wrong
  password accepted; two hashes of one password that are the same (no salt); a short password accepted. The application's own
  `verifyPassword` accepting this hash is tested in the API package (apps/api/src/users/stage-password-compat.spec.ts).
*/
describe("hashStagePassword", () => {
  it("makes <16 byte salt hex>:<64 byte scrypt hex>, verifies its own password and refuses another", async () => {
    const hash = await hashStagePassword("egy-hosszu-stage-jelszo");
    assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.equal(
      await verifyStagePassword("egy-hosszu-stage-jelszo", hash),
      true,
    );
    assert.equal(await verifyStagePassword("egy-masik-jelszo-xx", hash), false);
    assert.equal(
      await verifyStagePassword("egy-hosszu-stage-jelszo", "nincs-kettospont"),
      false,
    );
    assert.equal(
      await verifyStagePassword("egy-hosszu-stage-jelszo", "ab:cd"),
      false,
    );
  });

  it("salts: the same password gives two different hashes, and both verify", async () => {
    const a = await hashStagePassword("ugyanaz-a-jelszo-1");
    const b = await hashStagePassword("ugyanaz-a-jelszo-1");
    assert.notEqual(a, b);
    assert.equal(await verifyStagePassword("ugyanaz-a-jelszo-1", b), true);
  });

  it("refuses a password shorter than the minimum, and says the number, never the password", async () => {
    const short = "x".repeat(MIN_STAGE_PASSWORD_LENGTH - 1);
    await assert.rejects(
      hashStagePassword(short),
      (error: Error) =>
        error.message.includes(String(MIN_STAGE_PASSWORD_LENGTH)) &&
        !error.message.includes(short),
    );
    await hashStagePassword("x".repeat(MIN_STAGE_PASSWORD_LENGTH));
  });
});
