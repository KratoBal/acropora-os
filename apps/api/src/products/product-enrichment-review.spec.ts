import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import type {
  EnrichmentReader,
  LatestCheck,
  QueueRowRecord,
} from "./enrichment/enrichment-read.repository.js";
import { ProductEnrichmentQueueController } from "./product-enrichment-queue.controller.js";
import { ProductEnrichmentReviewController } from "./product-enrichment-review.controller.js";
import {
  ProductEnrichmentReviewService,
  QUEUE_PAGE_SIZE,
  productEnrichmentAvailability,
} from "./product-enrichment-review.service.js";
import type { ProductService } from "./product.service.js";

const PILOT = { id: "pilot-1" };
const OTHER = { id: "masik-kollega" };
const ON = {
  JEV_PRODUCT_ENRICHMENT: "review",
  JEV_PILOT_USER_IDS: " pilot-1 , pilot-2",
};

/** Invented values only. */
const CHECK: LatestCheck = {
  checkedAt: new Date("2026-10-02T21:00:00.000Z"),
  sourceCount: 2,
  fieldCount: 1,
  fields: [
    {
      field: "flowRate",
      tier: "C",
      status: "VERIFIED",
      value: "3000 l/h",
      sourceType: "MANUFACTURER_PAGE",
      sourceRef: "https://gyarto.example.invalid/p/1",
      retrievedAt: new Date("2026-10-02T21:00:05.000Z"),
      confidence: null,
      currentValue: null,
      evidence: [
        {
          sourceType: "MANUFACTURER_PAGE",
          sourceKind: "MANUFACTURER",
          sourceRef: "https://gyarto.example.invalid/p/1",
          retrievedAt: "2026-10-02T21:00:05.000Z",
          raw: "3 m3/h",
          excerpt: "ld+json Product.additionalProperty",
          accepted: true,
        },
        {
          sourceType: "SUPPLIER_PAGE",
          sourceKind: "BULK_REEF_SUPPLY",
          sourceRef: "https://www.bulkreefsupply.com/x",
          retrievedAt: "2026-10-02T21:00:10.000Z",
          raw: "max 3000",
          excerpt: "x",
          accepted: false,
        },
      ],
    },
  ],
};

function reader(over: Partial<EnrichmentReader> = {}) {
  const calls: string[] = [];
  const value: EnrichmentReader = {
    latestCheck: async (id) => {
      calls.push(`latestCheck:${id}`);
      return null;
    },
    latestCheckIds: async () => {
      calls.push("latestCheckIds");
      return [];
    },
    queueCounts: async () => [],
    queueRows: async () => [],
    ...over,
  };
  return { value, calls };
}

function service(env: NodeJS.ProcessEnv, read = reader(), exists = true) {
  const products = {
    getProduct: async (id: string) => {
      if (!exists) throw new NotFoundException("A termék nem található.");
      return { id };
    },
  } as unknown as ProductService;
  return new ProductEnrichmentReviewService(products, read.value, env);
}

