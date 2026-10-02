import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { ProductEnrichmentReviewController } from "./product-enrichment-review.controller.js";
import {
  ProductEnrichmentReviewService,
  productEnrichmentAvailability,
} from "./product-enrichment-review.service.js";
import type { ProductService } from "./product.service.js";

function service(env: NodeJS.ProcessEnv, exists = true) {
  const asked: string[] = [];
  const products = {
    getProduct: async (id: string) => {
      asked.push(id);
      if (!exists) throw new NotFoundException("A termék nem található.");
      return { id };
    },
  } as unknown as ProductService;
  return { reviews: new ProductEnrichmentReviewService(products, env), asked };
}

describe("JEV termékadat-ellenőrzés, csak olvasás", () => {
  it("a kapcsoló: csak a négy kimondott érték, minden más off", () => {
    assert.equal(productEnrichmentAvailability(undefined), "off");
    assert.equal(productEnrichmentAvailability(""), "off");
    assert.equal(productEnrichmentAvailability("off"), "off");
    assert.equal(productEnrichmentAvailability("live"), "off");
    assert.equal(productEnrichmentAvailability("REVIEW"), "off");
    assert.equal(productEnrichmentAvailability(" review "), "review");
    assert.equal(productEnrichmentAvailability("benchmark"), "benchmark");
    assert.equal(
      productEnrichmentAvailability("production-review"),
      "production-review",
    );
  });

  it("kapcsoló nélkül nem elérhető, és nincs futás, nincs mező", async () => {
    const { reviews, asked } = service({});
    assert.deepEqual(await reviews.review("p-1"), {
      availability: "off",
      lastRun: null,
      fields: [],
    });
    assert.deepEqual(asked, ["p-1"]);
  });

  it("bekapcsolva sem talál ki futást: soha nem ellenőrzött", async () => {
    const { reviews } = service({ JEV_PRODUCT_ENRICHMENT: "review" });
    const review = await reviews.review("p-1");
    assert.equal(review.availability, "review");
    assert.equal(review.lastRun, null);
    assert.deepEqual(review.fields, []);
  });

  it("ismeretlen termékre 404, nem egy üres ellenőrzés", async () => {
    const { reviews } = service({ JEV_PRODUCT_ENRICHMENT: "review" }, false);
    await assert.rejects(() => reviews.review("nincs"), NotFoundException);
  });

  it("az útvonal products.view joggal áll, és csak olvas", () => {
    const handler = ProductEnrichmentReviewController.prototype.review;
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [
      PERMISSIONS.PRODUCTS_VIEW,
    ]);
    assert.equal(Reflect.getMetadata("path", handler), ":id/enrichment");
    assert.equal(Reflect.getMetadata("method", handler), 0); // RequestMethod.GET
    const routes = Object.getOwnPropertyNames(
      ProductEnrichmentReviewController.prototype,
    ).filter((name) => name !== "constructor");
    assert.deepEqual(routes, ["review"], "no write route on this controller");
  });
});
