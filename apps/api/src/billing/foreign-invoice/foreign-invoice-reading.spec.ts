import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupplierInvoiceImportResult } from "@acropora/types";

import {
  hostedInvoiceNumber,
  hostedInvoiceSupplier,
  labelledInvoiceNumber,
  parseForeignDate,
  readForeignInvoice,
  supplierNameFromText,
  tableRowFields,
  totalsRow,
  vatLineEuNumber,
  vatSummaryTable,
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

  // KÁRTYA dbab22cd, HARMADIK KÖR: a kétjegyű év és a magyar hónap-rövidítés
  it("reads a two-digit year after the day, and the Hungarian month abbreviations", () => {
    assert.equal(parseForeignDate("14/09/26"), "2026-09-14");
    assert.equal(parseForeignDate("2026. okt. 31."), "2026-10-31");
    assert.equal(parseForeignDate("2026. szept. 30."), "2026-09-30");
    assert.equal(parseForeignDate("2026. márc. 3."), "2026-03-03");
  });

  it("keeps the same ambiguity rule for the two-digit year, and does not take a longer number for a date", () => {
    assert.equal(parseForeignDate("03/04/26"), null);
    assert.equal(parseForeignDate("12/12/26"), "2026-12-12");
    assert.equal(parseForeignDate("14/09/2026"), "2026-09-14");
    // a part number or a fraction is not a date
    assert.equal(parseForeignDate("7/8/261"), null);
    assert.equal(parseForeignDate("1/2/3/26"), null);
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

  it("net + VAT that does not give the gross read from the invoice: both empty, with a warning", () => {
    const { values, sources, warnings } = readForeignInvoice({
      lines: ["Subtotal 100.00 EUR", "VAT 19.00 EUR", "Amount due 200.00 EUR"],
      adapter: null,
      pairing: pairing(),
    });
    assert.equal(values.netAmount, null);
    assert.equal(values.vatAmount, null);
    assert.equal(sources.netAmount, undefined);
    assert.equal(values.grossAmount, "200.00");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /nem adja ki a bruttót/);
  });

  /*
    A PÁROSÍTÁS BRUTTÓJA GYENGE FORRÁS (barracuda, acrobot 27658). MI PIROSÍT:
    ha belőle ÁFA számolódna (akkor a nettó + ÁFA = bruttó mindig zöld); ha
    más devizában is átvennénk; ha egy ellentmondásnál a számláról olvasott
    nettót és ÁFÁ-t dobnánk el a gyenge bruttó helyett.
  */
  it("adapter net + pairing gross without a VAT label: no VAT is derived", () => {
    const adapter = {
      supplier: { name: "Illesztő GmbH", vatId: "DE111111111", country: "DE" },
      invoiceNumber: "ADP-8",
      invoiceDate: "2026-09-20",
      dueDate: null,
      currency: "EUR",
      netTotal: 100,
      lines: [],
    } as unknown as SupplierInvoiceImportResult;
    // a párosítás bruttója itt az illesztő nettója
    const { values, sources } = readForeignInvoice({
      lines: null,
      adapter,
      pairing: pairing({ gross: "100.00", currency: "EUR" }),
    });
    assert.equal(values.netAmount, "100.00");
    assert.equal(values.grossAmount, "100.00");
    assert.equal(sources.grossAmount, "PAIRING");
    assert.equal(values.vatAmount, null);
    assert.equal(sources.vatAmount, undefined);
  });

  it("an EU supplier whose gross comes from the pairing: VAT stays empty, and the warning names why (acrobot 34653)", () => {
    const adapter = {
      supplier: {
        name: "De Jong Marinelife B.V.",
        vatId: "NL802708705B01",
        country: "NL",
      },
      invoiceNumber: "26007910",
      invoiceDate: "2026-10-02",
      dueDate: null,
      currency: "EUR",
      netTotal: 1703.08,
      lines: [],
    } as unknown as SupplierInvoiceImportResult;
    const { values, warnings } = readForeignInvoice({
      lines: null,
      adapter,
      pairing: pairing({ gross: "1703.08", currency: "EUR" }),
    });
    assert.equal(values.vatAmount, null);
    assert.ok(
      warnings.some((w) =>
        /Közösségi beszerzésnek látszik \(NL802708705B01.*a bruttó a banki párosításból jön/.test(
          w,
        ),
      ),
    );
  });

  it("USD text with a HUF pairing: the HUF amount is not taken as the gross", () => {
    const { values } = readForeignInvoice({
      // ÁFA-sor nélkül: itt csak a deviza-feltétel véd, az ellentmondás-szabály nem
      lines: ["Invoice", "Subtotal $20.00"],
      adapter: null,
      pairing: pairing({ gross: "7980", currency: "HUF" }),
    });
    assert.equal(values.currency, "USD");
    assert.equal(values.grossAmount, null);
    assert.equal(values.netAmount, "20.00");
  });

  it("a card debit as the pairing gross next to a net label: VAT stays empty", () => {
    const { values, sources } = readForeignInvoice({
      lines: ["Invoice", "Subtotal 20.00 USD"],
      adapter: null,
      pairing: pairing({
        gross: "20.00",
        currency: "USD",
        debits: [{ amount: "20.00", currency: "USD" }],
      }),
    });
    assert.equal(values.netAmount, "20.00");
    assert.equal(values.grossAmount, "20.00");
    assert.equal(sources.grossAmount, "PAIRING");
    assert.equal(values.vatAmount, null);
  });

  it("when net + VAT from the invoice contradict the pairing gross, the gross goes", () => {
    const { values, warnings } = readForeignInvoice({
      lines: ["Subtotal 100.00 EUR", "VAT 19.00 EUR"],
      adapter: null,
      pairing: pairing({ gross: "100.00" }),
    });
    assert.equal(values.netAmount, "100.00");
    assert.equal(values.vatAmount, "19.00");
    assert.equal(values.grossAmount, null);
    assert.match(warnings[0]!, /a bruttót kézzel kell beírni/);
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

/*
  A TÁROLHATÓSÁG ŐRE (kulfoldi-szamla-olvasas-hiba, 2026-10-14). MI PIROSÍT: ha
  egy négybetűs deviza, egy 16 egész jegynél hosszabb összeg vagy egy nem
  naptári dátum az olvasatban maradna (az írás akkor P2000 / P2020-szal bukik,
  és élesen 24 futást állított meg); ha a kiürített mező forrása megmaradna;
  ha egy jó érték is kiürülne.
*/
describe("what does not fit its column is left empty, with a warning", () => {
  const adapter = (over: Record<string, unknown>) =>
    ({
      supplier: { name: "Illesztő GmbH", vatId: "DE111111111", country: "DE" },
      invoiceNumber: "ADP-9",
      invoiceDate: "2026-09-20",
      dueDate: null,
      currency: "EUR",
      netTotal: 100,
      lines: [],
      ...over,
    }) as unknown as SupplierInvoiceImportResult;

  it("a currency that is not a three-letter code", () => {
    const { values, sources, warnings } = readForeignInvoice({
      lines: null,
      adapter: adapter({ currency: "euro" }),
      pairing: pairing({ currency: "EUR" }),
    });
    // az illesztő „EURO”-ja nem foglalja el a mezőt; a párosítás tárolható EUR-ja kitölti
    assert.equal(values.currency, "EUR");
    assert.equal(sources.currency, "PAIRING");
    // a figyelmeztetés nem kér kézi kitöltést, hanem megmondja, mi áll helyette (barracuda #1689)
    assert.ok(
      warnings.includes(
        "A kiolvasott deviza („EURO”) nem tárolható; helyette a(z) „Banki párosításból” értéke áll.",
      ),
    );
    // párosítás nélküli devizával a mező üres marad
    const alone = readForeignInvoice({
      lines: null,
      adapter: adapter({ currency: "euro" }),
      pairing: pairing({ currency: "" }),
    });
    assert.equal(alone.values.currency, null);
    assert.equal(alone.sources.currency, undefined);
    assert.ok(
      alone.warnings.includes(
        "A kiolvasott deviza („EURO”) nem tárolható; kézzel kell megadni.",
      ),
    );
  });

  it("an amount past Decimal(18,2), and one that is not a number", () => {
    const big = readForeignInvoice({
      lines: null,
      adapter: adapter({ netTotal: 12345678901234567 }),
      pairing: pairing(),
    });
    assert.equal(big.values.netAmount, null);
    assert.ok(big.warnings.some((w) => w.includes("nettó")));
    const nan = readForeignInvoice({
      lines: null,
      adapter: adapter({ netTotal: Number.NaN }),
      pairing: pairing(),
    });
    assert.equal(nan.values.netAmount, null);
    // a határon belül marad: 16 egész jegy
    const edge = readForeignInvoice({
      lines: null,
      adapter: adapter({ netTotal: 1234567890123456 }),
      pairing: pairing(),
    });
    assert.equal(edge.values.netAmount, "1234567890123456.00");
  });

  it("a date that is not a calendar day", () => {
    const { values, warnings } = readForeignInvoice({
      lines: null,
      adapter: adapter({ invoiceDate: "20.09.2026", dueDate: "2026-02-30" }),
      pairing: pairing(),
    });
    // az illesztő kelte nem foglalja el a mezőt, a párosítás dátuma tölti ki
    assert.equal(values.issueDate, "2026-10-01");
    assert.equal(values.dueDate, null);
    assert.ok(
      warnings.includes(
        "A kiolvasott kelt („20.09.2026”) nem tárolható; helyette a(z) „Banki párosításból” értéke áll.",
      ),
    );
    assert.ok(
      warnings.includes(
        "A kiolvasott fizetési határidő („2026-02-30”) nem tárolható; kézzel kell megadni.",
      ),
    );
  });

  it("a good reading is untouched", () => {
    const { values, warnings } = readForeignInvoice({
      lines: null,
      adapter: adapter({}),
      pairing: pairing(),
    });
    assert.equal(values.currency, "EUR");
    assert.equal(values.netAmount, "100.00");
    assert.equal(values.issueDate, "2026-09-20");
    // a szkennelt PDF figyelmeztetése marad, tárolhatósági nem jön
    assert.equal(warnings.filter((w) => w.includes("nem tárolható")).length, 0);
  });
});

/**
 * AZ OSSZESITO SOR ("Összesen: | nettó | áfa | bruttó", kártya dbab22cd, első kísérlet). Kitalált
 * szövegek: a valódi mintákból csak a SOR ALAKJA jött (a hangoló félen mért), érték nem.
 */
describe("the totals row of a Hungarian invoice table", () => {
  const HEADER =
    "Megnevezés | Menny. | Egységár | Nettó ár | ÁFA | ÁFA érték | Bruttó ár";
  const ROW = "Kitalált termék | 2 db | 1 000 | 2 000 | 27% | 540 | 2 540";
  const read = (lines: string[]) =>
    readForeignInvoice({
      lines,
      adapter: null,
      pairing: pairing({
        number: "",
        supplierName: "",
        date: "",
        currency: "",
      }),
    });

  it("reads net, VAT and gross from 'Összesen: | a | b | c' under a net-to-gross header", () => {
    const { values, sources } = read([
      HEADER,
      ROW,
      "Összesen: | 2 000 | 540 | 2 540",
    ]);
    assert.equal(values.netAmount, "2000.00");
    assert.equal(values.vatAmount, "540.00");
    assert.equal(values.grossAmount, "2540.00");
    assert.equal(sources.netAmount, "TEXT");
    assert.equal(sources.grossAmount, "TEXT");
  });

  it("takes the unit and the thousands separators in the cells", () => {
    const { values } = read([
      "Nettó | ÁFA | Bruttó",
      "Összesen: | 12 345 Ft | 3 333 Ft | 15 678 Ft",
    ]);
    assert.equal(values.netAmount, "12345.00");
    assert.equal(values.grossAmount, "15678.00");
  });

  it("reads nothing when net + VAT does not give the gross (a wrong number is worse than an empty one)", () => {
    const { values } = read([HEADER, "Összesen: | 2 000 | 540 | 2 600"]);
    assert.equal(values.netAmount, null);
    assert.equal(values.grossAmount, null);
  });

  it("reads nothing without a net-to-gross header above the row", () => {
    const { values } = read(["Összesen: | 2 000 | 540 | 2 540"]);
    assert.equal(values.netAmount, null);
    // fordított fejléc (bruttó az elején): az összesítő sor nem dönt. (A cimkézett olvasó a fejléc
    // alatti sort a "Nettó" cimke után tovább olvassa: ez a meglévő viselkedés, itt nem vizsgáljuk.)
    assert.equal(
      totalsRow(["Bruttó | ÁFA | Nettó", "Összesen: | 2 000 | 540 | 2 540"]),
      null,
    );
  });

  it("reads nothing when the row does not carry exactly three amounts", () => {
    assert.equal(read([HEADER, "Összesen: | 2 540"]).values.grossAmount, null);
    // egy negyedik összeg is kizár, akkor is, ha az első három kijönne
    assert.equal(
      read([HEADER, "Összesen: | 2 000 | 540 | 2 540 | 100"]).values.netAmount,
      null,
    );
    assert.equal(
      read([HEADER, "Összesen: | 1 | 2 000 | 540 | 2 540"]).values.netAmount,
      null,
    );
  });

  it("reads the Hungarian utility bill's total row labelled 'Bruttó számlaérték összesen*' (net | VAT | gross)", () => {
    const { values, sources } = read([
      "Megnevezés | Mennyiség | Egységár | Nettó | Áfa(%) | Áfa | Bruttó",
      "Bruttó számlaérték összesen* | 2 000,00 | 540,00 | 2 540,00",
      "Fizetendő összeg | 2 540,00",
    ]);
    assert.equal(values.netAmount, "2000.00");
    assert.equal(values.vatAmount, "540.00");
    assert.equal(values.grossAmount, "2540.00");
    assert.equal(sources.grossAmount, "TEXT");
  });

  it("the 'Bruttó számlaérték összesen' row obeys the same three conditions: a header above, exactly three amounts, net + VAT = gross", () => {
    const row = "Bruttó számlaérték összesen* | 2 000,00 | 540,00 | 2 540,00";
    assert.equal(totalsRow([row]), null);
    assert.equal(
      totalsRow([HEADER, "Bruttó számlaérték összesen (Ft) | 2 540"]),
      null,
    );
    assert.equal(
      totalsRow([HEADER, "Bruttó számlaérték összesen* | 2 000 | 540 | 2 600"]),
      null,
    );
    assert.deepEqual(totalsRow([HEADER, row]), {
      net: 2000,
      vat: 540,
      gross: 2540,
    });
  });

  it("replaces a labelled net and VAT that do not add up to the gross with the totals row, whose gross is the same (they were picked from another place)", () => {
    // "Nettó" and "ÁFA" labels elsewhere on the bill give two numbers that cannot be this invoice's net and VAT
    const { values, sources, warnings } = read([
      HEADER,
      "Nettó díj | 700",
      "ÁFA | 50",
      "Bruttó számlaérték összesen* | 2 000 | 540 | 2 540",
      "Fizetendő összeg | 2 540 Ft",
    ]);
    assert.equal(values.netAmount, "2000.00");
    assert.equal(values.vatAmount, "540.00");
    assert.equal(values.grossAmount, "2540.00");
    assert.equal(sources.netAmount, "TEXT");
    assert.equal(
      warnings.some((w) => /nem adja ki a bruttót/.test(w)),
      false,
    );
  });

  it("does NOT replace a labelled pair that adds up (it stands even if the row says something else), nor when the gross differs from the row's", () => {
    // the labelled pair adds up to its own gross: the row does not overwrite it, and the row does not fill either (they disagree)
    const consistent = read([
      HEADER,
      "Subtotal | 1 000",
      "ÁFA | 270",
      "Fizetendő összeg | 1 270 Ft",
      "Bruttó számlaérték összesen* | 2 000 | 540 | 2 540",
    ]);
    assert.equal(consistent.values.netAmount, "1000.00");
    assert.equal(consistent.values.grossAmount, "1270.00");
    // the labelled pair does not add up, but the gross is NOT the row's gross: nothing is replaced (the row is not trusted over the gross)
    const otherGross = read([
      HEADER,
      "Nettó díj | 700",
      "ÁFA | 50",
      "Fizetendő összeg | 9 999 Ft",
      "Bruttó számlaérték összesen* | 2 000 | 540 | 2 540",
    ]);
    assert.notEqual(otherGross.values.netAmount, "2000.00");
    // and the warning still names the labelled pair that was refused, not the row's numbers
    assert.ok(otherGross.warnings.some((w) => w.includes("700.00")));
  });

  it("does not decide between two different totals rows", () => {
    const { values } = read([
      HEADER,
      "Összesen: | 2 000 | 540 | 2 540",
      HEADER,
      "Összesen: | 1 000 | 270 | 1 270",
    ]);
    assert.equal(values.netAmount, null);
  });

  it("fills only what is empty when the labelled values agree with the row, and nothing when one disagrees", () => {
    // a címke nettót ad (másik tábla vagy másik összeg), az összesítő sor mást mond: a sor semmit nem tölt
    const disagree = read([
      HEADER,
      "Subtotal | 1 500",
      "Összesen: | 2 000 | 540 | 2 540",
    ]);
    assert.equal(disagree.values.netAmount, "1500.00");
    assert.equal(disagree.values.vatAmount, null);
    assert.equal(disagree.values.grossAmount, null);
    // egyező címkézett érték mellett a hiányzó mezőket tölti
    const agree = read([
      HEADER,
      "Subtotal | 2 000",
      "Összesen: | 2 000 | 540 | 2 540",
    ]);
    assert.equal(agree.values.netAmount, "2000.00");
    assert.equal(agree.values.vatAmount, "540.00");
    assert.equal(agree.values.grossAmount, "2540.00");
  });

  it("leaves a credit note (all three amounts negative) empty", () => {
    assert.equal(
      read([HEADER, "Összesen: | -2 000 | -540 | -2 540"]).values.netAmount,
      null,
    );
  });

  it("never overwrites a value the labels already gave, and leaves the English invoices alone", () => {
    const labelled = read([...DE, HEADER, "Összesen: | 9 | 9 | 18"]);
    assert.equal(labelled.values.netAmount, "100.00");
    assert.equal(labelled.values.grossAmount, "119.00");
    const english = read(EN_SAAS);
    assert.equal(english.values.netAmount, "20.00");
  });
});

/**
 * A SZALLITO NEVE A SZOVEGBOL (kártya dbab22cd, második kísérlet). Kitalált nevek; a valódi mintákból csak
 * a HELY (első sor, az "Eladó | Vevő" fejléc alatti sor) és a szabály jött.
 */
describe("the supplier name from the text", () => {
  it("takes the first line when it carries a legal form", () => {
    assert.equal(
      supplierNameFromText(["Kitalált Akvárium Kft.", "Számla", "Összesen"]),
      "Kitalált Akvárium Kft.",
    );
    assert.equal(
      supplierNameFromText([
        "Kitalált Aquaristik GmbH | 1234 Kitalált-város",
        "Rechnung",
      ]),
      "Kitalált Aquaristik GmbH",
    );
  });

  it("does not take a first line without a legal form (it may be a title)", () => {
    assert.equal(
      supplierNameFromText(["SZÁMLA", "Kitalált Akvárium Kft."]),
      null,
    );
    assert.equal(
      supplierNameFromText(["Invoice", "Kitalált Aquaristik GmbH"]),
      null,
    );
    assert.equal(supplierNameFromText(["Kitalált Cég"]), null);
  });

  it("reads the cell under a seller-before-buyer header", () => {
    assert.equal(
      supplierNameFromText([
        "Számla",
        "Eladó neve és címe: | Vevő neve és címe:",
        "Kitalált Szállító Zrt. | Vevő Kft.",
        "Kitalált utca 1.",
      ]),
      "Kitalált Szállító Zrt.",
    );
  });

  it("does not guess from a buyer-before-seller header (the first cell would be the buyer)", () => {
    assert.equal(
      supplierNameFromText([
        "Vevő neve: | Eladó neve:",
        "Kitalált Vevő Kft. | Kitalált Szállító Zrt.",
      ]),
      null,
    );
  });

  it("never returns our own company, whichever place names it", () => {
    assert.equal(supplierNameFromText(["Acropora Kft.", "Számla"]), null);
    assert.equal(
      supplierNameFromText([
        "Vevő | Eladó",
        "Acropora Kft. | Kitalált Szállító Zrt.",
      ]),
      null,
    );
  });

  it("does not decide when the two places name different companies", () => {
    assert.equal(
      supplierNameFromText([
        "Kitalált Első Kft.",
        "Eladó neve: | Vevő neve:",
        "Kitalált Második Kft. | Vevő Zrt.",
      ]),
      null,
    );
    assert.equal(
      supplierNameFromText([
        "Kitalált Első Kft.",
        "Eladó neve: | Vevő neve:",
        "Kitalált Első Kft. | Vevő Zrt.",
      ]),
      "Kitalált Első Kft.",
    );
  });

  it("knows the Hungarian 'Kibocsátó' and 'Szolgáltató' words, below a header and in the same row", () => {
    assert.equal(
      supplierNameFromText([
        "Számla",
        "Kibocsátó | Vevő",
        "Kitalált Kibocsátó Zrt. | Vevő Kft.",
      ]),
      "Kitalált Kibocsátó Zrt.",
    );
    assert.equal(
      supplierNameFromText([
        "Levelezési cím:",
        "Szolgáltató neve: | Kitalált Szolgáltató Zrt.",
      ]),
      "Kitalált Szolgáltató Zrt.",
    );
  });

  it("reads the English seller headers and the same-row 'Seller:' label (invented names)", () => {
    assert.equal(
      supplierNameFromText([
        "Invoice",
        "Seller | Buyer",
        "Kitalált Aquaristik GmbH | Vevő Kft.",
      ]),
      "Kitalált Aquaristik GmbH",
    );
    assert.equal(
      supplierNameFromText([
        "Invoice",
        "Supplier | Bill to",
        "Kitalált Supply Ltd | Vevő Kft.",
      ]),
      "Kitalált Supply Ltd",
    );
    assert.equal(
      supplierNameFromText(["Invoice", "Seller: | Kitalált Corp Inc"]),
      "Kitalált Corp Inc",
    );
  });

  it("a sentence with 'from' in the middle is no header; the seller column's cell is read, not the first one", () => {
    assert.equal(
      supplierNameFromText([
        "Valid from 2026-10-01 for customer 4711",
        "Kitalált Cég Kft. | Máshol",
      ]),
      null,
    );
    assert.equal(
      supplierNameFromText([
        "Period from | Customer no.",
        "Kitalált Cég Kft. | 4711",
      ]),
      null,
    );
    assert.equal(
      supplierNameFromText([
        "Számla | Eladó | Vevő",
        "2026/12 | Kitalált Eladó Kft. | Vevő Zrt.",
      ]),
      "Kitalált Eladó Kft.",
    );
    // eltérő cellaszám és az eladó nem az első oszlop: nem találgatunk
    assert.equal(
      supplierNameFromText([
        "Számla | Eladó | Vevő",
        "Kitalált Eladó Kft. | 2026/12",
      ]),
      null,
    );
  });

  it("does not take a buyer label, a buyer-first header or our own company from those places", () => {
    assert.equal(
      supplierNameFromText(["Vevő neve: | Kitalált Vevő Kft."]),
      null,
    );
    assert.equal(supplierNameFromText(["Bill to: | Kitalált Vevő Ltd"]), null);
    assert.equal(
      supplierNameFromText([
        "Buyer | Seller",
        "Kitalált Vevő Kft. | Kitalált Eladó Kft.",
      ]),
      null,
    );
    assert.equal(supplierNameFromText(["Seller: | Acropora Kft."]), null);
  });

  it("the same-row label also needs a legal form in the name", () => {
    assert.equal(supplierNameFromText(["Seller: | Kitalált Cég"]), null);
  });

  it("is a fallback: the adapter and the bank pairing name come first, the text fills the gap", () => {
    const lines = ["Kitalált Akvárium Kft.", "Invoice no: KT-1"];
    const blank = {
      number: "",
      supplierName: "",
      date: "",
      gross: null,
      currency: "",
      debits: [],
    };
    const alone = readForeignInvoice({ lines, adapter: null, pairing: blank });
    assert.equal(alone.values.supplierName, "Kitalált Akvárium Kft.");
    assert.equal(alone.sources.supplierName, "TEXT");
    const paired = readForeignInvoice({
      lines,
      adapter: null,
      pairing: { ...blank, supplierName: "Párosítás szerinti név" },
    });
    assert.equal(paired.values.supplierName, "Párosítás szerinti név");
    assert.equal(paired.sources.supplierName, "PAIRING");
  });

  it("reads nothing from a scanned invoice", () => {
    assert.equal(
      readForeignInvoice({
        lines: null,
        adapter: null,
        pairing: {
          number: "",
          supplierName: "",
          date: "",
          gross: null,
          currency: "",
          debits: [],
        },
      }).values.supplierName,
      null,
    );
  });
});

/**
 * A FEJLEC-SOR ALATTI ERTEKSOR (kártya dbab22cd, harmadik kísérlet): a magyar számla metaadat-táblázata. Kitalált
 * számok és dátumok; a valódi mintákból csak a fejlécek ALAKJA jött.
 */
describe("the value row under a header row", () => {
  const read = (lines: string[]) =>
    readForeignInvoice({
      lines,
      adapter: null,
      pairing: {
        number: "",
        supplierName: "",
        date: "",
        gross: null,
        currency: "",
        debits: [],
      },
    }).values;

  it("reads the three dates under 'Teljesítés kelte | Számla kelte | Fizetési határidő'", () => {
    const v = read([
      "Teljesítés kelte | Számla kelte | Fizetési határidő",
      "2026.09.28. | 2026.10.03. | 2026.10.17.",
    ]);
    assert.equal(v.fulfillmentDate, "2026-09-28");
    assert.equal(v.issueDate, "2026-10-03");
    assert.equal(v.dueDate, "2026-10-17");
  });

  it("reads the number under 'Számlaszám | Fizetési mód' and ignores the unknown column", () => {
    const v = read([
      "Számlaszám | Fizetési mód",
      "KT-26/0123 | 8 nap átutalás",
    ]);
    assert.equal(v.documentNumber, "KT-26/0123");
  });

  it("maps by column, so a five-column header with a number column at the end works", () => {
    const v = read([
      "Fizetési mód | Teljesítés | Kelt | Fizetési határidő | Sorszám",
      "átutalás | 2026.09.28. | 2026.10.03. | 2026.10.17. | KT 123",
    ]);
    assert.equal(v.issueDate, "2026-10-03");
    assert.equal(v.fulfillmentDate, "2026-09-28");
    assert.equal(v.documentNumber, "KT 123");
  });

  it("needs the same number of cells in the header and the value row", () => {
    assert.deepEqual(
      tableRowFields([
        "Számla kelte | Fizetési határidő",
        "2026.10.03. | 2026.10.17. | extra",
      ]),
      {},
    );
    assert.deepEqual(
      tableRowFields(["Számla kelte | Fizetési határidő", "2026.10.03."]),
      {},
    );
  });

  it("takes only a cell with ONE date (a range is no date) and only a recognised label", () => {
    assert.deepEqual(
      tableRowFields([
        "Számla kelte | Fizetési mód",
        "2026.10.03-2026.10.05 | átutalás",
      ]),
      {},
    );
    assert.deepEqual(
      tableRowFields(["Megjegyzés | Fizetési mód", "2026.10.03. | átutalás"]),
      {},
    );
  });

  it("the bare 'Sorszám' label is the item-number column of the line table, not the invoice number", () => {
    // tétel-táblázat: "Sorszám | Megnevezés | Mennyiség" alatta "1 | ..." -> nincs számlaszám
    assert.deepEqual(
      tableRowFields([
        "Sorszám | Megnevezés | Mennyiség",
        "1 | Kitalált termék | 2 db",
      ]),
      {},
    );
    assert.deepEqual(
      tableRowFields([
        "Sorszám | Megnevezés | Mennyiség",
        "12 | Kitalált termék | 2 db",
      ]),
      {},
    );
    // az explicit címke elfogadja a puszta számot is
    assert.equal(
      tableRowFields(["Számlaszám | Fizetési mód", "20260123 | átutalás"])
        .documentNumber,
      "20260123",
    );
    // a puszta címke alatt a számlaszám-szerű érték (betű vagy elválasztó) rendben van
    assert.equal(
      tableRowFields(["Fizetési mód | Sorszám", "átutalás | KT 123"])
        .documentNumber,
      "KT 123",
    );
    assert.equal(
      tableRowFields(["Sorszám | Fizetési mód", "2026/123 | átutalás"])
        .documentNumber,
      "2026/123",
    );
  });

  it("takes a number cell only with a digit and not longer than 40 characters", () => {
    assert.deepEqual(
      tableRowFields(["Számlaszám | Fizetési mód", "nincs | átutalás"]),
      {},
    );
    assert.deepEqual(
      tableRowFields([
        "Számlaszám | Fizetési mód",
        `${"1".repeat(41)} | átutalás`,
      ]),
      {},
    );
  });

  it("does not decide when two header rows name different values", () => {
    const fields = tableRowFields([
      "Számla kelte | Fizetési mód",
      "2026.10.03. | átutalás",
      "Számla kelte | Fizetési mód",
      "2026.10.04. | átutalás",
    ]);
    assert.equal(fields.issueDate, undefined);
  });

  it("the labelled reading wins: a table cell only fills what is empty", () => {
    const v = read([
      "Invoice number KITALALT-0001",
      "Számlaszám | Fizetési mód",
      "MAS-9999 | átutalás",
    ]);
    assert.equal(v.documentNumber, "KITALALT-0001");
  });
});

describe("the VAT summary table (card dbab22cd, second round)", () => {
  const TABLE_HEADER =
    "ÁFA összesítő (Ft) | ÁFA % | Adóalap (Ft) | ÁFA (Ft) | Bruttó összeg (Ft)";

  it("reads net, VAT and gross from the row under the header; the first header cell is a title with no cell in the row, so the columns count from the END", () => {
    assert.deepEqual(
      vatSummaryTable([TABLE_HEADER, "27 | 1 000 | 270 | 1 270"]),
      {
        net: 1000,
        vat: 270,
        gross: 1270,
      },
    );
  });

  it("sums the rows of several VAT rates, and the first row that does not fit ends the table", () => {
    assert.deepEqual(
      vatSummaryTable([
        TABLE_HEADER,
        "27 | 1 000 | 270 | 1 270",
        "5 | 2 000 | 100 | 2 100",
        "Gondolta volna, hogy ez itt egy csekk?",
        "27 | 9 999 | 1 | 10 000",
      ]),
      { net: 3000, vat: 370, gross: 3370 },
    );
  });

  it("a total row under the rates is a CHECK, not one more row: one rate plus 'Összesen' is not doubled, two rates plus a matching one are the sum, a different one reads nothing", () => {
    assert.deepEqual(
      vatSummaryTable([
        TABLE_HEADER,
        "27 | 1 000 | 270 | 1 270",
        "Összesen | | 1 000 | 270 | 1 270",
      ]),
      { net: 1000, vat: 270, gross: 1270 },
    );
    assert.deepEqual(
      vatSummaryTable([
        TABLE_HEADER,
        "27 | 1 000 | 270 | 1 270",
        "5 | 2 000 | 100 | 2 100",
        "Összesen: | 3 000 | 370 | 3 370",
      ]),
      { net: 3000, vat: 370, gross: 3370 },
    );
    assert.equal(
      vatSummaryTable([
        TABLE_HEADER,
        "27 | 1 000 | 270 | 1 270",
        "5 | 2 000 | 100 | 2 100",
        "Összesen | 9 000 | 370 | 9 370",
      ]),
      null,
    );
    // a total row with no rate row above it checks nothing, so it fills nothing
    assert.equal(
      vatSummaryTable([TABLE_HEADER, "Összesen | 1 000 | 270 | 1 270"]),
      null,
    );
  });

  it("reads nothing when a row does not add up (a wrong number is worse than an empty one), even if an earlier row did", () => {
    assert.equal(
      vatSummaryTable([TABLE_HEADER, "27 | 1 000 | 270 | 1 300"]),
      null,
    );
    assert.equal(
      vatSummaryTable([
        TABLE_HEADER,
        "27 | 1 000 | 270 | 1 270",
        "5 | 2 000 | 100 | 2 500",
      ]),
      null,
    );
  });

  it("reads nothing without a row under the header, with a negative VAT, or with a row that has too few cells", () => {
    assert.equal(vatSummaryTable([TABLE_HEADER]), null);
    assert.equal(vatSummaryTable([TABLE_HEADER, "Valami szöveg"]), null);
    assert.equal(
      vatSummaryTable([TABLE_HEADER, "27 | -1 000 | -270 | -1 270"]),
      null,
    );
    assert.equal(vatSummaryTable([TABLE_HEADER, "1 000 | 270"]), null);
  });

  it("the header needs exactly one net, one VAT amount (not the rate column) and one gross cell, in that order", () => {
    // two VAT-amount cells: ambiguous
    assert.equal(
      vatSummaryTable([
        "Áfa (Ft) | Nettó (Ft) | Áfa (Ft) | Bruttó (Ft)",
        "27 | 1 000 | 270 | 1 270",
      ]),
      null,
    );
    // gross before net
    assert.equal(
      vatSummaryTable([
        "Bruttó (Ft) | Nettó (Ft) | ÁFA (Ft)",
        "1 270 | 1 000 | 270",
      ]),
      null,
    );
    // the rate column "Áfa(%)" is not the amount: net, VAT amount and gross are found, and the row aligns from the end
    assert.deepEqual(
      vatSummaryTable([
        "Áfa(%) | Nettó(Ft) | Áfa(Ft) | Bruttó(Ft)",
        "27 | 1 000 | 270 | 1 270",
      ]),
      { net: 1000, vat: 270, gross: 1270 },
    );
  });

  it("does not decide between two different tables", () => {
    assert.equal(
      vatSummaryTable([
        TABLE_HEADER,
        "27 | 1 000 | 270 | 1 270",
        TABLE_HEADER,
        "27 | 2 000 | 540 | 2 540",
      ]),
      null,
    );
  });

  it("fills the three amounts through the reader, and yields to a labelled value that disagrees", () => {
    const read = (lines: string[]) =>
      readForeignInvoice({
        lines,
        adapter: null,
        pairing: pairing({
          number: "",
          supplierName: "",
          date: "",
          currency: "",
        }),
      });
    const lines = [TABLE_HEADER, "27 | 1 000 | 270 | 1 270"];
    const { values } = read(lines);
    assert.equal(values.netAmount, "1000.00");
    assert.equal(values.vatAmount, "270.00");
    assert.equal(values.grossAmount, "1270.00");
    const disagree = read(["Subtotal | 1 500", ...lines]);
    assert.equal(disagree.values.netAmount, "1500.00");
    assert.equal(disagree.values.vatAmount, null);
  });
});

/**
 * A STRIPE-ALAPÚ ANGOL SZÁMLA (kártya dbab22cd, harmadik kör). Minden név, szám és adószám KITALÁLT.
 * MI PIROSÍT: ha a szállító neve a jogi forma hiánya miatt kimaradna; ha a vevő (mi) nevét szállítónak olvasná; ha két eltérő név közül az
 * egyiket választaná; ha a számlaszám az előtagra csonkulna (az előtag minden számlánkon ugyanaz, nem azonosít), vagy a NUL cellát elnyelné;
 * ha egy rövid előtag, egy két számjegyű sorszám vagy egy egycellás szám is "Stripe-számla" lenne; ha a "VAT" szó nélküli sor EU-számot adna;
 * ha a saját (HU) számunk, vagy két eltérő EU-szám közül az egyik kerülne a mezőbe.
 */
describe("the hosted (Stripe-style) English invoice (card dbab22cd, third round)", () => {
  const HOSTED = [
    "Invoice",
    "Invoice number | KITALALT | \x00 | 0012",
    "Date of issue | October 8, 2026",
    "Date due | October 8, 2026",
    "VAT Registration | EU VAT | \x00 | IE9999999XX",
    "Kitalált Eszköz, Inc. | @kitalalt | Bill to | Ship to",
    "Acropora Kft. | Acropora Kft.",
    "HU VAT HU23916229",
    "Description | Qty | Unit price | Amount",
    "Kitalált csomag | 1 | €135.00 | €135.00",
    "Subtotal | €135.00",
    "Total | €135.00",
  ];

  it("reads the supplier from the header row, with or without a legal form, and never the buyer", () => {
    assert.equal(hostedInvoiceSupplier(HOSTED), "Kitalált Eszköz, Inc.");
    assert.equal(
      hostedInvoiceSupplier(["Kitalált Minta | Bill to", "Acropora Kft. | x"]),
      "Kitalált Minta",
    );
    assert.equal(hostedInvoiceSupplier(["Acropora Kft. | Bill to"]), null);
    assert.equal(hostedInvoiceSupplier(["Bill to | Ship to"]), null);
    assert.equal(hostedInvoiceSupplier(["@kitalalt | Bill to"]), null);
    // a header row whose first cell is a LABEL ("Supplier | Bill to") names nobody
    assert.equal(hostedInvoiceSupplier(["Supplier | Bill to"]), null);
    assert.equal(
      hostedInvoiceSupplier(["Egy Kft. | Bill to", "Másik Kft. | Bill to"]),
      null,
    );
  });

  it("reads the FULL invoice number: the prefix, the NUL cell as a hyphen, the serial", () => {
    assert.equal(hostedInvoiceNumber(HOSTED), "KITALALT-0012");
    assert.equal(
      hostedInvoiceNumber(["Invoice number | KITALALT | - | 0012"]),
      "KITALALT-0012",
    );
    // only this three-cell shape: a plain one-cell number is the other readers'
    assert.equal(hostedInvoiceNumber(["Invoice number | KITALALT-0012"]), null);
    assert.equal(
      hostedInvoiceNumber(["Invoice number | KITALALT | Qty | 0012"]),
      null,
    );
    assert.equal(
      hostedInvoiceNumber(["Invoice number | ABC | \x00 | 0012"]),
      null,
    );
    assert.equal(
      hostedInvoiceNumber(["Invoice number | KITALALT | \x00 | 12"]),
      null,
    );
    assert.equal(
      hostedInvoiceNumber([
        "Invoice number | KITALALT | \x00 | 0012",
        "Invoice number | KITALALT | \x00 | 0013",
      ]),
      null,
    );
  });

  it("reads the supplier's EU VAT number from a VAT-labelled line, and not ours or an ambiguous one", () => {
    assert.equal(vatLineEuNumber(HOSTED), "IE9999999XX");
    assert.equal(vatLineEuNumber(["IE VAT IE9999999XX"]), "IE9999999XX");
    // our own Hungarian number is not a foreign one
    assert.equal(vatLineEuNumber(["HU VAT HU23916229"]), null);
    // no VAT word, no number
    assert.equal(vatLineEuNumber(["Reference IE9999999XX"]), null);
    // two different numbers decide nothing
    assert.equal(vatLineEuNumber(["VAT IE9999999XX", "VAT DE999999999"]), null);
    // a word without a digit is not a number
    assert.equal(vatLineEuNumber(["VAT ESPRESSOXX"]), null);
  });

  it("fills the supplier, the full number and the EU VAT number through the reader", () => {
    const { values, sources } = readForeignInvoice({
      lines: HOSTED,
      adapter: null,
      pairing: pairing({
        number: "",
        supplierName: "",
        date: "",
        currency: "",
      }),
    });
    assert.equal(values.supplierName, "Kitalált Eszköz, Inc.");
    assert.equal(values.documentNumber, "KITALALT-0012");
    assert.equal(values.supplierEuTaxNumber, "IE9999999XX");
    assert.deepEqual(
      [
        sources.supplierName,
        sources.documentNumber,
        sources.supplierEuTaxNumber,
      ],
      ["TEXT", "TEXT", "TEXT"],
    );
  });
});

/*
  A CÍMKÉZETT SZÁMLASZÁM ÉS A NÉMET "Datum:" (kártya dbab22cd, harmadik kör). Minden szám és név KITALÁLT. MI PIROSÍT: ha a Rechnung/Rech.-Nr.
  címkék értéke nem a számlaszám lenne; ha egy másik címke (Auftrags-, Lieferschein-, Kunden-Nr.) számlaszámnak olvasódna; ha a szomszéd
  CÍMKE-cella ("Billing address") értéknek számítana; ha az érték a következő sorból egy NÉV mellől is átugrana; ha a háromcellás Stripe-alak
  előtagja egymagában számlaszám lenne; ha két különböző címkézett szám közül az egyik nyerne; ha a "Lieferdatum" kelte lenne; ha a címkézett
  szám a közös olvasó mögé szorulna (az a magyar "Számlaszám:" bankszámla-sort is számlaszámnak vette).
*/
describe("labelledInvoiceNumber", () => {
  it("reads the German labels: inline, beside, with the Rech.-Nr. abbreviation", () => {
    assert.equal(
      labelledInvoiceNumber(["Rechnung - Nr. 40199001"]),
      "40199001",
    );
    assert.equal(
      labelledInvoiceNumber(["Rechnungs Nr.: | RE99001"]),
      "RE99001",
    );
    assert.equal(
      labelledInvoiceNumber(["Rech.-Nr. | R49000000099999"]),
      "R49000000099999",
    );
    assert.equal(
      labelledInvoiceNumber(["Rechnungsnummer: | 2026/0042"]),
      "2026/0042",
    );
  });

  it("reads the value from the next line when the neighbouring cell is another label, or there is none", () => {
    assert.equal(
      labelledInvoiceNumber(["Invoice n°: | Billing address", "F9900123"]),
      "F9900123",
    );
    assert.equal(
      labelledInvoiceNumber(["Adószám | Számla száma", "KH99000123", "Oldal"]),
      "KH99000123",
    );
  });

  it("never reads another reference, a name beside the label, or a bare word", () => {
    assert.equal(labelledInvoiceNumber(["Auftragsnr.: | 20144999"]), null);
    assert.equal(labelledInvoiceNumber(["Lieferscheinnr.: | 30113999"]), null);
    assert.equal(labelledInvoiceNumber(["Kunden-Nr.: | 33999"]), null);
    // a name beside the label: the next line's number is not the label's value
    assert.equal(
      labelledInvoiceNumber(["Rechnungs Nr.: | Kitalált Név", "12345678"]),
      null,
    );
    assert.equal(labelledInvoiceNumber(["Rechnungs Nr.: | Kitalált"]), null);
    // no digit: not a number
    assert.equal(labelledInvoiceNumber(["Rechnungs Nr.: | ABCDEFGH"]), null);
  });

  it("leaves the three-cell hosted shape to hostedInvoiceNumber: the prefix alone is no invoice number", () => {
    assert.equal(
      labelledInvoiceNumber(["Invoice number | KITALALT2 | \x00 | 0012"]),
      null,
    );
    assert.equal(
      labelledInvoiceNumber(["Invoice number | KITALALT2 | - | 0012"]),
      null,
    );
  });

  it("decides nothing when two different labelled numbers stand", () => {
    assert.equal(
      labelledInvoiceNumber([
        "Rechnungs Nr.: | RE99001",
        "Rech.-Nr. | RE99002",
      ]),
      null,
    );
    assert.equal(
      labelledInvoiceNumber([
        "Rechnungs Nr.: | RE99001",
        "Rech.-Nr. | RE99001",
      ]),
      "RE99001",
    );
  });
});

describe("readForeignInvoice: the labelled number and the bare German date", () => {
  const GERMAN = [
    "Kitalált Handel GmbH, Beispielweg 1, 70000 Teststadt | 6",
    "Datum: | 18.09.2026",
    "Lieferdatum: | 20.09.2026",
    "Kunden-Nr.: | 33999",
    "Auftragsnr.: | 20144999",
    "Rechnung - Nr. 40199001",
    "Summe netto: | 100,00 €",
  ];

  it("takes the invoice number by its label and the date after the bare Datum, never the delivery date", () => {
    const { values, sources } = readForeignInvoice({
      lines: GERMAN,
      adapter: null,
      pairing: pairing({}),
    });
    assert.equal(values.documentNumber, "40199001");
    assert.equal(sources.documentNumber, "TEXT");
    assert.equal(values.issueDate, "2026-09-18");
  });

  it("a Lieferdatum alone is no issue date", () => {
    const { values } = readForeignInvoice({
      lines: ["Lieferdatum: | 20.09.2026", "Rechnung - Nr. 40199001"],
      adapter: null,
      pairing: pairing({ date: null }),
    });
    assert.equal(values.issueDate, null);
  });

  it("the Hungarian Dátum is deliberately not a bare issue label", () => {
    const { values } = readForeignInvoice({
      lines: ["Dátum 2026. okt. 31.", "Számla száma", "KH99000123"],
      adapter: null,
      pairing: pairing({ date: null }),
    });
    assert.equal(values.issueDate, null);
    assert.equal(values.documentNumber, "KH99000123");
  });

  it("the labelled number goes before the shared reader: a bank account line (Számlaszám) does not become the number", () => {
    const { values } = readForeignInvoice({
      lines: [
        "Kitalált Handel GmbH",
        "IBAN: HU00 1111 2222 3333 4444 5555 6666 | BIC: KITALALT | Számlaszám: 1111 2222 3333 4444 5555 6666 |",
        "Rech.-Nr. | R49000000099999",
        "Rech.-Datum | 06.11.2026",
      ],
      adapter: null,
      pairing: pairing({}),
    });
    assert.equal(values.documentNumber, "R49000000099999");
    assert.equal(values.issueDate, "2026-11-06");
  });

  it("the hosted full number still wins over the labelled prefix", () => {
    const { values } = readForeignInvoice({
      lines: ["Invoice number | KITALALT2 | \x00 | 0012"],
      adapter: null,
      pairing: pairing({}),
    });
    assert.equal(values.documentNumber, "KITALALT2-0012");
  });
});
