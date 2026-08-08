import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUnasCategoryPageXml,
  buildUnasGetOrderByKeyXml,
  buildUnasGetOrderXml,
  buildUnasProductPageXml,
  buildUnasSetStockXml,
  buildUnasStockPageXml,
  parseUnasCategoryResponse,
  parseUnasOrderResponse,
  parseUnasProductResponse,
  parseUnasSetStockResponse,
  parseUnasStockResponse,
  unasRetryDelayMs,
  UnasApiError,
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
<Prices><Appearance>sale</Appearance><Vat>27%</Vat><Price><Type>normal</Type><Net>1000</Net><Gross>1270</Gross></Price><Price><Type>sale</Type><Net>900</Net><Gross>1143</Gross><Start>2026.07.01</Start><End>2026.07.31</End></Price></Prices>
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
    assert.doesNotMatch(xml, /<LimitStart>/);

    const secondPage = buildUnasProductPageXml({
      limitStart: 100,
      limitNum: 100,
      state: "live",
    });
    assert.match(secondPage, /<LimitStart>100<\/LimitStart>/);
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
    assert.equal(product.vatRate, "27");
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
    assert.deepEqual(product.variantStocks, []);
    assert.equal(product.isPackageProduct, false);
    assert.deepEqual(product.packageComponents, []);
    assert.equal(product.seo.title, "SEO title");
  });

  it("parses package-product components from a full product response", () => {
    const packageProduct = parseUnasProductResponse(
      response.replace(
        "<Meta>",
        "<PackageProduct>yes</PackageProduct><PackageComponents>" +
          "<Component><Sku>COMP-A</Sku><Qty>2</Qty></Component>" +
          "<Component><Sku>COMP-B</Sku><Qty>0.5</Qty></Component>" +
          "</PackageComponents><Meta>",
      ),
    )[0]!;

    assert.equal(packageProduct.isPackageProduct, true);
    assert.deepEqual(packageProduct.packageComponents, [
      { sku: "COMP-A", qty: "2" },
      { sku: "COMP-B", qty: "0.5" },
    ]);
  });

  it("parses every variant-stock combination with ordered axis names", () => {
    const variantProduct = parseUnasProductResponse(
      response
        .replace(
          "<Stocks>",
          "<Variants><Variant><Name>Szín</Name></Variant></Variants><Stocks>",
        )
        .replace("<Variant>0</Variant>", "<Variant>1</Variant>")
        .replace(
          "<Stock><Qty>7.5</Qty></Stock>",
          "<Stock><Variants><Variant>Fekete</Variant></Variants><Qty>2</Qty></Stock>" +
            "<Stock><Variants><Variant>Fehér</Variant></Variants><Qty>3</Qty></Stock>",
        ),
    )[0]!;

    assert.equal(variantProduct.reportedStock, null);
    assert.deepEqual(variantProduct.variantStocks, [
      {
        values: [{ name: "Szín", value: "Fekete" }],
        reportedStock: "2",
      },
      {
        values: [{ name: "Szín", value: "Fehér" }],
        reportedStock: "3",
      },
    ]);
  });

  it("builds and parses the dedicated incremental getStock contract", () => {
    const request = buildUnasStockPageXml({
      timeStart: 123,
      limitStart: 100,
      limitNum: 100,
    });
    assert.match(request, /<TimeStart>123<\/TimeStart>/);
    assert.match(request, /<LimitStart>100<\/LimitStart>/);
    assert.match(request, /<LimitNum>100<\/LimitNum>/);

    const stocks = parseUnasStockResponse(
      "<Products><Product><Id>159850145</Id><Sku>pump_1</Sku>" +
        "<Stocks><Stock><Qty>0</Qty></Stock></Stocks>" +
        "</Product></Products>",
    );
    assert.deepEqual(stocks, [
      {
        externalId: "159850145",
        sku: "pump_1",
        reportedStock: "0",
        variantValues: [],
      },
    ]);
  });

  it("accepts bare VAT but keeps percentage signs invalid for decimals", () => {
    const bareVat = parseUnasProductResponse(
      response.replace("<Vat>27%</Vat>", "<Vat>27</Vat>"),
    )[0]!;
    assert.equal(bareVat.vatRate, "27");
    assert.throws(
      () =>
        parseUnasProductResponse(
          response.replace("<Gross>1270</Gross>", "<Gross>27%</Gross>"),
        ),
      (error) =>
        error instanceof UnasApiError && error.code === "FIELD_FORMAT_INVALID",
    );
  });

  it("rejects DTD/entity input", () => {
    assert.throws(
      () =>
        parseUnasProductResponse('<!DOCTYPE x [<!ENTITY e "x">]><Products/>'),
      (error) =>
        error instanceof UnasApiError && error.code === "XML_FORBIDDEN",
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
    assert.doesNotMatch(xml, /<LimitStart>/);
    const category = parseUnasCategoryResponse(
      "<Categories><Category><State>live</State><Id>20</Id><Name>Pumps</Name><Parent><Id>10</Id></Parent><Order>3</Order><CreateTime>1720000000</CreateTime><LastModTime>1720000100</LastModTime></Category></Categories>",
    )[0]!;
    assert.equal(category.externalId, "20");
    assert.equal(category.parentExternalId, "10");
    assert.equal(category.sortOrder, 3);
    assert.equal(category.sourceUpdatedAt, "2024-07-03T09:48:20.000Z");
  });

  it("treats a Parent Id of 0 as no parent (UNAS's top-level sentinel)", () => {
    const topLevel = parseUnasCategoryResponse(
      "<Categories><Category><State>live</State><Id>10</Id><Name>Termékek</Name><Parent><Id>0</Id></Parent></Category></Categories>",
    )[0]!;
    assert.equal(topLevel.parentExternalId, null);

    const noParentNode = parseUnasCategoryResponse(
      "<Categories><Category><State>live</State><Id>11</Id><Name>Termékek 2</Name></Category></Categories>",
    )[0]!;
    assert.equal(noParentNode.parentExternalId, null);
  });

  it("builds a modify-action setStock request with an absolute quantity", () => {
    const xml = buildUnasSetStockXml({ sku: "product_1", qty: "10" });
    assert.match(xml, /<Action>modify<\/Action>/);
    assert.match(xml, /<Sku>product_1<\/Sku>/);
    assert.match(xml, /<Qty>10<\/Qty>/);
    assert.doesNotMatch(xml, /<Comment>/);
  });

  it("includes an optional comment in the setStock request", () => {
    const xml = buildUnasSetStockXml({
      sku: "product_1",
      qty: "10",
      comment: "Leltár korrekció",
    });
    assert.match(xml, /<Comment><!\[CDATA\[Leltár korrekció\]\]><\/Comment>/);
  });

  it("includes ordered variant values in a setStock request", () => {
    const xml = buildUnasSetStockXml({
      sku: "RF-BLUEM",
      qty: "3",
      variantValues: ["Fekete", "M"],
    });
    assert.match(
      xml,
      /<Variants><Variant>Fekete<\/Variant><Variant>M<\/Variant><\/Variants><Qty>3<\/Qty>/,
    );
  });

  it("parses a successful setStock response", () => {
    const result = parseUnasSetStockResponse(
      "<Products><Product><Id>159850145</Id><Sku>product_1</Sku><Action>modify</Action><Status>ok</Status></Product></Products>",
    );
    assert.equal(result.externalId, "159850145");
    assert.equal(result.sku, "product_1");
  });

  it("rejects a setStock response without Status ok", () => {
    assert.throws(
      () =>
        parseUnasSetStockResponse(
          "<Products><Product><Id>159850145</Id><Sku>product_1</Sku><Status>error</Status></Product></Products>",
        ),
      (error) => error instanceof UnasApiError && error.code === "API_REJECTED",
    );
  });

  it("rejects a top-level Error root from setStock", () => {
    assert.throws(
      () => parseUnasSetStockResponse("<Error>Invalid Sku</Error>"),
      (error) => error instanceof UnasApiError && error.code === "API_REJECTED",
    );
  });
});

