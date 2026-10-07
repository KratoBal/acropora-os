import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  barcodesFromProductBarcode,
  decideVariantBarcodes,
} from "./medusa-variant-barcode.js";

/**
 * A VÁLTOZATOK VONALKÓD-DÖNTÉSE (SEO P0 PR 4). MI PIROSIT: egy nem-primary vagy
 * INTERNAL sor kimegy; egy típus nélküli (még nem backfillelt) GTIN kimarad; az
 * ismétlődés vagy a tiltás elveszik; a kapcsoló alapból ki van kapcsolva.
 */
describe("decideVariantBarcodes", () => {
  const alap = {
    variants: [
      { id: "v1", sku: "A" },
      { id: "v2", sku: "B" },
      { id: "v3", sku: "C" },
      { id: "v4", sku: "D" },
    ],
    sameValueCount: () => 1,
    blocked: () => false,
  };

  it("változatonként a saját primary GTIN-je, a hossz szerinti mezővel; INTERNAL nem", () => {
    const d = decideVariantBarcodes({
      ...alap,
      primaries: [
        { variantId: "v1", code: "4006381333931", type: "EAN13" },
        { variantId: "v2", code: "036000291452", type: "UPCA" },
        { variantId: "v3", code: "2000000000008", type: "INTERNAL" },
        // típus nélkül: a `barcodeType` sorolja be (EAN13)
        { variantId: "v4", code: "4260507580214", type: null },
      ],
    });
    assert.deepEqual(
      d.map((x) => [x.sku, x.decision.kind, x.decision.value]),
      [
        ["A", "ean", "4006381333931"],
        ["B", "upc", "036000291452"],
        ["D", "ean", "4260507580214"],
      ],
    );
  });

  it("az ismétlődés és a tiltás ugyanúgy visszatart, mint eddig", () => {
    const d = decideVariantBarcodes({
      variants: [
        { id: "v1", sku: "A" },
        { id: "v2", sku: "B" },
      ],
      primaries: [
        { variantId: "v1", code: "4006381333931", type: "EAN13" },
        { variantId: "v2", code: "4260507580214", type: "EAN13" },
      ],
      sameValueCount: (code) => (code === "4006381333931" ? 2 : 1),
      blocked: (sku) => sku === "B",
    });
    assert.deepEqual(
      d.map((x) => [x.sku, x.decision.kind]),
      [
        ["A", "skipped"],
        ["B", "blocked"],
      ],
    );
  });

  it("a kapcsoló alapból be, csak a 'false' kapcsolja ki", () => {
    assert.equal(barcodesFromProductBarcode({}), true);
    assert.equal(
      barcodesFromProductBarcode({ MEDUSA_PROJECT_BARCODES: "true" }),
      true,
    );
    assert.equal(
      barcodesFromProductBarcode({ MEDUSA_PROJECT_BARCODES: "false" }),
      false,
    );
  });
});
