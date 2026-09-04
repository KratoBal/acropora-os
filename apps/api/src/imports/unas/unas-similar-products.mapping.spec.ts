import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSimilarProducts,
  similarProductDataLoss,
} from "./unas-similar-products.mapping.js";

const reference = (
  externalId: string,
  sku: string,
  name: string | null = sku,
) => ({
  externalId,
  sku,
  name,
});

describe("UNAS similar-product mapping", () => {
  it("keeps the source order of the resolved targets", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      similarProducts: [
        reference("30", "C"),
        reference("10", "A"),
        reference("20", "B"),
      ],
      productIdsByExternalId: new Map([
        ["10", "product-a"],
        ["20", "product-b"],
        ["30", "product-c"],
      ]),
    });

    assert.deepEqual(
      mapping.targets.map((target) => target.productId),
      ["product-c", "product-a", "product-b"],
    );
  });

  /**
   * A KULCS AZ AZONOSITO, NEM A CIKKSZAM -- ES EZ AZ AN ALLITAS, AMI EGY KESOBBI
   * "egyszerusitest" megfog. A ket termek cikkszama SZANDEKOSAN fel van cserelve
   * az azonositokhoz kepest: aki cikkszamra allitana at a feloldast, ettol a
   * teszttol kapna pirosat, nem egy eles hibajelentestol.
   */
  it("resolves by external id even when the sku points at another product", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      similarProducts: [reference("10", "SKU-OF-20")],
      productIdsByExternalId: new Map([
        ["10", "product-ten"],
        ["20", "product-twenty"],
      ]),
    });

    assert.deepEqual(mapping.targets, [
      { productId: "product-ten", externalId: "10" },
    ]);
  });

  it("drops a reference that points at the source external id", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      similarProducts: [reference("1", "SELF"), reference("10", "A")],
      productIdsByExternalId: new Map([
        ["1", "product-self"],
        ["10", "product-a"],
      ]),
    });

    assert.equal(mapping.selfReferences, 1);
    assert.deepEqual(
      mapping.targets.map((target) => target.productId),
      ["product-a"],
    );
  });

  /**
   * KET KULONBOZO UNAS-AZONOSITO, EGY TERMEK NALUNK. Az azonosito-osszevetes
   * ezt nem fogja meg, mert a ket azonosito tenyleg kulonbozo.
   */
  it("drops a reference that resolves back to the source product", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      sourceProductId: "product-one",
      similarProducts: [reference("2", "OTHER-ID-SAME-PRODUCT")],
      productIdsByExternalId: new Map([
        ["1", "product-one"],
        ["2", "product-one"],
      ]),
    });

    assert.equal(mapping.selfReferences, 1);
    assert.deepEqual(mapping.targets, []);
  });

  it("keeps the first of a repeated target and counts the rest as duplicates", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      similarProducts: [
        reference("10", "A"),
        reference("20", "B"),
        reference("10", "A"),
      ],
      productIdsByExternalId: new Map([
        ["10", "product-a"],
        ["20", "product-b"],
      ]),
    });

    assert.equal(mapping.duplicates, 1);
    assert.deepEqual(
      mapping.targets.map((target) => target.externalId),
      ["10", "20"],
    );
  });

  /**
   * A FELOLDATLAN HIVATKOZAS A NEVEVEL EGYUTT ALL A LISTABAN. Egy puszta
   * darabszam mellett senki nem tudna megnezni, MI veszett el.
   */
  it("reports an unresolved reference with its sku and name", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      similarProducts: [reference("99", "GONE-SKU", "Gone product")],
      productIdsByExternalId: new Map([["10", "product-a"]]),
    });

    assert.deepEqual(mapping.unresolved, [
      { externalId: "99", sku: "GONE-SKU", name: "Gone product" },
    ]);
    assert.deepEqual(mapping.targets, []);
  });

  /**
   * A VESZTES CSAK A FELOLDATLANOKE. Ha az onhivatkozas vagy a duplikatum is
   * beleszamitana, egy egeszseges termek is vesztesegesnek latszana.
   */
  it("counts only the unresolved references as data loss", () => {
    const mapping = resolveSimilarProducts({
      sourceExternalId: "1",
      similarProducts: [
        reference("1", "SELF"),
        reference("10", "A"),
        reference("10", "A"),
        reference("99", "GONE"),
      ],
      productIdsByExternalId: new Map([["10", "product-a"]]),
    });

    assert.equal(mapping.selfReferences, 1);
    assert.equal(mapping.duplicates, 1);
    assert.equal(similarProductDataLoss(mapping), 1);
  });
});
