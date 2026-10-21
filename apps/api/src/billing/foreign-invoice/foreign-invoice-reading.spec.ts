import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupplierInvoiceImportResult } from "@acropora/types";

import {
  parseForeignDate,
  readForeignInvoice,
  supplierNameFromText,
  tableRowFields,
  totalsRow,
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
