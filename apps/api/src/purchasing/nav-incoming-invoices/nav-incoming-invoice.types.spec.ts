import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toNavIncomingInvoiceDetail,
  type NavIncomingInvoiceRow,
} from "./nav-incoming-invoice.types.js";

/**
 * A MÁR ELTÁROLT SZÁMLÁK SORSZÁMA (2026-09-28).
 *
 * A parser 2026-09-28 előtti alakja a hiányzó sorszámot 0-ként írta a
 * `parsedData` mezőbe, és a tárolt adatot nem írjuk át. A részletező válasz
 * kiolvasáskor szűr: a 0 itt is `null`. Különben a web az EU-szerkesztőben
 * visszaküldené, és a `navLineNumber` DTO-kapuja (`@Min(1)`) 400-zal
 * utasítaná el a mentést.
 *
 * A kontroll a normál sorszám: egy mindig-null leképezés a 0-s esetet
 * zölden hagyná.
 */
function rowWithLines(lines: unknown[]): NavIncomingInvoiceRow {
  return {
    id: "n1",
    navInvoiceNumber: "FM-1",
    supplierTaxNumber: "12345678",
    supplierName: "X Kft.",
    invoiceIssueDate: new Date("2026-09-01T00:00:00Z"),
    invoiceDeliveryDate: null,
    paymentDate: null,
    currency: "HUF",
    invoiceNetAmount: null,
    invoiceVatAmount: null,
    insDate: new Date("2026-09-01T00:00:00Z"),
    status: "DATA_FETCHED",
    parsedData: {
      supplierName: "X Kft.",
      currency: "HUF",
      lines,
    } as NavIncomingInvoiceRow["parsedData"],
    errorCode: null,
    purchaseInvoiceId: null,
  };
}

const line = (lineNumber: unknown) => ({
  lineNumber,
  description: "Só",
  quantity: "1",
  unit: "db",
  lineNetAmount: "8000",
});

describe("toNavIncomingInvoiceDetail: a tétel sorszáma", () => {
  it("a régi, tárolt 0 null-ként megy ki", () => {
    const detail = toNavIncomingInvoiceDetail(rowWithLines([line(0)]));
    assert.equal(detail.lines[0]?.lineNumber, null);
  });

  it("a normál sorszám változatlan (kontroll)", () => {
    const detail = toNavIncomingInvoiceDetail(rowWithLines([line(3)]));
    assert.equal(detail.lines[0]?.lineNumber, 3);
  });

  it("a tárolt null null marad", () => {
    const detail = toNavIncomingInvoiceDetail(rowWithLines([line(null)]));
    assert.equal(detail.lines[0]?.lineNumber, null);
  });
});

/**
 * A DÍJSOR A NAV-BÓL JÖVŐ SORON IS DÍJSOR (Balázs, 2026-09-29 11:49 UTC: a
 * kialakított szabály minden szállítóra). A fájlból beolvasott számlákon a
 * közös `isChargeDescription` eddig is jelölte a szállítási és fuvar sorokat;
 * a NAV-ból jövőkön semmi, ezért ott egy "Szállítási díj" termék-javaslatot
 * kért.
 *
 * A NEGATÍV KONTROLL termék, amelyben a szó csak RÉSZ: egy túl tág szabály
 * egy valódi termékről venné el a javaslatot, és az csendes hiba lenne.
 */
const described = (description: string) => ({ ...line(1), description });

describe("toNavIncomingInvoiceDetail: a díjsor", () => {
  it("a Szállítási díj és a Fuvar sor díjsor", () => {
    const detail = toNavIncomingInvoiceDetail(
      rowWithLines([
        described("Szállítási díj"),
        described("Fuvar"),
        described("Fuvardíj Budapest"),
      ]),
    );
    assert.deepEqual(
      detail.lines.map((l) => l.isCharge),
      [true, true, true],
    );
  });

  it("a termék, amelyben a szó csak rész, NEM díjsor (negatív kontroll)", () => {
    const detail = toNavIncomingInvoiceDetail(
      rowWithLines([
        described("Transzportzsák halszállításhoz 60x30 cm"),
        described("Portobello élőkő 1 kg"),
        described("Só"),
      ]),
    );
    assert.deepEqual(
      detail.lines.map((l) => l.isCharge),
      [false, false, false],
    );
  });
});
