import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUnasCategoryPageXml,
  buildUnasProductPageXml,
  parseUnasCategoryResponse,
  parseUnasProductResponse,
  unasRetryDelayMs,
  UnasApiClient,
} from "./unas-api.client.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";

const response = `<?xml version="1.0" encoding="UTF-8"?>
<Products><Product><State>live</State><Id>159850145</Id><Sku>pump_1</Sku>
<CreateTime>1720000000</CreateTime><LastModTime>1720000100</LastModTime>
<Statuses><Status><Type>base</Type><Value>3</Value></Status></Statuses>
<Name><![CDATA[Reef & Pump]]></Name><Unit>db</Unit>
<MinimumQty>1</MinimumQty><MaximumQty>20</MaximumQty><AlertQty>3</AlertQty><UnitStep>0.5</UnitStep>
<AlterUnit><Qty>12</Qty><Unit>karton</Unit></AlterUnit>
<Description><ShortIsHtml>1</ShortIsHtml><Short><![CDATA[<b>Short</b>]]></Short><Long>Long</Long><LongIsHtml>0</LongIsHtml></Description>
<Prices><Appearance>sale</Appearance><Vat>27</Vat><Price><Type>normal</Type><Net>1000</Net><Gross>1270</Gross></Price><Price><Type>sale</Type><Net>900</Net><Gross>1143</Gross><Start>2026.07.01</Start><End>2026.07.31</End></Price></Prices>
<Categories><Category><Type>base</Type><Id>10</Id></Category><Category><Type>alt</Type><Id>11</Id></Category></Categories>
<Url>https://shop.example/pump</Url><SefUrl>reef-pump</SefUrl><ManufacturerUrl>https://maker.example/pump</ManufacturerUrl>
<Images><Image><Type>base</Type><SefUrl>https://shop.example/pump.jpg</SefUrl><Filename>pump.jpg</Filename><Alt>Pump</Alt></Image></Images>
<Params><Param><Id>1</Id><Type>text</Type><Name>brand</Name><Value>Acme</Value></Param><Param><Id>2</Id><Type>text</Type><Name>Gyártói cikkszám</Name><Value>MPN-1</Value></Param></Params>
<Stocks><Status><Active>1</Active><Empty>1</Empty><Variant>0</Variant></Status><Stock><Qty>7.5</Qty></Stock></Stocks>
<Meta><Title>SEO title</Title><Description>SEO description</Description><Keywords>reef,pump</Keywords><Robots>index,follow</Robots></Meta>
</Product></Products>`;

describe("UNAS API XML contract", () => {
  it("builds a bounded incremental page request", () => {
    const xml = buildUnasProductPageXml({
      timeStart: 100,
      timeEnd: 200,
      limitStart: 0,
      limitNum: 100,
      state: "live",
    });
    assert.match(xml, /<TimeStart>100<\/TimeStart>/);
    assert.match(xml, /<TimeEnd>200<\/TimeEnd>/);
    assert.match(xml, /<LimitNum>100<\/LimitNum>/);
    assert.match(xml, /<ContentType>full<\/ContentType>/);
  });

  it("parses stable identity, timestamps, status and CDATA", () => {
    const product = parseUnasProductResponse(response)[0]!;
    assert.equal(product.externalId, "159850145");
    assert.equal(product.sku, "pump_1");
    assert.equal(product.name, "Reef & Pump");
    assert.equal(product.externalStatus, "3");
    assert.equal(product.sourceUpdatedAt, "2024-07-03T09:48:20.000Z");
    assert.equal(product.descriptionShort, "<b>Short</b>");
    assert.equal(product.descriptionShortIsHtml, true);
    assert.equal(product.secondaryUnitFactor, "12");
    assert.equal(product.netPrice, "1000");
    assert.equal(product.saleGrossPrice, "1143");
    assert.equal(product.saleStartsAt, "2026-07-01T00:00:00.000Z");
    assert.equal(product.primaryCategoryExternalId, "10");
    assert.deepEqual(product.alternativeCategoryExternalIds, ["11"]);
    assert.equal(product.images[0]?.filename, "pump.jpg");
    assert.equal(product.brandName, "Acme");
    assert.equal(product.manufacturerPartNumber, "MPN-1");
    assert.equal(product.backorderAllowed, true);
    assert.equal(product.reportedStock, "7.5");
    assert.equal(product.seo.title, "SEO title");
  });

  it("rejects DTD/entity input", () => {
    assert.throws(
      () =>
        parseUnasProductResponse('<!DOCTYPE x [<!ENTITY e "x">]><Products/>'),
      /XML_DTD_FORBIDDEN/,
    );
  });

  it("parses category identity, parent and source timestamps", () => {
    const xml = buildUnasCategoryPageXml({
      limitStart: 0,
      limitNum: 100,
      timeStart: 10,
      timeEnd: 20,
    });
    assert.match(xml, /<ContentType>normal<\/ContentType>/);
    const category = parseUnasCategoryResponse(
      "<Categories><Category><State>live</State><Id>20</Id><Name>Pumps</Name><Parent><Id>10</Id></Parent><Order>3</Order><CreateTime>1720000000</CreateTime><LastModTime>1720000100</LastModTime></Category></Categories>",
    )[0]!;
    assert.equal(category.externalId, "20");
    assert.equal(category.parentExternalId, "10");
    assert.equal(category.sortOrder, 3);
    assert.equal(category.sourceUpdatedAt, "2024-07-03T09:48:20.000Z");
  });
});

