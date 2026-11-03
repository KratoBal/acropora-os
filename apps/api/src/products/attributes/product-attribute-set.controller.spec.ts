import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { belsosUser } from "../../testing/scope-user.fixture.js";
import type { AttributeSetAdminService } from "./attribute-set-admin.service.js";
import { ProductAttributeSetController } from "./product-attribute-set.controller.js";

/*
  MI PIROSÍT (acrobot 41724): ha a vezérlő nem adná át a bejelentkezett felhasználó azonosítóját a
  kötésnek (az audit sor „ki” mezője üres vagy más volna).
*/
describe("ProductAttributeSetController.set", () => {
  it("passes the product, the set and the authenticated user's id to the service", async () => {
    const calls: unknown[][] = [];
    const admin = {
      setProductAttributeSet: async (...args: unknown[]) => {
        calls.push(args);
        return { productId: "p1", attributeSetId: "set-1", changed: true };
      },
    } as unknown as AttributeSetAdminService;
    const user = belsosUser({ id: "user-77" });
    await new ProductAttributeSetController(admin).set(
      "p1",
      { attributeSetId: "set-1" },
      user,
    );
    assert.deepEqual(calls, [["p1", "set-1", "user-77"]]);
  });
});
