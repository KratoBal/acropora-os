import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPassword, verifyPassword } from "./password.util.js";

describe("password hashing (scrypt)", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(
      await verifyPassword("correct horse battery staple", stored),
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("wrong password", stored), false);
  });

  it("salts each hash uniquely, even for the same password", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");
    assert.notEqual(first, second);
    assert.equal(await verifyPassword("same-password", first), true);
    assert.equal(await verifyPassword("same-password", second), true);
  });

  it("fails closed for malformed stored values", async () => {
    assert.equal(await verifyPassword("anything", ""), false);
    assert.equal(await verifyPassword("anything", "no-separator"), false);
  });
});
