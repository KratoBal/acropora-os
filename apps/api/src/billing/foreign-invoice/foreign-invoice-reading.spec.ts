import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupplierInvoiceImportResult } from "@acropora/types";

import {
  parseForeignDate,
  readForeignInvoice,
  type ForeignReadingInput,
} from "./foreign-invoice-reading.js";

/**
 * A KÜLFÖLDI SZÁMLA OLVASÓJA (kártya e4c3b0fb). Minden szállító, szám és
 * adószám KITALÁLT; valódi számla nem kerül a repóba.
 *
 * MI PIROSÍT: ha egy címke nélküli vagy kétértelmű dátum bekerülne; ha egy
 * adószám számjegyei ÁFA-összegnek olvasódnának; ha a fordított adózás nem
 * 0 ÁFA lenne; ha egy nem egyező nettó + ÁFA a bruttó mellett maradna; ha a
 * szkennelt PDF-ből bármi „kiolvasódna”; ha a szöveg felülírná az illesztőt;
 * ha a banki eltérés figyelmeztetés nélkül maradna.
 */

const pairing = (
  over: Partial<ForeignReadingInput["pairing"]> = {},
): ForeignReadingInput["pairing"] => ({
  number: "PAIR-1",
  supplierName: "Párosítás szerinti név",
  date: "2026-10-01",
  gross: null,
  currency: "EUR",
  debits: [],
  ...over,
});

const EN_SAAS = [
  "Invoice",
  "Invoice number KITALALT-0001",
  "Date of issue October 3, 2026",
  "Date due October 3, 2026",
  "Kitalált AI LLC",
  "Bill to Acropora Kft.",
  "EU VAT IE9999999XX",
  "Description | Qty | Unit price | Amount",
  "Kitalált Plus Subscription | 1 | $20.00 | $20.00",
  "Subtotal | $20.00",
  "Tax (0%) | $0.00",
  "Amount due | $20.00 USD",
];

const DE = [
  "Rechnung",
  "Rechnungsnummer: RE-2026-0815",
  "Rechnungsdatum: 03.10.2026",
  "Leistungsdatum: 30.09.2026",
  "Fällig: 17.10.2026",
  "Kitalált Aquaristik GmbH",
  "USt-IdNr.: DE 999 999 999",
  "Pos | Artikel | Menge | Einzelpreis | Gesamt",
  "1 | Korallenfutter | 2 | 50,00 € | 100,00 €",
  "Summe netto | 100,00 €",
  "MwSt 19 % | 19,00 €",
  "Gesamtbetrag | 119,00 €",
];

const NL_REVERSE = [
  "Factuur",
  "Factuurdatum: 3 oktober 2026",
  "Vervaldatum: 2 november 2026",
  "Kitalált Koraal B.V.",
  "BTW-nummer: NL999999999B01",
  "Subtotaal | € 250,00",
  "BTW verlegd",
];

describe("parseForeignDate", () => {
  it("reads the unambiguous forms", () => {
    assert.equal(parseForeignDate("2026-10-03"), "2026-10-03");
    assert.equal(parseForeignDate("03.10.2026"), "2026-10-03");
    assert.equal(parseForeignDate("October 3, 2026"), "2026-10-03");
    assert.equal(parseForeignDate("3. Oktober 2026"), "2026-10-03");
    assert.equal(parseForeignDate("3 oktober 2026"), "2026-10-03");
    assert.equal(parseForeignDate("2026. október 3."), "2026-10-03");
    assert.equal(parseForeignDate("25/10/2026"), "2026-10-25");
  });

  it("leaves an ambiguous slashed date and an impossible date empty", () => {
    assert.equal(parseForeignDate("03/04/2026"), null);
    assert.equal(parseForeignDate("31.02.2026"), null);
  });
});