describe("UNAS API transport policy", () => {
  it("honors bounded Retry-After and deterministic jitter", () => {
    assert.equal(unasRetryDelayMs(1, "2"), 2000);
    assert.equal(unasRetryDelayMs(1, "999"), 10_000);
    assert.equal(
      unasRetryDelayMs(2, null, () => 0),
      750,
    );
  });

  it("retries a rate-limited read without waiting in the contract test", async () => {
    class TestClient extends UnasApiClient {
      attempts = 0;
      delays: number[] = [];

      protected override request() {
        this.attempts += 1;
        return Promise.resolve(
          this.attempts === 1
            ? new Response("rate limited", {
                status: 429,
                headers: { "retry-after": "0" },
              })
            : new Response(
                "<Login><Token>safe-token</Token><ExpireTime>1999999999</ExpireTime></Login>",
                { status: 200 },
              ),
        );
      }

      protected override wait(milliseconds: number) {
        this.delays.push(milliseconds);
        return Promise.resolve();
      }
    }

    const client = new TestClient();
    const result = await client.login("secret");
    assert.equal(result.token, "safe-token");
    assert.equal(client.attempts, 2);
    assert.deepEqual(client.delays, [0]);
  });
});

describe("UNAS canonical identity diff", () => {
  it("is stable across raw object key order", () => {
    const parsed = parseUnasProductResponse(response)[0]!;
    const canonicalizer = new UnasProductCanonicalizer();
    const first = canonicalizer.canonicalize(parsed);
    const second = canonicalizer.canonicalize({
      ...parsed,
      rawPayload: Object.fromEntries(
        Object.entries(parsed.rawPayload).reverse(),
      ),
    });
    assert.equal(first.canonicalHash, second.canonicalHash);
  });

  it("detects an external ID/SKU cross-record conflict", () => {
    const product = new UnasProductCanonicalizer().canonicalize(
      parseUnasProductResponse(response)[0]!,
    );
    const result = new UnasProductSyncDiffEngine().diff(
      [product],
      [
        {
          productId: "product-by-id",
          externalId: product.externalId,
          sku: "old-sku",
          canonicalHash: null,
        },
        {
          productId: "product-by-sku",
          externalId: "999",
          sku: product.sku,
          canonicalHash: null,
        },
      ],
    )[0]!;
    assert.equal(result.action, "CONFLICT");
    assert.equal(result.reason, "IDENTITY_CONFLICT");
  });

  it("restores a missing mirror even when its payload hash is unchanged", () => {
    const product = new UnasProductCanonicalizer().canonicalize(
      parseUnasProductResponse(response)[0]!,
    );
    const result = new UnasProductSyncDiffEngine().diff(
      [product],
      [
        {
          productId: "product-1",
          externalId: product.externalId,
          sku: product.sku,
          canonicalHash: product.canonicalHash,
          mirrorState: "MISSING",
        },
      ],
    )[0]!;
    assert.equal(result.action, "UPDATE");
    assert.equal(result.reason, "RESTORE");
  });
});
