import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPaymentMethodReport,
  paymentMethodFromLines,
  readPaymentMethods,
  type PaymentMethodTarget,
} from "./due-invoices-payment-method.js";

/*
  THE PDF'S OWN WORD ON HOW A DUE INVOICE IS PAID (acrobot 58710, 58713, 58718). WHAT TURNS IT RED: a payment-method field in
  Hungarian, English or German not found, or a value on the line below the label (a two-row table) missed; another column on
  the label's line deciding the kind; transfer read where direct debit is written; a card's or an account's digits printed; a
  "fizetve" on the PDF not flagged; two PDFs of one row that disagree reported as one kind; a fieldless PDF overriding one
  with a field; a row without a PDF, with an unreadable PDF or with a scanned one told apart wrongly.
*/
describe("paymentMethodFromLines", () => {
  it("reads the field in Hungarian, English and German, on its line or the line below", () => {
    const cases: [string[], string][] = [
      [["Számla", "Fizetési mód: Bankkártya", "Összesen"], "KARTYA"],
      [["Fizetés módja | Átutalás"], "UTALAS"],
      [["Invoice", "Payment method: Bank transfer"], "UTALAS"],
      [["Payment method", "Visa ****1234"], "KARTYA"],
      [["Zahlungsart: Lastschrift"], "BESZEDES"],
      [["Fizetési mód: Csoportos beszedés"], "BESZEDES"],
      [["Fizetési mód: Készpénz"], "KESZPENZ"],
      [["Fizetési mód: Utánvét"], "UTANVET"],
      [["Fizetési mód: Kompenzáció"], "MAS"],
      [["Számla", "Fizetési határidő: 2026.11.20"], "NINCS_MEZO"],
    ];
    for (const [lines, kind] of cases)
      assert.equal(paymentMethodFromLines(lines).kind, kind, lines.join(" / "));
  });

  it("another column before the label does not decide the kind", () => {
    assert.equal(
      paymentMethodFromLines(["Bankkártyás vásárlás | Fizetési mód: Átutalás"])
        .kind,
      "UTALAS",
    );
  });

  it("masks four or more digits on the printed line, and flags a 'paid' mark anywhere on the PDF", () => {
    const reading = paymentMethodFromLines([
      "Payment method: Visa ****1234",
      "Total 1490 Ft",
      "Already paid",
    ]);
    assert.equal(reading.line, "Payment method: Visa ****#### / Total #### Ft");
    assert.equal(reading.paid, true);
    assert.equal(
      paymentMethodFromLines(["Fizetési mód: Átutalás", "Fizetési határidő"])
        .paid,
      false,
    );
    // "fizetve" as a word, not inside another word
    assert.equal(paymentMethodFromLines(["Kifizetvehető összeg"]).paid, false);
  });
});

describe("readPaymentMethods", () => {
  const target = (id: string, pdfIds: string[]): PaymentMethodTarget => ({
    id,
    supplierName: `Szállító ${id}`,
    documentNumber: `SZ-${id}`,
    pdfIds,
  });
  const PDFS: Record<string, string[] | null | "throws"> = {
    card: ["Fizetési mód: Bankkártya"],
    transfer: ["Payment method: Bank transfer"],
    nofield: ["Számla", "Összesen 1490"],
    scanned: ["=== oldal vege ==="],
    broken: "throws",
    gone: null,
  };
  const deps = (targets: PaymentMethodTarget[]) => ({
    targets: async () => targets,
    content: async (id: string) =>
      PDFS[id] === null ? null : new TextEncoder().encode(id),
    lines: async (content: Uint8Array) => {
      const value = PDFS[new TextDecoder().decode(content)];
      if (value === "throws") throw new Error("bad pdf");
      return value as string[];
    },
  });

  it("gives each row one verdict: the field's kind, ELTERO on disagreement, and the reasons a PDF said nothing", async () => {
    const rows = await readPaymentMethods(
      deps([
        target("a", ["card"]),
        target("b", ["card", "transfer"]),
        target("c", ["nofield", "card"]),
        target("d", ["nofield"]),
        target("e", ["scanned"]),
        target("f", ["broken"]),
        target("g", []),
        target("h", ["gone"]),
      ]),
    );
    assert.deepEqual(
      rows.map((r) => [r.documentNumber, r.verdict]),
      [
        ["SZ-a", "KARTYA"],
        ["SZ-b", "ELTERO"],
        ["SZ-c", "KARTYA"],
        ["SZ-d", "NINCS_MEZO"],
        ["SZ-e", "NINCS_SZOVEG"],
        ["SZ-f", "OLVASHATATLAN"],
        ["SZ-g", "NINCS_PDF"],
        ["SZ-h", "OLVASHATATLAN"],
      ],
    );
    const report = formatPaymentMethodReport(rows);
    assert.match(
      report,
      /^KARTYA +Szállító a +SZ-a +PDF 1 \| Fizetési mód: Bankkártya \/ $/mu,
    );
    assert.match(
      report,
      /^Osszesen: KARTYA 2, ELTERO 1, NINCS_MEZO 1, NINCS_SZOVEG 1, OLVASHATATLAN 2, NINCS_PDF 1$/mu,
    );
  });
});