describe("JEV termékadat-ellenőrzés, csak olvasás", () => {
  it("a kapcsoló: csak a négy kimondott érték, minden más off", () => {
    assert.equal(productEnrichmentAvailability(undefined), "off");
    assert.equal(productEnrichmentAvailability("live"), "off");
    assert.equal(productEnrichmentAvailability("REVIEW"), "off");
    assert.equal(productEnrichmentAvailability(" review "), "review");
    assert.equal(
      productEnrichmentAvailability("production-review"),
      "production-review",
    );
  });

  it("kapcsoló nélkül nem elérhető, és a tárolt futást meg sem nézi", async () => {
    const read = reader();
    assert.deepEqual(await service({}, read).review("p-1", PILOT), {
      availability: "off",
      lastRun: null,
      fields: [],
    });
    assert.deepEqual(read.calls, []);
  });

  // PD-013: a próba-listán kívüli felhasználó review módban is "off"-ot kap
  it("review módban a próba-listán kívüli kolléga nem elérhetőt kap, adat nélkül", async () => {
    const read = reader({ latestCheck: async () => CHECK });
    const review = await service(ON, read).review("p-1", OTHER);
    assert.deepEqual(review, {
      availability: "off",
      lastRun: null,
      fields: [],
    });
  });

  it("üres próba-lista mellett review módban senki nem látja", async () => {
    const review = await service({ JEV_PRODUCT_ENRICHMENT: "review" }).review(
      "p-1",
      PILOT,
    );
    assert.equal(review.availability, "off");
  });

  it("production-review módban a lista nem szűkít", async () => {
    const review = await service({
      JEV_PRODUCT_ENRICHMENT: "production-review",
    }).review("p-1", OTHER);
    assert.equal(review.availability, "production-review");
  });

  it("a próba-lista tagja tárolt futás nélkül: soha nem ellenőrzött", async () => {
    const review = await service(ON).review("p-1", PILOT);
    assert.equal(review.availability, "review");
    assert.equal(review.lastRun, null);
    assert.deepEqual(review.fields, []);
  });

  it("a legutóbbi tárolt futásból: forrás, URL, idő, bizonyíték, normalizált érték", async () => {
    const review = await service(
      ON,
      reader({ latestCheck: async () => CHECK }),
    ).review("p-1", PILOT);
    assert.deepEqual(review.lastRun, {
      at: "2026-10-02T21:00:00.000Z",
      sourceCount: 2,
      fieldCount: 1,
    });
    const field = review.fields[0]!;
    assert.equal(field.status, "VERIFIED");
    assert.deepEqual(field.value, {
      kind: "quantity",
      amount: "3000",
      unit: "l/h",
    });
    assert.equal(field.sourceRef, "https://gyarto.example.invalid/p/1");
    assert.equal(field.retrievedAt, "2026-10-02T21:00:05.000Z");
    // only accepted evidence is shown; the raw "3 m3/h" is shown normalised
    assert.deepEqual(field.evidence, [
      {
        sourceType: "MANUFACTURER_PAGE",
        value: { kind: "quantity", amount: "3000", unit: "l/h" },
        sourceRef: "https://gyarto.example.invalid/p/1",
        retrievedAt: "2026-10-02T21:00:05.000Z",
      },
    ]);
  });

  it("ismeretlen termékre 404, nem egy üres ellenőrzés", async () => {
    await assert.rejects(
      () => service(ON, reader(), false).review("nincs", PILOT),
      NotFoundException,
    );
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

describe("a katalógus-sor (GET /products/enrichment/queue)", () => {
  const row = (n: number): QueueRowRecord => ({
    id: `r-${String(n).padStart(3, "0")}`,
    field: "ean",
    tier: "C",
    status: "CONFLICTING_SOURCES",
    productId: `p-${n}`,
    productName: `Kitalált termék ${n}`,
    checkedAt: new Date("2026-10-02T21:00:00.000Z"),
  });

  it("a próba-listán kívül nem elérhető, és semmit nem olvas", async () => {
    const read = reader();
    const page = await service(ON, read).queue(OTHER, "all", null);
    assert.equal(page.availability, "off");
    assert.deepEqual(page.rows, []);
    assert.deepEqual(read.calls, []);
  });

  it("lapoz, a szűrőt továbbadja, és a szerver számolja az összesítőt", async () => {
    const asked: unknown[] = [];
    const read = reader({
      latestCheckIds: async () => ["c-1", "c-2"],
      queueCounts: async () => [
        { status: "CONFLICTING_SOURCES", tier: "C", count: 3 },
        { status: "VERIFIED", tier: "C", count: 4 },
        { status: "SUGGESTED", tier: "C", count: 1 },
      ],
      queueRows: async (ids, filter, after, take) => {
        asked.push({ ids, filter, after, take });
        return Array.from({ length: take }, (_, i) => row(i));
      },
    });
    const page = await service(ON, read).queue(PILOT, "critical", "r-000");
    assert.deepEqual(asked, [
      {
        ids: ["c-1", "c-2"],
        filter: "critical",
        after: "r-000",
        take: QUEUE_PAGE_SIZE + 1,
      },
    ]);
    assert.equal(page.rows.length, QUEUE_PAGE_SIZE);
    assert.equal(
      page.nextCursor,
      `r-${String(QUEUE_PAGE_SIZE - 1).padStart(3, "0")}`,
    );
    assert.equal(page.checkedProducts, 2);
    assert.deepEqual(page.summary, {
      all: 8,
      critical: 3,
      conflict: 3,
      missing: 1,
      suggestion: 0,
      verified: 4,
    });
  });

  it("az útvonal products.view joggal áll, GET, és nincs más útvonala", () => {
    const handler = ProductEnrichmentQueueController.prototype.queue;
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [
      PERMISSIONS.PRODUCTS_VIEW,
    ]);
    assert.equal(Reflect.getMetadata("path", handler), "enrichment/queue");
    assert.equal(Reflect.getMetadata("method", handler), 0);
    const routes = Object.getOwnPropertyNames(
      ProductEnrichmentQueueController.prototype,
    ).filter((name) => name !== "constructor");
    assert.deepEqual(routes, ["queue"]);
  });
});
