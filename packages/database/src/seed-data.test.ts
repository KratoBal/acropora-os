import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seedCategories, seedManufacturers, seedUsers } from "./seed-data.js";

describe("development seed smoke test", () => {
  it("contains the required users", () => {
    assert.deepEqual(seedUsers.map((user) => user.email).sort(), [
      "admin@acropora.local",
      "owner@acropora.local",
      "service@acropora.local",
      "warehouse@acropora.local",
    ]);
  });

  it("contains five unique categories and manufacturers", () => {
    assert.equal(seedCategories.length, 5);
    assert.equal(seedManufacturers.length, 5);
    assert.equal(new Set(seedCategories.map((item) => item.slug)).size, 5);
    assert.equal(new Set(seedManufacturers.map((item) => item.slug)).size, 5);
  });
});
