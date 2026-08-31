import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAcroporaMasteredProduct,
  isAcroporaMasteredVariant,
  isUnasMasteredProduct,
  isUnasMasteredVariant,
  resolveProductCatalogAuthority,
  resolveVariantCatalogAuthority,
} from "./catalog-authority.js";

/**
 * The mirror columns an authority takeover leaves behind on a variant. They
 * are the reason this module exists, so every "inherits" test carries them.
 */
const unasMirrorColumns = {
  unasBaseSku: "SKU-123",
  unasVariantKey: "size:L",
  unasVariantValues: [{ name: "size", value: "L" }],
  unasReportedStock: 7,
};

describe("variant mastership is inherited, never owned", () => {
  it("a variant of a UNAS product behaves as UNAS-owned", () => {
    const variant = {
      ...unasMirrorColumns,
      product: { catalogAuthority: "UNAS" as const },
    };

    assert.equal(resolveVariantCatalogAuthority(variant), "UNAS");
    assert.equal(isUnasMasteredVariant(variant), true);
    assert.equal(isAcroporaMasteredVariant(variant), false);
  });

  it("a variant of an ACROPORA product behaves as ACROPORA-owned", () => {
    const variant = {
      ...unasMirrorColumns,
      product: { catalogAuthority: "ACROPORA" as const },
    };

    assert.equal(resolveVariantCatalogAuthority(variant), "ACROPORA");
    assert.equal(isAcroporaMasteredVariant(variant), true);
    assert.equal(isUnasMasteredVariant(variant), false);
  });

  /**
   * THE ONE THAT MATTERS. The mirror columns survive a takeover on purpose,
   * so they are present on products that are ours. If ownership were ever read
   * off their presence, this product would answer "UNAS" and its stock would be
   * pushed back to a shop that no longer owns it.
   */
  it("the presence of UNAS mirror columns cannot override the product", () => {
    const takenOver = {
      ...unasMirrorColumns,
      product: { catalogAuthority: "ACROPORA" as const },
    };

    assert.equal(isUnasMasteredVariant(takenOver), false);
    assert.equal(resolveVariantCatalogAuthority(takenOver), "ACROPORA");

    const withoutMirrorColumns = {
      product: { catalogAuthority: "UNAS" as const },
    };

    // And the other direction: their ABSENCE cannot make a UNAS product ours.
    assert.equal(isUnasMasteredVariant(withoutMirrorColumns), true);
  });
});

describe("the unset authority is a third state, not a default", () => {
  it("null is neither ours nor theirs", () => {
    const product = { catalogAuthority: null };

    assert.equal(resolveProductCatalogAuthority(product), null);
    assert.equal(isUnasMasteredProduct(product), false);
    assert.equal(isAcroporaMasteredProduct(product), false);
  });

  it("a missing field reads the same as an explicit null", () => {
    assert.equal(resolveProductCatalogAuthority({}), null);
    assert.equal(isUnasMasteredProduct({}), false);
    assert.equal(isAcroporaMasteredProduct({}), false);
  });

  it("a variant of a product with no authority is neither", () => {
    const variant = {
      ...unasMirrorColumns,
      product: { catalogAuthority: null },
    };

    assert.equal(isUnasMasteredVariant(variant), false);
    assert.equal(isAcroporaMasteredVariant(variant), false);
  });
});

describe("missing links do not throw", () => {
  it("survives a variant with no product loaded", () => {
    assert.equal(resolveVariantCatalogAuthority({ product: null }), null);
    assert.equal(isUnasMasteredVariant({ product: undefined }), false);
    assert.equal(resolveVariantCatalogAuthority(null), null);
    assert.equal(resolveProductCatalogAuthority(undefined), null);
  });
});