describe("readForeignInvoice", () => {
  it("an English SaaS invoice: number, dates, net, zero tax, gross and currency", () => {
    const { values, sources, warnings, hasText } = readForeignInvoice({
      lines: EN_SAAS,
      adapter: null,
      pairing: pairing({ currency: "USD" }),
    });
    assert.equal(hasText, true);
    assert.equal(values.documentNumber, "KITALALT-0001");
    assert.equal(values.issueDate, "2026-10-03");
    assert.equal(values.dueDate, "2026-10-03");
    assert.equal(values.fulfillmentDate, null, "no supply label, no date");
    assert.equal(values.currency, "USD");
    assert.equal(values.netAmount, "20.00");
    assert.equal(values.vatAmount, "0.00");
    assert.equal(values.grossAmount, "20.00");
    assert.equal(sources.netAmount, "TEXT");
    assert.equal(sources.supplierName, "PAIRING");
    assert.deepEqual(warnings, []);
  });

  it("a German invoice: supply date, VAT, and the tax ID is not read as VAT", () => {
    const { values } = readForeignInvoice({
      lines: DE,
      adapter: null,
      pairing: pairing(),
    });
    assert.equal(values.issueDate, "2026-10-03");
    assert.equal(values.fulfillmentDate, "2026-09-30");
    assert.equal(values.dueDate, "2026-10-17");
    assert.equal(values.netAmount, "100.00");
    assert.equal(values.vatAmount, "19.00");
    assert.equal(values.grossAmount, "119.00");
    assert.equal(values.currency, "EUR");
  });

  it("a tax ID glued to letters is not a VAT amount", () => {
    // csak előtte áll betű: az osztrák alak, utána semmi
    const { values } = readForeignInvoice({
      lines: ["VAT ATU99999999", "Subtotal 20.00 EUR", "Amount due 20.00 EUR"],
      adapter: null,
      pairing: pairing(),
    });
    // a nettó és a bruttó különbsége, nem az adószám
    assert.equal(values.vatAmount, "0.00");
  });

  it("a spaced German VAT ID is not a VAT amount either", () => {
    // MwSt sor nélkül: itt nincs második érték, ami a kétértelműség miatt kioltaná
    const { values } = readForeignInvoice({
      lines: [
        "USt-IdNr.: DE 999 999 999",
        "Summe netto | 100,00 €",
        "Gesamtbetrag | 119,00 €",
      ],
      adapter: null,
      pairing: pairing(),
    });
    assert.equal(values.vatAmount, "19.00");
  });

  it("a Dutch reverse-charge invoice: zero VAT, the gross from the bank pairing", () => {
    const { values, sources } = readForeignInvoice({
      lines: NL_REVERSE,
      adapter: null,
      pairing: pairing({ gross: "250.00" }),
    });
    assert.equal(values.issueDate, "2026-10-03");
    assert.equal(values.dueDate, "2026-11-02");
    assert.equal(values.netAmount, "250.00");
    assert.equal(values.vatAmount, "0.00");
    assert.equal(sources.vatAmount, "TEXT");
    assert.equal(values.grossAmount, "250.00");
    assert.equal(sources.grossAmount, "PAIRING");
  });

  it("net + VAT that does not give the gross: both empty, with a warning", () => {
    const { values, sources, warnings } = readForeignInvoice({
      lines: ["Subtotal 100.00 EUR", "VAT 19.00 EUR"],
      adapter: null,
      pairing: pairing({ gross: "200.00" }),
    });
    assert.equal(values.netAmount, null);
    assert.equal(values.vatAmount, null);
    assert.equal(sources.netAmount, undefined);
    assert.equal(values.grossAmount, "200.00");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /nem adja ki a bruttót/);
  });

  it("a scanned PDF: nothing is read from it, the pairing fills what it knows", () => {
    const { values, sources, warnings, hasText } = readForeignInvoice({
      lines: null,
      adapter: null,
      pairing: pairing({ gross: "50.00" }),
    });
    assert.equal(hasText, false);
    assert.equal(values.netAmount, null);
    assert.equal(values.vatAmount, null);
    assert.equal(values.fulfillmentDate, null);
    assert.equal(values.documentNumber, "PAIR-1");
    assert.ok(Object.values(sources).every((source) => source === "PAIRING"));
    assert.match(warnings[0]!, /nincs szövegrétege/);
  });

  it("the supplier adapter wins over the text", () => {
    const adapter = {
      supplier: { name: "Illesztő GmbH", vatId: "DE111111111", country: "DE" },
      invoiceNumber: "ADP-7",
      invoiceDate: "2026-09-20",
      dueDate: null,
      currency: "EUR",
      netTotal: 100,
      lines: [],
    } as unknown as SupplierInvoiceImportResult;
    const { values, sources } = readForeignInvoice({
      lines: DE,
      adapter,
      pairing: pairing(),
    });
    assert.equal(values.supplierName, "Illesztő GmbH");
    assert.equal(values.documentNumber, "ADP-7");
    assert.equal(values.issueDate, "2026-09-20");
    assert.equal(sources.issueDate, "ADAPTER");
    // amit az illesztő nem ad, a szöveg tölti
    assert.equal(values.dueDate, "2026-10-17");
    assert.equal(sources.dueDate, "TEXT");
  });

  it("an ambiguous issue date falls back to the pairing's date", () => {
    const { values, sources } = readForeignInvoice({
      lines: ["Invoice date 03/04/2026", "Amount due 10.00 EUR"],
      adapter: null,
      pairing: pairing(),
    });
    assert.equal(values.issueDate, "2026-10-01");
    assert.equal(sources.issueDate, "PAIRING");
  });

  it("warns when the gross read from the text differs from the bank debits in the same currency", () => {
    const { warnings } = readForeignInvoice({
      lines: [...NL_REVERSE, "Amount due 250.00 EUR"],
      adapter: null,
      pairing: pairing({
        gross: "250.00",
        debits: [{ amount: "260.00", currency: "EUR" }],
      }),
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /eltér a banki terheléstől/);
  });

  it("does not compare the pairing's own gross with the debit (a card payment's gross IS the debit)", () => {
    const { values, sources, warnings } = readForeignInvoice({
      lines: NL_REVERSE,
      adapter: null,
      pairing: pairing({
        gross: "250.00",
        debits: [{ amount: "260.00", currency: "EUR" }],
      }),
    });
    assert.equal(values.grossAmount, "250.00");
    assert.equal(sources.grossAmount, "PAIRING");
    assert.deepEqual(warnings, []);
  });

  it("a supplier adapter that saw a proforma is not taken over", () => {
    const adapter = {
      supplier: { name: "Díjbekérő GmbH", vatId: "DE222222222", country: "DE" },
      documentKind: "PROFORMA",
      invoiceNumber: "PF-1",
      invoiceDate: "2026-09-01",
      dueDate: null,
      currency: "EUR",
      netTotal: 999,
      lines: [],
    } as unknown as SupplierInvoiceImportResult;
    const { values, sources, warnings } = readForeignInvoice({
      lines: null,
      adapter,
      pairing: pairing(),
    });
    assert.equal(values.netAmount, null);
    assert.equal(values.documentNumber, "PAIR-1");
    assert.ok(!Object.values(sources).includes("ADAPTER"));
    assert.ok(warnings.some((w) => /díjbekérőnek látta/.test(w)));
  });

  it("does not compare with a debit in another currency", () => {
    const { warnings } = readForeignInvoice({
      lines: NL_REVERSE,
      adapter: null,
      pairing: pairing({
        gross: "250.00",
        debits: [{ amount: "98000", currency: "HUF" }],
      }),
    });
    assert.deepEqual(warnings, []);
  });
});
