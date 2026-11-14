import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractPageStatement } from "./page-extract.js";

/**
 * SCHEMA.ORG MICRODATA WHEN THE PAGE HAS NO JSON-LD PRODUCT (card 85c38ab1,
 * the Fauna Marin shop's shape: a navigation scope full of `name` spans, one
 * Product with an `h1` name, a nested Brand and Offer, the EAN in a meta tag).
 * WHAT TURNS IT RED: a navigation `name` or the brand's `name` taken as the
 * product's; the shop's `sku` taken as the manufacturer part number; two
 * different products giving values; a JSON-LD Product not winning. Invented
 * page text only.
 */
const shopPage = (product: string) => `<html><head><title>Kitalált bolt</title>
<script>var x = '<div itemscope itemtype="https://schema.org/Product"><meta itemprop="gtin13" content="1111111111116">';</script></head>
<body itemscope itemtype="https://schema.org/WebPage">
<nav itemscope itemtype="https://schema.org/SiteNavigationElement"><a href="/a"><span itemprop="name">Menü egy</span></a><br>
<span itemprop="name">Menü kettő</span></nav>
<ol itemscope itemtype="https://schema.org/BreadcrumbList"><li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><span itemprop="name">Kezdőlap</span></li></ol>
${product}
</body></html>`;

const product = (gtin: string, name = "Kitalált Amino 1000 ml") =>
  `<div itemscope itemtype="https://schema.org/Product">
  <h1 itemprop="name">${name}</h1>
  <div itemprop="brand" itemscope itemtype="https://schema.org/Brand"><meta itemprop="name" content="Kitalált Márka"></div>
  <meta itemprop="gtin13" content="${gtin}"/>
  <span itemprop="sku">11135V</span>
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="29.95"></div>
</div>`;

const fields = (html: string) =>
  extractPageStatement(html).values.map((v) => [v.field, v.raw]);

describe("a lap strukturált adata (schema.org microdata)", () => {
  it("egy Product: az EAN, a név és a márka a saját hatóköréből, az sku nem gyártói cikkszám", () => {
    const statement = extractPageStatement(shopPage(product("5901234123457")));
    assert.equal(statement.note, null);
    assert.deepEqual(
      statement.values.map((v) => [v.field, v.raw]),
      [
        ["ean", "5901234123457"],
        ["title", "Kitalált Amino 1000 ml"],
        ["brand", "Kitalált Márka"],
      ],
    );
    assert.equal(
      statement.values[0]!.excerpt,
      'microdata Product.gtin13 = "5901234123457"',
    );
  });

  it("két különböző termék: semmi; egy termék kétszer (azonos azonosító): egy", () => {
    assert.deepEqual(
      extractPageStatement(
        shopPage(product("5901234123457") + product("4006381333931")),
      ),
      { values: [], note: "AMBIGUOUS_PRODUCT" },
    );
    assert.deepEqual(
      fields(shopPage(product("5901234123457") + product("5901234123457")))[0],
      ["ean", "5901234123457"],
    );
  });

  it("microdata nélkül a JSON-LD útjának megjegyzése marad; JSON-LD Product mellett a microdata nem számít", () => {
    assert.deepEqual(extractPageStatement(shopPage("<p>Kitalált.</p>")), {
      values: [],
      note: "NO_STRUCTURED_DATA",
    });
    const both = shopPage(product("5901234123457")).replace(
      "</head>",
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        gtin13: "4006381333931",
      })}</script></head>`,
    );
    assert.deepEqual(fields(both), [["ean", "4006381333931"]]);
  });
});
