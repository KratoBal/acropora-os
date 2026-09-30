import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCiiInvoiceXml } from "./cii-invoice.parser.js";
import { SupplierInvoiceImportError } from "./supplier-invoice-import.error.js";

/**
 * Szintetikus CII számla: a szerkezet a valódi ZUGFeRD-számláké (a Hertlein
 * 2025 óta ilyet küld), minden érték kitalált. A vevő, a kapcsolattartó és a
 * bankadat SZÁNDÉKOSAN benne van: a teszt azt méri, hogy a beolvasó ezeket
 * nem adja tovább.
 */
function cii({
  typeCode = "380",
  root = "rsm:CrossIndustryInvoice",
}: { typeCode?: string; root?: string } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>990001</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260925</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:GlobalID schemeID="0160">4011444815934</ram:GlobalID>
        <ram:SellerAssignedID>81593</ram:SellerAssignedID>
        <ram:Name>Dupla Marin Coral Plugs 10 St., SB</ram:Name>
        <ram:Description>Lange Beschreibung &lt;br&gt; UVP 8,49 EUR</ram:Description>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>4.5000</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">3.0000</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>13.50</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>2</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:SellerAssignedID>e3591100</ram:SellerAssignedID>
        <ram:Name>Eheim 3591100 rapidCleaner 58 cm   lang</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:GrossPriceProductTradePrice>
          <ram:ChargeAmount>9.2000</ram:ChargeAmount>
          <ram:AppliedTradeAllowanceCharge>
            <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
            <ram:ActualAmount>0.9200</ram:ActualAmount>
          </ram:AppliedTradeAllowanceCharge>
        </ram:GrossPriceProductTradePrice>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>8.2800</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="KGM">3.0000</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>24.84</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>3</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:SellerAssignedID>z1</ram:SellerAssignedID>
        <ram:Name>Frachtkosten (anteilig)</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>80.0000</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1.0000</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>80.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Minta Aquaristik e.K.</ram:Name>
        <ram:DefinedTradeContact>
          <ram:PersonName>Kitalalt Kapcsolattarto</ram:PersonName>
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>0911-5550000</ram:CompleteNumber></ram:TelephoneUniversalCommunication>
        </ram:DefinedTradeContact>
        <ram:PostalTradeAddress><ram:PostcodeCode>90000</ram:PostcodeCode><ram:CityName>Mintastadt</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">999/999/99999</ram:ID></ram:SpecifiedTaxRegistration>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE 123456789</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Kitalalt Vevo Kft</ram:Name>
        <ram:PostalTradeAddress><ram:LineOne>Kitalalt utca 1</ram:LineOne><ram:CountryID>HU</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">HU99999999</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE00999999999999999999</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261002</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>118.34</ram:LineTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</${root}>`;
}

