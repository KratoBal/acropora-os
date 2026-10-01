import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  looksLikeInvoice,
  looksLikeProforma,
  readInvoiceText,
} from "./invoice-text.js";

/**
 * SZINTETIKUS SOROK: a valódi mintán mért kalibráció a következő szelet. Ezek
 * a tesztek azt tartják, amit a szabály tud, nem azt, hogy a valóságban mennyit
 * talál.
 */
describe("looksLikeInvoice", () => {
  it("takes the invoice word on its own, not inside the bank account word", () => {
    assert.equal(looksLikeInvoice("SZÁMLA\nSorszám: SZ-1"), true);
    assert.equal(looksLikeInvoice("Invoice #123"), true);
    assert.equal(
      looksLikeInvoice("Szerződés\nBankszámlaszám: 11773016-11111018"),
      false,
    );
    assert.equal(looksLikeProforma("DÍJBEKÉRŐ\nSorszám: D-1"), true);
    assert.equal(looksLikeProforma("Számla\nSorszám: SZ-1"), false);
  });
});

describe("readInvoiceText", () => {
  const SUPPLIER = "Eladó: Szállító Kft. Adószám: 12345678-2-42";
  const US = "Vevő: Acropora Kft. Adószám: 23916229-2-13";

  it("takes the supplier's NAV number from the text, whatever the layout, when no label says otherwise", () => {
    assert.deepEqual(
      readInvoiceText([SUPPLIER, US, "Kelt: 2026.08.03.", "KS26/09229"], {
        navNumbers: (base) =>
          base === "12345678" ? ["KS26/09229", "KS26/0922"] : [],
      }),
      {
        invoiceNumber: "KS26/09229",
        numberFrom: "NAV",
        supplierTaxNumber: "12345678-2-42",
      },
    );
  });

  it("lets the labelled number decide when the text lists other invoices of the supplier (the MVM bill)", () => {
    const lines = [
      SUPPLIER,
      US,
      "Számla sorszáma: 845114371429",
      "Korábbi számlák sorszáma és végösszege",
      "846602789443 | 267.429",
    ];
    const both = ["846602789443", "845114371429"];
    assert.deepEqual(readInvoiceText(lines, { navNumbers: () => both }), {
      invoiceNumber: "845114371429",
      numberFrom: "NAV",
      supplierTaxNumber: "12345678-2-42",
    });
    // a saját száma még nincs a NAV-ban, a hivatkozott régi igen: az nem találat
    assert.deepEqual(
      readInvoiceText(lines, { navNumbers: () => ["846602789443"] }),
      {
        invoiceNumber: "845114371429",
        numberFrom: "LABEL",
        supplierTaxNumber: "12345678-2-42",
      },
    );
  });

  it("reads the number next to its label, and never a bank account for one", () => {
    assert.deepEqual(
      readInvoiceText([
        SUPPLIER,
        US,
        "Bankszámlaszám: 11709002-20624460-00000000",
        "Számla sorszáma: SZ-2026/00123",
      ]),
      {
        invoiceNumber: "SZ-2026/00123",
        numberFrom: "LABEL",
        supplierTaxNumber: "12345678-2-42",
      },
    );
    assert.equal(
      readInvoiceText(["Számlaszám: 11709002-20624460-00000000"]).invoiceNumber,
      null,
    );
    // a címke önálló szó: a „bankszámlaszám” utáni érték nem számlaszám
    assert.equal(
      readInvoiceText(["Bankszámlaszám: 12345678"]).invoiceNumber,
      null,
    );
  });

  it("takes a number from the file name only when the text holds it too", () => {
    assert.deepEqual(
      readInvoiceText([SUPPLIER, "FoxPost számla", "FX01015386"], {
        fileName: "FX01015386.pdf",
      }).invoiceNumber,
      "FX01015386",
    );
    assert.equal(
      readInvoiceText([SUPPLIER, "számla"], { fileName: "FX01015386.pdf" })
        .invoiceNumber,
      null,
    );
  });

  it("prefers the full Hungarian tax number to an id fragment that looks European (FleetCor)", () => {
    assert.equal(
      readInvoiceText([
        "Ügyfélazonosító: HU00008659",
        "Kibocsátó: FleetCor Hungary Kft. Adószám: 25103272-2-42",
        "Vevő: Acropora Kft. Adószám: 23916229-2-42",
      ]).supplierTaxNumber,
      "25103272-2-42",
    );
  });

  it("does not take a bank code or a word for a VAT number", () => {
    assert.equal(
      readInvoiceText([
        "BIC: DRESDEFF510",
        "ORDER CONFIRMATION",
        "VAT: DE152405660",
      ]).supplierTaxNumber,
      "DE152405660",
    );
  });
});
