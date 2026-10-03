import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { productPage } from "./enrichment-test-fixtures.js";
import { extractPageStatement } from "./page-extract.js";

describe("a lap strukturált adata (schema.org JSON-LD)", () => {
  it("azonosítók, márka, név, méretek és a nevesített tulajdonságok", () => {
    const statement = extractPageStatement(
      productPage({
        name: "Kitalált pumpa 3000",
        gtin13: "5901234123457",
        mpn: "KP-3000",
        brand: { "@type": "Brand", name: "Kitalált Márka" },
        weight: { "@type": "QuantitativeValue", value: 1.2, unitCode: "KGM" },
        width: { "@type": "QuantitativeValue", value: 12, unitText: "cm" },
        additionalProperty: [
          {
            "@type": "PropertyValue",
            name: "Flow rate",
            value: 3000,
            unitText: "l/h",
          },
          { "@type": "PropertyValue", name: "Power", value: "25 W" },
          { "@type": "PropertyValue", name: "Szín", value: "fekete" },
        ],
      }),
    );
    assert.equal(statement.note, null);
    const byField = Object.fromEntries(
      statement.values.map((v) => [v.field, v.raw]),
    );
    assert.deepEqual(byField, {
      ean: "5901234123457",
      manufacturerSku: "KP-3000",
      brand: "Kitalált Márka",
      title: "Kitalált pumpa 3000",
      weight: "1.2 kg",
      widthMm: "12 cm",
      flowRate: "3000 l/h",
      power: "25 W",
    });
    assert.match(
      statement.values.find((v) => v.field === "ean")!.excerpt,
      /^ld\+json Product\.gtin13 = /,
    );
  });

  it("strukturált adat nélkül, termék nélkül vagy több termékkel nem vesz át semmit", () => {
    assert.equal(
      extractPageStatement("<html><p>EAN 5901234123457</p></html>").note,
      "NO_STRUCTURED_DATA",
    );
    assert.equal(
      extractPageStatement(
        `<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>`,
      ).note,
      "NO_PRODUCT",
    );
    const listing = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "Product", name: "A", gtin13: "5901234123457" },
        { "@type": "Product", name: "B", gtin13: "4006381333931" },
      ],
    })}</script>`;
    assert.deepEqual(extractPageStatement(listing), {
      values: [],
      note: "AMBIGUOUS_PRODUCT",
    });
  });

  it("a hibás JSON-blokk nem állít semmit, és nem dönti el a lapot", () => {
    const html = `<script type="application/ld+json">{ hibás</script>${productPage({ mpn: "X-1" })}`;
    assert.deepEqual(
      extractPageStatement(html).values.map((v) => v.field),
      ["manufacturerSku"],
    );
  });
});
