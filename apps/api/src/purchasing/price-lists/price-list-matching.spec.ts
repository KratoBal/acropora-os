import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  barcodeQueryCodes,
  decideMatches,
  groupVariantsByGtin,
  tallyDecisions,
  type ExistingMatch,
} from "./price-list-matching.js";
import type { ParsedPriceEntry } from "./price-list.types.js";

const entry = (
  supplierSku: string,
  gtin: string | null = null,
): ParsedPriceEntry => ({
  rowNumber: 2,
  supplierSku,
  supplierName: null,
  brand: null,
  gtin,
  unitPrice: "1",
  listRetailPrice: null,
});

const GTIN = "04006381333931";

function decide(
  entries: ParsedPriceEntry[],
  options: {
    variants?: Record<string, string[]>;
    existing?: Record<string, ExistingMatch>;
    known?: Record<string, string>;
  } = {},
) {
  return decideMatches({
    entries,
    variantsByGtin: new Map(
      Object.entries(options.variants ?? {}).map(([gtin, ids]) => [
        gtin,
        new Set(ids),
      ]),
    ),
    existing: new Map(Object.entries(options.existing ?? {})),
    knownCodes: new Map(Object.entries(options.known ?? {})),
  });
}

/**
 * A PÁROSÍTÁS AUTOMATIKUS RÉSZE (task beszallitoi-arlistak-2). MI PIROSÍT: ha egy
 * jóváhagyott vagy automatikus kötést újradöntene; ha két termékre mutató
 * vonalkódot kötne; ha a vonalkód és a cikkszám ellentmondását elnyelné; ha egy
 * elutasított párt visszahozna; ha vonalkód nélküli sort EAN-nel kötne.
 */
describe("decideMatches", () => {
  it("binds a barcode that fits exactly one product, as an EAN match", () => {
    assert.deepEqual(
      decide([entry("A1", GTIN)], { variants: { [GTIN]: ["v1"] } }),
      [
        {
          kind: "NEW_AUTO",
          supplierSku: "A1",
          variantId: "v1",
          method: "EAN",
        },
      ],
    );
  });

  it("binds a supplier code the SupplierProduct already knows, when there is no barcode", () => {
    assert.deepEqual(decide([entry("A1")], { known: { A1: "v9" } }), [
      {
        kind: "NEW_AUTO",
        supplierSku: "A1",
        variantId: "v9",
        method: "SUPPLIER_CODE",
      },
    ]);
  });

  it("calls it an EAN match when the barcode and the known code agree", () => {
    const [decision] = decide([entry("A1", GTIN)], {
      variants: { [GTIN]: ["v1"] },
      known: { A1: "v1" },
    });
    assert.equal(decision?.kind === "NEW_AUTO" && decision.method, "EAN");
  });

  it("never re-decides an approved or an automatic match", () => {
    for (const status of ["APPROVED", "AUTO"] as const) {
      const [decision] = decide([entry("A1", GTIN)], {
        variants: { [GTIN]: ["other"] },
        existing: { A1: { variantId: "kept", status } },
        known: { A1: "yet-another" },
      });
      assert.deepEqual(decision, {
        kind: "KEEP",
        supplierSku: "A1",
        variantId: "kept",
      });
    }
  });

  it("leaves a barcode that fits several products as a conflict, not a guess", () => {
    assert.deepEqual(
      decide([entry("A1", GTIN)], { variants: { [GTIN]: ["v1", "v2"] } }),
      [{ kind: "CONFLICT", supplierSku: "A1", reason: "EAN_MANY" }],
    );
  });

  it("leaves a barcode and a known code that name two different products as a conflict", () => {
    assert.deepEqual(
      decide([entry("A1", GTIN)], {
        variants: { [GTIN]: ["v1"] },
        known: { A1: "v2" },
      }),
      [{ kind: "CONFLICT", supplierSku: "A1", reason: "EAN_VS_CODE" }],
    );
  });

  it("never suggests anything for a code a person rejected: not the same product, not a different one", () => {
    const rejected: ExistingMatch = { variantId: "v1", status: "REJECTED" };
    // the same product again
    assert.deepEqual(
      decide([entry("A1", GTIN)], {
        variants: { [GTIN]: ["v1"] },
        existing: { A1: rejected },
      }),
      [{ kind: "UNMATCHED", supplierSku: "A1" }],
    );
    // a different product (the data turned): still a person's call
    assert.deepEqual(
      decide([entry("A1", GTIN)], {
        variants: { [GTIN]: ["v2"] },
        existing: { A1: rejected },
      }),
      [{ kind: "UNMATCHED", supplierSku: "A1" }],
    );
    // and a code the SupplierProduct knows
    assert.deepEqual(
      decide([entry("A1")], {
        existing: { A1: rejected },
        known: { A1: "v3" },
      }),
      [{ kind: "UNMATCHED", supplierSku: "A1" }],
    );
  });

  it("leaves a row with no barcode and no known code unmatched", () => {
    assert.deepEqual(decide([entry("A1")], { variants: { [GTIN]: ["v1"] } }), [
      { kind: "UNMATCHED", supplierSku: "A1" },
    ]);
  });
});

describe("barcodeQueryCodes", () => {
  it("lists the stored shapes a GTIN-14 can have: 14, 13, 12 and 8 digits, only by dropping zeros", () => {
    assert.deepEqual(barcodeQueryCodes("04006381333931"), [
      "04006381333931",
      "4006381333931",
    ]);
    assert.deepEqual(barcodeQueryCodes("00036000291452"), [
      "00036000291452",
      "0036000291452",
      "036000291452",
    ]);
    assert.deepEqual(barcodeQueryCodes("00000096385074"), [
      "00000096385074",
      "0000096385074",
      "000096385074",
      "96385074",
    ]);
    assert.deepEqual(barcodeQueryCodes("14006381333938"), ["14006381333938"]);
  });
});

describe("groupVariantsByGtin", () => {
  it("normalizes each stored barcode to GTIN-14, so a UPC-A and its EAN-13 form meet", () => {
    const grouped = groupVariantsByGtin([
      { code: "036000291452", variantId: "v1" },
      { code: "0036000291452", variantId: "v2" },
      { code: "ABC-1", variantId: "v3" },
    ]);
    assert.deepEqual([...grouped.keys()], ["00036000291452"]);
    assert.deepEqual([...grouped.get("00036000291452")!].sort(), ["v1", "v2"]);
  });
});

describe("tallyDecisions", () => {
  it("counts each kind once", () => {
    assert.deepEqual(
      tallyDecisions([
        { kind: "KEEP", supplierSku: "a", variantId: "v" },
        {
          kind: "NEW_AUTO",
          supplierSku: "b",
          variantId: "v",
          method: "EAN",
        },
        {
          kind: "NEW_AUTO",
          supplierSku: "c",
          variantId: "v",
          method: "SUPPLIER_CODE",
        },
        { kind: "CONFLICT", supplierSku: "d", reason: "EAN_MANY" },
        { kind: "UNMATCHED", supplierSku: "e" },
        { kind: "UNMATCHED", supplierSku: "f" },
      ]),
      {
        alreadyMatched: 1,
        autoByEan: 1,
        autoByCode: 1,
        conflicts: 1,
        unmatched: 2,
      },
    );
  });
});
