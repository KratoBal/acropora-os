import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { BrandsController } from "./brands.controller.js";
import type { BrandsService } from "./brands.service.js";
import type { ProductService } from "../products/product.service.js";

describe("BrandsController options route", () => {
  it("requires products.view like every other brand read route", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        BrandsController.prototype.options,
      ),
      [PERMISSIONS.PRODUCTS_VIEW],
    );
  });

  it("delegates to ProductService.listBrandOptions instead of the :id detail lookup", async () => {
    const options = [{ id: "brand-1", label: "Red Sea" }];
    let detailCalls = 0;
    const controller = new BrandsController(
      {
        detail: async () => {
          detailCalls += 1;
          throw new Error("must not resolve 'options' as a brand id");
        },
      } as unknown as BrandsService,
      {
        listBrandOptions: async () => options,
      } as unknown as ProductService,
    );

    const response = await controller.options();

    assert.deepEqual(response, options);
    assert.equal(detailCalls, 0);
  });
});