describe("UNAS getOrder contract", () => {
  it("builds a TimeModStart-bounded page request", () => {
    const xml = buildUnasGetOrderXml({
      timeModStart: 100,
      limitStart: 0,
      limitNum: 500,
    });
    assert.match(xml, /<TimeModStart>100<\/TimeModStart>/);
    assert.match(xml, /<LimitNum>500<\/LimitNum>/);
    assert.doesNotMatch(xml, /<LimitStart>/);

    const secondPage = buildUnasGetOrderXml({ limitStart: 500, limitNum: 500 });
    assert.match(secondPage, /<LimitStart>500<\/LimitStart>/);
    assert.doesNotMatch(secondPage, /<TimeModStart>/);
  });

  it("rejects an out-of-range page size", () => {
    assert.throws(
      () => buildUnasGetOrderXml({ limitStart: 0, limitNum: 501 }),
      (error) =>
        error instanceof UnasApiError && error.code === "REQUEST_INVALID",
    );
  });

  it("builds a Key-only single-order request (no time-window params)", () => {
    const xml = buildUnasGetOrderByKeyXml({ key: "UN-1001" });
    assert.match(xml, /<Key>UN-1001<\/Key>/);
    assert.doesNotMatch(xml, /<TimeModStart>/);
    assert.doesNotMatch(xml, /<TimeModEnd>/);
    assert.doesNotMatch(xml, /<LimitStart>/);
    assert.doesNotMatch(xml, /<LimitNum>/);
  });

  it("rejects an empty or missing Key", () => {
    assert.throws(
      () => buildUnasGetOrderByKeyXml({ key: "" }),
      (error) =>
        error instanceof UnasApiError && error.code === "REQUEST_INVALID",
    );
    assert.throws(
      () => buildUnasGetOrderByKeyXml({ key: "   " }),
      (error) =>
        error instanceof UnasApiError && error.code === "REQUEST_INVALID",
    );
  });

  const orderResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Orders><Order>
<Key>UN-1001</Key><InternalKey>internal-1</InternalKey>
<Date>2026.07.20 14:05:00</Date>
<Status>Feldolgozás alatt</Status><StatusType>open_normal</StatusType><StatusID>3</StatusID>
<Customer><Email>vevo@example.com</Email><Contact><Name>Kovács Anna</Name></Contact></Customer>
<Currency>HUF</Currency><SumPriceGross>12700</SumPriceGross>
<Payment><Name>Bankkártya</Name><Type>bankcard</Type><Status>paid</Status></Payment>
<Shipping><Name>GLS</Name></Shipping>
<Items>
<Item><Id>1</Id><Sku>pump_1</Sku><Name>Reef Pump</Name><Variants><Variant><Id>2</Id><Name>Méret</Name><Value>M</Value></Variant><Variant><Id>1</Id><Name>Szín</Name><Value>Fekete</Value></Variant></Variants><Unit>db</Unit><Quantity>2</Quantity><PriceNet>5000</PriceNet><PriceGross>6350</PriceGross><Vat>27%</Vat></Item>
<Item><Id>shipping-cost</Id><Name>Szállítási költség</Name><Quantity>1</Quantity><PriceGross>0</PriceGross></Item>
</Items>
</Order></Orders>`;

  it("parses order identity, status, customer and line items", () => {
    const order = parseUnasOrderResponse(orderResponse)[0]!;
    assert.equal(order.key, "UN-1001");
    assert.equal(order.internalKey, "internal-1");
    assert.equal(order.statusType, "open_normal");
    assert.equal(order.statusId, "3");
    // UNAS's dotted Date is shop-local time. Europe/Budapest is UTC+2 in
    // July, so the stored UTC instant must be two hours earlier; rendering
    // it in the shop/browser timezone shows the original 14:05 again.
    assert.equal(order.orderedAt, "2026-07-20T12:05:00.000Z");
    assert.equal(order.customerName, "Kovács Anna");
    assert.equal(order.customerEmail, "vevo@example.com");
    assert.equal(order.sumPriceGross, "12700");
    assert.equal(order.paymentName, "Bankkártya");
    assert.equal(order.paymentType, "bankcard");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.shippingName, "GLS");
    assert.equal(order.items.length, 2);
    assert.equal(order.items[0]?.sku, "pump_1");
    assert.equal(order.items[0]?.quantity, "2");
    assert.equal(order.items[0]?.vatRate, "27");
    assert.deepEqual(order.items[0]?.variants, [
      { id: "1", name: "Szín", value: "Fekete" },
      { id: "2", name: "Méret", value: "M" },
    ]);
    assert.equal(order.items[1]?.sku, null);
    assert.equal(order.items[1]?.id, "shipping-cost");
  });

  it("converts UNAS shop-local order dates with Budapest daylight-saving time", () => {
    const summer = parseUnasOrderResponse(orderResponse, "Europe/Budapest")[0]!;
    const winter = parseUnasOrderResponse(
      orderResponse.replace("2026.07.20 14:05:00", "2026.01.20 14:05:00"),
      "Europe/Budapest",
    )[0]!;

    assert.equal(summer.orderedAt, "2026-07-20T12:05:00.000Z");
    assert.equal(winter.orderedAt, "2026-01-20T13:05:00.000Z");
  });

  it("keeps an explicit ISO offset authoritative and returns null for an invalid shop timezone", () => {
    const explicit = parseUnasOrderResponse(
      orderResponse.replace("2026.07.20 14:05:00", "2026-07-20T14:05:00+02:00"),
      "Europe/Budapest",
    )[0]!;
    const invalidZone = parseUnasOrderResponse(
      orderResponse,
      "Not/A-Time-Zone",
    )[0]!;

    assert.equal(explicit.orderedAt, "2026-07-20T12:05:00.000Z");
    assert.equal(invalidZone.orderedAt, null);
  });

  it("rejects an order without a Key", () => {
    assert.throws(
      () =>
        parseUnasOrderResponse(
          "<Orders><Order><Status>open_normal</Status></Order></Orders>",
        ),
      (error) =>
        error instanceof UnasApiError && error.code === "FIELD_FORMAT_INVALID",
    );
  });

  it("rejects a top-level Error root from getOrder", () => {
    assert.throws(
      () => parseUnasOrderResponse("<Error>Invalid Key</Error>"),
      (error) => error instanceof UnasApiError && error.code === "API_REJECTED",
    );
  });

  it("returns an empty list when there are no orders", () => {
    assert.deepEqual(parseUnasOrderResponse("<Orders></Orders>"), []);
  });

  it("defaults payment/shipping to null when the order has no such nodes", () => {
    const order = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-2</Key></Order></Orders>",
    )[0]!;
    assert.equal(order.paymentName, null);
    assert.equal(order.paymentType, null);
    assert.equal(order.paymentStatus, null);
    assert.equal(order.shippingName, null);
  });

  it("parses the billing address and Invoice.Status", () => {
    const billableOrder = `<?xml version="1.0" encoding="UTF-8"?>
<Orders><Order>
<Key>UN-3</Key>
<Customer><Email>vevo@example.com</Email>
<Contact><Name>Kovács Anna</Name></Contact>
<Addresses><Invoice><Name>Kovács Anna</Name><ZIP>2030</ZIP><City>Érd</City>
<Street>Tárnoki út 23.</Street><Country>Hungary</Country><CountryCode>HU</CountryCode>
<TaxNumber>12345678-1-42</TaxNumber></Invoice></Addresses></Customer>
<Invoice><Status>1</Status><StatusText>Számlázható</StatusText></Invoice>
<Items></Items>
</Order></Orders>`;
    const order = parseUnasOrderResponse(billableOrder)[0]!;
    assert.equal(order.buyerZip, "2030");
    assert.equal(order.buyerCity, "Érd");
    assert.equal(order.buyerAddress, "Tárnoki út 23.");
    assert.equal(order.buyerCountryCode, "HU");
    assert.equal(order.buyerTaxNumber, "12345678-1-42");
    assert.equal(order.invoiceStatus, "BILLABLE");
  });

  it("maps Invoice.Status 0/2 and treats a missing Invoice node as null", () => {
    const notBillable = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4</Key><Invoice><Status>0</Status></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(notBillable.invoiceStatus, "NOT_BILLABLE");
    const billed = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-5</Key><Invoice><Status>2</Status></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(billed.invoiceStatus, "BILLED");
    const noInvoiceNode = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-6</Key></Order></Orders>",
    )[0]!;
    assert.equal(noInvoiceNode.invoiceStatus, null);
  });

  it("treats an unrecognized Invoice.Status value as null rather than guessing", () => {
    const order = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4B</Key><Invoice><Status>99</Status></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(order.invoiceStatus, null);
  });

  it("parses Invoice.Number and Invoice.Url only when the Invoice node is present", () => {
    const withInvoice = parseUnasOrderResponse(
      `<Orders><Order><Key>UN-4C</Key>
<Invoice><Status>2</Status><Number>SZ-2026-100</Number><Url>https://www.szamlazz.hu/szamla/pdf/SZ-2026-100</Url></Invoice>
</Order></Orders>`,
    )[0]!;
    assert.equal(withInvoice.invoiceNumber, "SZ-2026-100");
    assert.equal(
      withInvoice.invoiceUrl,
      "https://www.szamlazz.hu/szamla/pdf/SZ-2026-100",
    );

    const withoutUrl = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4D</Key><Invoice><Status>2</Status><Number>SZ-2026-101</Number></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(withoutUrl.invoiceNumber, "SZ-2026-101");
    // Never treat a missing Url node as an empty-string "real" link.
    assert.equal(withoutUrl.invoiceUrl, null);

    const noInvoiceNode = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4E</Key></Order></Orders>",
    )[0]!;
    assert.equal(noInvoiceNode.invoiceNumber, null);
    assert.equal(noInvoiceNode.invoiceUrl, null);
  });

  it("treats a present-but-empty Invoice.Number/Invoice.Url as null, never as an empty string", () => {
    // UNAS can send the Invoice node with the Url/Number tag present but
    // empty (e.g. before a document is actually generated) - this must
    // collapse to null exactly like a missing tag, never persist as "".
    const emptyTags = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4H</Key><Invoice><Status>2</Status><Number></Number><Url></Url></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(emptyTags.invoiceNumber, null);
    assert.equal(emptyTags.invoiceUrl, null);

    // Whitespace-only content must be treated identically to empty.
    const whitespaceTags = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4I</Key><Invoice><Status>2</Status><Number>   </Number><Url>\n\t </Url></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(whitespaceTags.invoiceNumber, null);
    assert.equal(whitespaceTags.invoiceUrl, null);

    // A genuine, non-empty number/URL is unaffected by the null-collapsing.
    const realTags = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4J</Key><Invoice><Status>2</Status><Number>SZ-2026-200</Number><Url>https://www.szamlazz.hu/szamla/pdf/SZ-2026-200</Url></Invoice></Order></Orders>",
    )[0]!;
    assert.equal(realTags.invoiceNumber, "SZ-2026-200");
    assert.equal(
      realTags.invoiceUrl,
      "https://www.szamlazz.hu/szamla/pdf/SZ-2026-200",
    );
  });

  it("parses the order Coupon code, defaulting to null when absent", () => {
    const withCoupon = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4F</Key><Coupon>SUMMER10</Coupon></Order></Orders>",
    )[0]!;
    assert.equal(withCoupon.couponCode, "SUMMER10");

    const withoutCoupon = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-4G</Key></Order></Orders>",
    )[0]!;
    assert.equal(withoutCoupon.couponCode, null);
  });

  it("takes the billing name from Customer.Addresses.Invoice.Name, never from Contact.Name", () => {
    // The contact person and the invoice/billing name deliberately differ
    // here to prove the fix: an assistant (Contact) placing an order on
    // behalf of a company (Invoice.Name) must never end up billed under
    // the assistant's name.
    const order = parseUnasOrderResponse(
      `<Orders><Order><Key>UN-7</Key>
<Customer><Contact><Name>Kis Béla</Name></Contact>
<Addresses><Invoice><Name>Acropora Kft.</Name></Invoice></Addresses></Customer>
</Order></Orders>`,
    )[0]!;
    assert.equal(order.customerName, "Kis Béla");
    assert.equal(order.buyerInvoiceName, "Acropora Kft.");
  });

  it("parses EUTaxNumber and CustomerType from the invoice address", () => {
    const company = parseUnasOrderResponse(
      `<Orders><Order><Key>UN-8</Key>
<Customer><Addresses><Invoice><Name>ACME GmbH</Name>
<EUTaxNumber>DE123456789</EUTaxNumber><CustomerType>company</CustomerType>
</Invoice></Addresses></Customer></Order></Orders>`,
    )[0]!;
    assert.equal(company.buyerEuTaxNumber, "DE123456789");
    assert.equal(company.buyerCustomerType, "company");

    const privatePerson = parseUnasOrderResponse(
      `<Orders><Order><Key>UN-9</Key>
<Customer><Addresses><Invoice><Name>Kovács Anna</Name>
<CustomerType>private</CustomerType></Invoice></Addresses></Customer></Order></Orders>`,
    )[0]!;
    assert.equal(privatePerson.buyerEuTaxNumber, null);
    assert.equal(privatePerson.buyerCustomerType, "private");

    const noInvoiceAddress = parseUnasOrderResponse(
      "<Orders><Order><Key>UN-10</Key></Order></Orders>",
    )[0]!;
    assert.equal(noInvoiceAddress.buyerInvoiceName, null);
    assert.equal(noInvoiceAddress.buyerEuTaxNumber, null);
    assert.equal(noInvoiceAddress.buyerCustomerType, null);
  });

  it("normalizes an unrecognized CustomerType value to null rather than guessing", () => {
    const order = parseUnasOrderResponse(
      `<Orders><Order><Key>UN-11</Key>
<Customer><Addresses><Invoice><Name>Test</Name>
<CustomerType>some_future_type</CustomerType></Invoice></Addresses></Customer></Order></Orders>`,
    )[0]!;
    assert.equal(order.buyerCustomerType, null);
  });
});

describe("UNAS API transport policy", () => {
  class ResponseClient extends UnasApiClient {
    attempts = 0;

    constructor(private readonly response: () => Promise<Response>) {
      super();
    }

    protected override request() {
      this.attempts += 1;
      return this.response();
    }

    protected override wait() {
      return Promise.resolve();
    }
  }

  const productRequest = {
    limitStart: 0,
    limitNum: 10,
    state: "live" as const,
    contentType: "full" as const,
  };

  async function expectProductFailure(
    client: UnasApiClient,
    code: UnasApiError["code"],
  ) {
    let caught: unknown;
    try {
      await client.getProductPage("test-token", productRequest);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof UnasApiError);
    assert.equal(caught.code, code);
    assert.equal(caught.message, code);
  }

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

  it("classifies HTTP failures without exposing response bodies", async () => {
    const cases = [
      { status: 400, expected: "HTTP_4XX" as const },
      { status: 401, expected: "AUTH_REJECTED" as const },
      { status: 403, expected: "AUTH_REJECTED" as const },
      { status: 429, expected: "RATE_LIMITED" as const },
      { status: 500, expected: "HTTP_5XX" as const },
    ];
    for (const item of cases) {
      const client = new ResponseClient(() =>
        Promise.resolve(
          new Response("secret response body", { status: item.status }),
        ),
      );
      await expectProductFailure(client, item.expected);
    }
  });

  it("classifies UNAS Error XML without retaining its text", async () => {
    const secret = "secret UNAS error detail";
    for (const status of [200, 400]) {
      const client = new ResponseClient(() =>
        Promise.resolve(new Response(`<Error>${secret}</Error>`, { status })),
      );
      let caught: unknown;
      try {
        await client.getProductPage("test-token", productRequest);
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof UnasApiError);
      assert.equal(caught.code, "API_REJECTED");
      assert.equal(String(caught).includes(secret), false);
    }
  });

  it("classifies timeout and network failures", async () => {
    const timeout = new ResponseClient(() =>
      Promise.reject(new DOMException("secret timeout", "TimeoutError")),
    );
    await expectProductFailure(timeout, "TIMEOUT");
    assert.equal(timeout.attempts, 3);

    const network = new ResponseClient(() =>
      Promise.reject(new Error("secret network detail")),
    );
    await expectProductFailure(network, "NETWORK_FAILED");
    assert.equal(network.attempts, 3);
  });

  it("classifies malformed, oversized and invalid-field responses", async () => {
    await expectProductFailure(
      new ResponseClient(() =>
        Promise.resolve(new Response("<Products><Product>")),
      ),
      "XML_INVALID",
    );
    await expectProductFailure(
      new ResponseClient(() =>
        Promise.resolve(
          new Response(`<Products>${"x".repeat(10 * 1024 * 1024)}</Products>`),
        ),
      ),
      "XML_TOO_LARGE",
    );
    await expectProductFailure(
      new ResponseClient(() =>
        Promise.resolve(
          new Response(
            "<Products><Product><Id>1</Id><Sku>TEST</Sku><Prices><Price><Type>normal</Type><Gross>not-a-decimal</Gross></Price></Prices></Product></Products>",
          ),
        ),
      ),
      "FIELD_FORMAT_INVALID",
    );
  });

  it("parses known login permissions and treats unknown shapes as unknown", async () => {
    const known = new ResponseClient(() =>
      Promise.resolve(
        new Response(
          "<Login><Token>test-token</Token><ExpireTime>1999999999</ExpireTime><Permissions><Permission>getCategory</Permission><Permission>getProduct</Permission></Permissions></Login>",
        ),
      ),
    );
    assert.deepEqual((await known.login("test-key")).permissions, [
      "getCategory",
      "getProduct",
    ]);

    const unknown = new ResponseClient(() =>
      Promise.resolve(
        new Response(
          "<Login><Token>test-token</Token><ExpireTime>1999999999</ExpireTime><Permissions><Unknown>getProduct</Unknown></Permissions></Login>",
        ),
      ),
    );
    assert.equal((await unknown.login("test-key")).permissions, null);
  });

  it("uses the documented ExpireTime UNIX timestamp and ignores the human-readable Expire field", async () => {
    // Real UNAS login responses always include both fields together: `Expire`
    // is a formatted "Y.m.d H:i:s" display string in the shop's timezone,
    // and `ExpireTime` is the UNIX timestamp intended for programmatic use.
    // Earlier revisions of this parser mistakenly required exactly one of
    // the two fields to be present, which rejected every real login response.
    const withBoth = new ResponseClient(() =>
      Promise.resolve(
        new Response(
          "<Login><Token>test-token</Token><Expire>2026.07.21 00:41:51</Expire><ExpireTime>1999999999</ExpireTime></Login>",
        ),
      ),
    );
    assert.equal((await withBoth.login("test-key")).expireTime, 1999999999);

    const missingExpireTime = new ResponseClient(() =>
      Promise.resolve(
        new Response(
          "<Login><Token>test-token</Token><Expire>2026.07.21 00:41:51</Expire></Login>",
        ),
      ),
    );
    await assert.rejects(
      missingExpireTime.login("test-key"),
      /RESPONSE_SHAPE_INVALID/,
    );
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
