import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCsv,
  readSimplePayMailSummary,
  readSimplePayReport,
  SimplePayReportError,
} from "./simplepay-report.parser.js";

// The real header, verbatim (report_20260930.csv). Buyer name and e-mail are
// invented: the parser must not read them, and a test must not carry them.
const HEADER =
  "Tranzakció státusz;Fizetés típusa;SimplePay tranzakció ID;Kereskedői tranzakció ID;Tranzakció dátuma;Teljesítés dátuma;Devizanem;Tranzakciós jutalék;Bankközi díj / Kedvezményalap díj;Kártyatársasági díj és ONUS tranzakció feldolgozási díj / Rendszerhasználati díj;Kereskedői díj;Tranzakció összege;Jutalékkal csökkentett összeg;Partner;Fiók név;Fiók URL;Vásárló;E-mail cím;";

const ROWS = [
  "COMPLETED;Bankkártyás fizetés;914263636;111737061T628506;2026-09-22 14:14:26;2026-09-22 14:16:32;HUF;1020,00;146,00;97,00;777,00;38477,00;37457,00;KITALALT Kft.;KITALALT Kft.;https://example.com;Kitalalt Vevo;vevo@example.com;",
  "COMPLETED;Bankkártyás fizetés;914368906;111757941T999790;2026-09-22 17:46:13;2026-09-22 17:47:28;HUF;177,00;0,00;22,00;155,00;7693,00;7516,00;KITALALT Kft.;KITALALT Kft.;https://example.com;Masik Vevo;masik@example.com;",
];

const csv = (rows: string[] = ROWS, header = HEADER) =>
  Buffer.from("\uFEFF" + [header, ...rows].join("\r\n") + "\r\n", "utf8");

describe("readSimplePayReport", () => {
  it("reads every transaction with its amounts, fees and order key", () => {
    const report = readSimplePayReport(csv());

    assert.equal(report.transactions.length, 2);
    assert.deepEqual(report.transactions[0], {
      rowNumber: 1,
      status: "COMPLETED",
      paymentType: "Bankkártyás fizetés",
      simplePayTransactionId: "914263636",
      merchantTransactionId: "111737061T628506",
      orderKeySuffix: "628506",
      transactionAt: "2026-09-22 14:14:26",
      completedAt: "2026-09-22 14:16:32",
      currency: "HUF",
      amount: 38477,
      commission: 1020,
      interchangeFee: 146,
      schemeFee: 97,
      merchantFee: 777,
      netAmount: 37457,
    });
    assert.equal(report.amountTotal, 46170);
    assert.equal(report.commissionTotal, 1197);
    assert.equal(report.netTotal, 44973);
    assert.deepEqual(report.warnings, []);
  });

  it("never reads the buyer's name or e-mail", () => {
    const serialized = JSON.stringify(readSimplePayReport(csv()));
    for (const personal of ["Kitalalt Vevo", "vevo@example.com", "Masik"])
      assert.ok(!serialized.includes(personal), personal);
  });

  it("finds columns by label, not by position", () => {
    const columns = HEADER.split(";");
    const swap = (line: string) => {
      const cells = line.split(";");
      [cells[0], cells[11]] = [cells[11]!, cells[0]!];
      return cells.join(";");
    };
    assert.ok(columns.length > 11);
    const report = readSimplePayReport(csv(ROWS.map(swap), swap(HEADER)));
    assert.equal(report.transactions[0]!.amount, 38477);
    assert.equal(report.transactions[0]!.status, "COMPLETED");
  });

  it("keeps a row that does not add up, and says so", () => {
    const wrong = ROWS[0]!.replace("37457,00", "37000,00");
    const report = readSimplePayReport(csv([wrong]));
    assert.equal(report.transactions.length, 1);
    assert.match(report.warnings.join(" "), /utalt összeggel/);
  });

  it("warns when the three fees do not make up the commission", () => {
    const wrong = ROWS[0]!.replace(";777,00;", ";700,00;");
    assert.match(
      readSimplePayReport(csv([wrong])).warnings.join(" "),
      /három díj/,
    );
  });

  it("warns when the merchant ID carries no order key", () => {
    const odd = ROWS[0]!.replace("111737061T628506", "KEZI-0001");
    const report = readSimplePayReport(csv([odd]));
    assert.equal(report.transactions[0]!.orderKeySuffix, null);
    assert.match(report.warnings.join(" "), /nem olvasható ki a rendelés/);
  });

  it("rejects a file without the settlement columns", () => {
    assert.throws(
      () => readSimplePayReport(csv(ROWS, "Valami;Mas")),
      (error: unknown) =>
        error instanceof SimplePayReportError &&
        error.code === "SIMPLEPAY_COLUMNS_MISSING",
    );
  });

  it("rejects an unreadable amount instead of booking zero", () => {
    const broken = ROWS[0]!.replace("38477,00", "n/a");
    assert.throws(
      () => readSimplePayReport(csv([broken])),
      (error: unknown) =>
        error instanceof SimplePayReportError &&
        error.code === "SIMPLEPAY_AMOUNT_INVALID",
    );
  });

  it("reads an empty week as an empty report", () => {
    const report = readSimplePayReport(csv([]));
    assert.equal(report.transactions.length, 0);
    assert.equal(report.amountTotal, 0);
  });
});

describe("parseCsv", () => {
  it("keeps a separator and a doubled quote inside a quoted field", () => {
    assert.deepEqual(parseCsv('a;"b;c";"d ""e"""\n1;2;3'), [
      ["a", "b;c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("readSimplePayMailSummary", () => {
  // the body of the 2026-09-30 mail, shape kept, names invented
  const BODY = `Tisztelt Partnerünk!

Mellékelten csatolva ezúton megküldjük a https://example.com
elfogadóhelyen 2026.09.21 - 2026.09.27 forgalmi időszakról készült
kimutatást.

  \tFiók: \tKITALALT Kft. \t
  \tTranzakciók száma: \t2 \t
  \tTranzakciók végösszege: \t46 170 HUF \t
  \tTranzakciós jutalék: \t1 197 HUF \t
`;

  it("reads the period and SimplePay's own totals", () => {
    assert.deepEqual(readSimplePayMailSummary(BODY), {
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
      transactionCount: 2,
      amountTotal: 46170,
      commissionTotal: 1197,
    });
  });

  it("agrees with the CSV of the same mail", () => {
    const summary = readSimplePayMailSummary(BODY)!;
    const report = readSimplePayReport(csv());
    assert.equal(summary.transactionCount, report.transactions.length);
    assert.equal(summary.amountTotal, report.amountTotal);
    assert.equal(summary.commissionTotal, report.commissionTotal);
  });

  it("returns null for a mail that is not a weekly report", () => {
    assert.equal(readSimplePayMailSummary("Sikeres fizetés"), null);
  });
});
