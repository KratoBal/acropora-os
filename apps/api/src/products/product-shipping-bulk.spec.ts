import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { ProductShippingProfileService } from "./product-shipping-profile.service.js";

/*
  A TÖMEGES SZERKESZTÉS SZABÁLYA (a82ed229, 2c). MI PIROSÍT: ha egy nem megadott jelzőt is átír; ha egy nem létező
  termék megállítja a többit; ha jelző nélküli kérés ír; ha egy kétszer kijelölt termék kétszer íródik.
*/
function fake() {
  const writes: { productId: string; input: Record<string, unknown> }[] = [];
  const repository = {
    productExists: async (id: string) => id !== "missing",
    patch: async (productId: string, input: Record<string, unknown>) => {
      writes.push({ productId, input });
      return {};
    },
  };
  return {
    service: new ProductShippingProfileService(repository as never),
    writes,
  };
}

describe("a tömeges szerkesztés", () => {
  it("csak a megadott jelzőt adja tovább; a többit a tranzakción belül az írás veszi a termékről", async () => {
    const { service, writes } = fake();
    const result = await service.bulk(
      ["p1", "p2"],
      { lockerUnsuitable: true },
      "user-1",
    );
    assert.deepEqual(result, { updated: 2, notFound: [] });
    assert.deepEqual(writes[0]!.input, { lockerUnsuitable: true });
  });

  it("a nem létező termék nem állítja meg a többit, és a kétszer kijelölt egyszer íródik", async () => {
    const { service, writes } = fake();
    const result = await service.bulk(
      ["p1", "missing", "p1", "p2"],
      { isHeavy: false },
      "user-1",
    );
    assert.deepEqual(result, { updated: 2, notFound: ["missing"] });
    assert.deepEqual(
      writes.map((w) => w.productId),
      ["p1", "p2"],
    );
  });

  it("jelző nélkül nem ír", async () => {
    const { service, writes } = fake();
    await assert.rejects(
      () => service.bulk(["p1"], {}, "user-1"),
      BadRequestException,
    );
    assert.equal(writes.length, 0);
  });
});