describe("parseCiiInvoiceXml", () => {
  it("reads the header and the seller, never the buyer, the contact or the bank", () => {
    const result = parseCiiInvoiceXml(cii());
    assert.equal(result.format, "XML");
    assert.equal(result.invoiceNumber, "990001");
    assert.equal(result.invoiceDate, "2026-09-25");
    assert.equal(result.dueDate, "2026-10-02");
    assert.equal(result.currency, "EUR");
    assert.equal(result.netTotal, 118.34);
    assert.deepEqual(result.supplier, {
      name: "Minta Aquaristik e.K.",
      vatId: "DE123456789",
      country: "DE",
    });
    const all = JSON.stringify(result);
    for (const secret of [
      "Kitalalt Vevo",
      "Kitalalt utca",
      "HU99999999",
      "Kitalalt Kapcsolattarto",
      "0911-5550000",
      "DE00999999999999999999",
      "999/999/99999",
    ])
      assert.ok(!all.includes(secret), `a kimenetben nem lehet: ${secret}`);
  });

  it("reads each line: supplier code, EAN, text, quantity, unit, price, discount", () => {
    const [plugs, cleaner, freight] = parseCiiInvoiceXml(cii()).lines;
    assert.deepEqual(plugs, {
      lineNumber: 1,
      supplierSku: "81593",
      ean: "4011444815934",
      description: "Dupla Marin Coral Plugs 10 St., SB",
      quantity: 3,
      unit: "db",
      unitNet: 4.5,
      discountPercent: null,
      lineNet: 13.5,
      isCharge: false,
    });
    // a gross price with an allowance is the price BEFORE discount, as the editor keeps it
    assert.equal(cleaner!.unitNet, 9.2);
    assert.equal(cleaner!.discountPercent, 10);
    assert.equal(cleaner!.unit, "kg");
    assert.equal(cleaner!.ean, null);
    assert.equal(cleaner!.description, "Eheim 3591100 rapidCleaner 58 cm lang");
    assert.equal(freight!.isCharge, true);
    assert.equal(freight!.supplierSku, "z1");
  });

  it("refuses a credit note, a non-CII XML and a DOCTYPE", () => {
    assert.throws(
      () => parseCiiInvoiceXml(cii({ typeCode: "381" })),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "CREDIT_NOTE",
    );
    assert.throws(
      () => parseCiiInvoiceXml(cii({ root: "Invoice" })),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "XML_NOT_CII",
    );
    assert.throws(
      () => parseCiiInvoiceXml(`<!DOCTYPE x [<!ENTITY a "b">]>${cii()}`),
      (error: unknown) =>
        error instanceof SupplierInvoiceImportError &&
        error.code === "XML_INVALID",
    );
  });

  /*
    CoralSands (2026-09-30): minden ertek CDATA-ban, es a CDATA eddig elveszett:
    a szamlaszam, az elado neve es a sorok cikkszama uresen jott at, hiba nelkul.
    MI PIROSIT: ha a CDATA tartalma megint nem lesz az elem szovege.
  */
  it("reads a value wrapped in CDATA as the element's text", () => {
    const wrapped = cii()
      .replace(
        "<ram:ID>990001</ram:ID>",
        "<ram:ID><![CDATA[990001]]></ram:ID> <!-- Rechnungsnummer -->",
      )
      .replace(
        "<ram:SellerAssignedID>81593</ram:SellerAssignedID>",
        "<ram:SellerAssignedID><![CDATA[81593]]></ram:SellerAssignedID>",
      )
      .replace(
        "<ram:Name>Dupla Marin Coral Plugs 10 St., SB</ram:Name>",
        "<ram:Name><![CDATA[Dupla Marin Coral Plugs 10 St., SB]]></ram:Name>",
      );
    // the fixture really wraps all three, or the test would pass without CDATA
    for (const value of ["CDATA[990001]", "CDATA[81593]", "CDATA[Dupla Marin"])
      assert.ok(wrapped.includes(value), `not wrapped: ${value}`);
    const result = parseCiiInvoiceXml(wrapped);
    assert.equal(result.invoiceNumber, "990001");
    assert.equal(result.lines[0]!.supplierSku, "81593");
    assert.equal(
      result.lines[0]!.description,
      "Dupla Marin Coral Plugs 10 St., SB",
    );
  });

  // acrobot dontese (2026-09-30): a 326 reszszamla rendes szamla; a proforma
  // (325) tovabbra is figyelmeztet. MI PIROSIT: ha a 326 megint figyelmeztet,
  // vagy a 325 mar nem.
  it("a partial invoice (326) is a normal invoice, a proforma (325) still warns", () => {
    const warns = (typeCode: string) =>
      parseCiiInvoiceXml(cii({ typeCode })).warnings.some((w) =>
        w.includes("típuskódja"),
      );
    assert.equal(warns("380"), false);
    assert.equal(warns("326"), false);
    assert.equal(warns("325"), true);
  });

  // acrobot dontese (2026-09-30): a Varhato beerkezes a rendelesszamra is
  // kulcsol. MI PIROSIT: ha a rendelesszam nem olvasodik, vagy kitalalt lesz.
  it("reads the buyer's order reference, and null when there is none", () => {
    assert.equal(parseCiiInvoiceXml(cii()).orderReference, null);
    const withOrder = cii().replace(
      "<ram:SellerTradeParty>",
      "<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID> <![CDATA[AB67993]]> </ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument><ram:SellerTradeParty>",
    );
    assert.ok(withOrder.includes("AB67993"), "the fixture really carries it");
    assert.equal(parseCiiInvoiceXml(withOrder).orderReference, "AB67993");
  });

  it("does not depend on the namespace prefixes", () => {
    const renamed = cii()
      .replaceAll("ram:", "x:")
      .replaceAll("rsm:", "y:")
      .replaceAll("xmlns:ram", "xmlns:x")
      .replaceAll("xmlns:rsm", "xmlns:y");
    const result = parseCiiInvoiceXml(renamed);
    assert.equal(result.lines.length, 3);
    assert.equal(result.supplier.vatId, "DE123456789");
  });
});
