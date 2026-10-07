import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGtin } from "@acropora/jev/product-enrichment";

import { main } from "./barcode-backfill.cli.js";
import {
  planBarcodeBackfill,
  type BackfillBarcodeRow,
} from "./barcode-backfill.js";

/**
 * A VONALKÓD-BACKFILL (SEO P0 PR 4; D1, D2). MI PIROSIT:
 * - a meglévő sor nem kap típust vagy forrást, vagy egy kitöltött sor újra frissül;
 * - a gyártói cikkszám ma kint lévő kódja nem kerül át, vagy nem a tárolt alakjában
 *   (a 12 jegyű UPC-A 12 jegyen);
 * - egy ismétlődő, egy kiadvány-tartományú vagy egy inaktív változaton álló kód átkerül;
 * - a D2 eset (a változatnak már van MÁSIK kódja) gépi döntéssel átkerül, vagy
 *   kimarad a listáról, mert a kód ismétlődik;
 * - a szárazfutás ír; egy második futás még változtat.
 */
const kod = (torzs: string) => {
  for (let d = 0; d <= 9; d++) if (validateGtin(torzs + d).ok) return torzs + d;
  throw new Error(torzs);
};
const UPC = kod("65334119112");
const EAN = kod("599123456789");
const MASIK = kod("599987654321");
const sor = (over: Partial<BackfillBarcodeRow>): BackfillBarcodeRow => ({
  id: "b1",
  variantId: "v-sajat",
  code: EAN,
  type: null,
  source: null,
  ...over,
});
const valtozat = (variantId: string, mpn: string | null, isActive = true) => ({
  variantId,
  sku: `${variantId}-sku`,
  manufacturerPartNumber: mpn,
  isActive,
});

describe("planBarcodeBackfill", () => {
  it("a meglévő sor típust és IMPORT forrást kap; a kitöltött sor nem frissül", () => {
    const plan = planBarcodeBackfill(
      [
        sor({}),
        sor({
          id: "b2",
          code: "ACR1",
          variantId: "v2",
          type: "INTERNAL",
          source: "POS",
        }),
      ],
      [],
    );
    assert.deepEqual(plan.typeUpdates, [
      { id: "b1", type: "EAN13", setSource: true },
    ]);
    assert.deepEqual(plan.typeCounts, { EAN13: 1, INTERNAL: 1 });
  });

  it("a gyártói cikkszám kódja a tárolt alakjában jön át, primary-ként, ha a változatnak nincs sora", () => {
    const plan = planBarcodeBackfill(
      [],
      [valtozat("v-upc", UPC), valtozat("v-ean", EAN)],
    );
    assert.deepEqual(plan.newRows, [
      { variantId: "v-upc", code: UPC, type: "UPCA" },
      { variantId: "v-ean", code: EAN, type: "EAN13" },
    ]);
  });

  it("ismétlődő, kiadvány-tartományú, inaktív és nem vonalkód-szerű érték nem jön át", () => {
    const plan = planBarcodeBackfill(
      [],
      [
        valtozat("v-dup1", UPC),
        valtozat("v-dup2", `0${UPC}`), // ugyanaz a fizikai kód, másik írásmód
        valtozat("v-isbn", "9780301379722"),
        valtozat("v-inaktiv", EAN, false),
        valtozat("v-szoveg", "core7_otherm_bulk"),
      ],
    );
    assert.deepEqual(plan.newRows, []);
    assert.equal(plan.skipped.duplicate, 2);
    assert.equal(plan.skipped.notProductGtin, 1);
    assert.equal(plan.skipped.inactive, 1);
  });

  it("D2: a változat másik érvényes kódja a listára megy, gépi döntés nélkül, ismétlődve is", () => {
    const plan = planBarcodeBackfill(
      [sor({ variantId: "v-sajat", code: EAN })],
      [valtozat("v-sajat", MASIK), valtozat("v-masik", MASIK)],
    );
    assert.deepEqual(plan.conflicts, [
      { variantId: "v-sajat", sku: "v-sajat-sku", barcode: EAN, mpn: MASIK },
    ]);
    // a v-masik ugyanazt a kódot viseli: ismétlődő, tehát ott sem jön át
    assert.deepEqual(plan.newRows, []);
  });

  it("ha a változatnak már ugyanez a kódja van (bármelyik írásmódban), nincs teendő", () => {
    const plan = planBarcodeBackfill(
      [
        sor({
          variantId: "v-sajat",
          code: `0${UPC}`,
          type: "EAN13",
          source: "IMPORT",
        }),
      ],
      [valtozat("v-sajat", UPC)],
    );
    assert.deepEqual(
      [plan.newRows, plan.conflicts, plan.typeUpdates],
      [[], [], []],
    );
  });
});

describe("a backfill parancs", () => {
  function adatbazis() {
    const irasok: unknown[] = [];
    return {
      irasok,
      db: {
        productBarcode: {
          findMany: async () => [sor({})],
          update: (args: unknown) => (irasok.push(["update", args]), args),
          create: (args: unknown) => (irasok.push(["create", args]), args),
        },
        productVariant: {
          findMany: async () => [
            {
              id: "v-upc",
              sku: "s",
              manufacturerPartNumber: UPC,
              isActive: true,
            },
          ],
        },
        $transaction: async (ops: unknown[]) => {
          irasok.push(["transaction", ops.length]);
          return ops;
        },
      },
    };
  }
  const csend = { stdout: () => {}, stderr: () => {} };

  it("alapból szárazfutás: nem ír", async () => {
    const { db, irasok } = adatbazis();
    assert.equal(await main([], csend, db as never), 0);
    assert.deepEqual(irasok, []);
  });

  it("--apply egy tranzakcióban írja a típust és az új sort, UNAS forrással", async () => {
    const { db, irasok } = adatbazis();
    assert.equal(await main(["--apply"], csend, db as never), 0);
    assert.deepEqual(irasok, [
      [
        "update",
        { where: { id: "b1" }, data: { type: "EAN13", source: "IMPORT" } },
      ],
      [
        "create",
        {
          data: {
            variantId: "v-upc",
            code: UPC,
            type: "UPCA",
            source: "UNAS",
            isPrimary: true,
          },
        },
      ],
      ["transaction", 2],
    ]);
  });

  it("ismeretlen kapcsolóra nem fut", async () => {
    const { db, irasok } = adatbazis();
    assert.equal(await main(["--aply"], csend, db as never), 1);
    assert.deepEqual(irasok, []);
  });
});
