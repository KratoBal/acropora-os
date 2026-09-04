import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { webshopSellableFromUnas } from "./unas-product-sync.repository.js";

describe("webshopSellableFromUnas", () => {
  it("marks a listed, directly purchasable product sellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "1", inquireOnly: false }),
      true,
    );
  });

  it("keeps a listed inquiry-only product unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "1", inquireOnly: true }),
      false,
    );
  });

  it("keeps a product outside the webshop unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "0", inquireOnly: false }),
      false,
    );
  });
});
