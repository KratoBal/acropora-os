import "reflect-metadata";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  RUN_LIST_LIMITS,
  runListLimit,
  toRunView,
  type EnrichmentRunsReader,
} from "./enrichment/enrichment-runs.read.js";
import { ProductEnrichmentRunsController } from "./product-enrichment-runs.controller.js";

/*
  THE LATEST JEV RUNS, READ ONLY (Product Knowledge, card 85c38ab1; acrobot 50407, 50416): the Coolify task that runs the CLI
  on the test API keeps no output, so the stored run is read here. WHAT TURNS THIS RED: the route without products.view or
  not a GET; a limit that is not clamped (a whole catalogue's runs in one answer); a fetch's outcome, reason or HTTP code
  left out of the view (the refused source and the AI guard's reason would have no reader again); a missing product name
  that throws instead of reading empty.
*/
describe("a JEV-futások olvasója (GET /products/enrichment/runs)", () => {
  it("products.view joggal álló GET, egyetlen útvonal", () => {
    const handler = ProductEnrichmentRunsController.prototype.list;
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [
      PERMISSIONS.PRODUCTS_VIEW,
    ]);
    assert.equal(Reflect.getMetadata("path", handler), "enrichment/runs");
    assert.equal(Reflect.getMetadata("method", handler), 0);
    assert.deepEqual(
      Object.getOwnPropertyNames(
        ProductEnrichmentRunsController.prototype,
      ).filter((n) => n !== "constructor"),
      ["list"],
    );
  });

  it("a ?limit= 1 és a felső határ közé esik, minden más az alapérték", async () => {
    assert.equal(runListLimit(undefined), RUN_LIST_LIMITS.default);
    assert.equal(runListLimit("3"), 3);
    assert.equal(runListLimit("999"), RUN_LIST_LIMITS.max);
    for (const bad of ["0", "-1", "2.5", "abc", "", "1e3"])
      assert.equal(runListLimit(bad), RUN_LIST_LIMITS.default, bad);
    const asked: number[] = [];
    const reader: EnrichmentRunsReader = {
      recentRuns: async (n) => (asked.push(n), []),
    };
    await new ProductEnrichmentRunsController(reader).list("999");
    assert.deepEqual(asked, [RUN_LIST_LIMITS.max]);
  });

  it("a nézet a letöltéseket okkal és HTTP-kóddal adja, a dátumokat ISO-szövegként, név nélküli termékre üres nevet", () => {
    const view = toRunView({
      id: "run-1",
      status: "COMPLETED",
      startedAt: new Date("2026-11-13T22:00:00Z"),
      completedAt: null,
      productLimit: 10,
      requestLimit: 40,
      productCount: 1,
      requestCount: 2,
      errorCode: null,
      products: [
        {
          productId: "p-1",
          product: null,
          checkedAt: new Date("2026-11-13T22:00:05Z"),
          sourceCount: 2,
          fieldCount: 1,
          errorCode: null,
          fetches: [
            {
              sourceKind: "MANUFACTURER",
              url: "https://x.example/a",
              outcome: "REFUSED",
              reason: "NO_MANUFACTURER_SITE",
              httpStatus: null,
              fieldCount: 0,
            },
            {
              sourceKind: "MANUFACTURER",
              url: "https://x.example/b",
              outcome: "FETCHED",
              reason: "AI: EXCERPT_NOT_IN_PAGE",
              httpStatus: 200,
              fieldCount: 1,
            },
          ],
          fields: [
            {
              field: "dosing",
              status: "MISSING",
              value: null,
              sourceType: null,
            },
          ],
        },
      ],
    });
    assert.equal(view.startedAt, "2026-11-13T22:00:00.000Z");
    assert.equal(view.completedAt, null);
    assert.equal(view.products[0]!.productName, "");
    assert.equal(view.products[0]!.checkedAt, "2026-11-13T22:00:05.000Z");
    assert.deepEqual(
      view.products[0]!.fetches.map((f) => [f.outcome, f.reason, f.httpStatus]),
      [
        ["REFUSED", "NO_MANUFACTURER_SITE", null],
        ["FETCHED", "AI: EXCERPT_NOT_IN_PAGE", 200],
      ],
    );
  });

  /*
    THE PRISMA READER'S SELECT (no database in the unit run): the fetch's outcome, reason and HTTP code, and the field's
    status and value, are asked for. A source-reading check on the call shape, unique in the file.
  */
  it("a Prisma-olvasó a letöltés okát és kódját, a mező állapotát és értékét kéri le", () => {
    const source = // the path is from `apps/api`, where the test command runs (ES module: no __dirname; as attribute-definitions.spec.ts)
      readFileSync(
        join("src", "products", "enrichment", "enrichment-runs.read.ts"),
        "utf8",
      );
    const fetches =
      /fetches: \{[\s\S]*?select: \{([\s\S]*?)\}/.exec(source)?.[1] ?? "";
    for (const key of ["outcome", "reason", "httpStatus", "url", "sourceKind"])
      assert.match(fetches, new RegExp(`\\b${key}: true`), key);
    const fields =
      /fields: \{[\s\S]*?select: \{([^}]*)\}/.exec(source)?.[1] ?? "";
    for (const key of ["field", "status", "value"])
      assert.match(fields, new RegExp(`\\b${key}: true`), key);
  });
});
