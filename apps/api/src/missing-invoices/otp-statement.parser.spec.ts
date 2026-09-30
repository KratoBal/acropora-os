import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  originalAmountOf,
  parseOtpStatement,
  splitCsvLine,
} from "./otp-statement.parser.js";

const bytes = (lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8");

// Synthetic rows in the measured OTP shape (13+ columns, no header).
const DEBIT =
  '"1170900220624460";T;-8984879;HUF;20260801;20260801;;RS35325960170009916873;"DOO AQUADECOR";"24.922,00 EUR 72/26 Serbia";"in; Zrenjan";"";DEVIZA ÁTUTALÁS;;';
const CREDIT =
  '"1170900220624460";J;68759;HUF;20260801;20260801;;1179400820546085;"SIMPLEPAY ZRT.";"T655194074";;;ÁTUTALÁS (OTP-N BELÜL);;';
const EUR =
  '"117630931466788600000000";T;-123.45;EUR;20260802;20260803;;;"Hetzner";"Invoice R123";;;KÁRTYÁS VÁSÁRLÁS;;';
const ALZA =
  '"1171400626009841";T;-23810;HUF;20260810;20260810;;;"Alza";"55,380EUR";;;KÁRTYÁS VÁSÁRLÁS;;';

describe("splitCsvLine", () => {
  it("keeps a semicolon inside quotes, and unescapes a doubled quote", () => {
    assert.deepEqual(splitCsvLine('"a;b";c;"d""e"'), ["a;b", "c", 'd"e']);
  });
});

describe("parseOtpStatement", () => {
  it("reads a debit: unsigned amount, the three narrative parts joined, dates as UTC days", () => {
    const { rows, rejected } = parseOtpStatement(bytes([DEBIT]));
    assert.deepEqual(rejected, []);
    const row = rows[0]!;
    assert.equal(row.direction, "DEBIT");
    assert.equal(row.amount.toString(), "8984879");
    assert.equal(row.currency, "HUF");
    assert.equal(row.bookingDate.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(row.counterpartyAccount, "RS35325960170009916873");
    assert.equal(row.counterpartyName, "DOO AQUADECOR");
    assert.equal(row.narrative, "24.922,00 EUR 72/26 Serbia in; Zrenjan");
    assert.equal(row.transactionType, "DEVIZA ÁTUTALÁS");
  });

  it("reads a credit, a 24-digit account and an EUR amount with a decimal point", () => {
    const { rows } = parseOtpStatement(bytes([CREDIT, EUR]));
    assert.deepEqual(
      rows.map((r) => [r.direction, r.amount.toString(), r.currency]),
      [
        ["CREDIT", "68759", "HUF"],
        ["DEBIT", "123.45", "EUR"],
      ],
    );
    assert.equal(rows[1]!.accountNumber, "117630931466788600000000");
  });

  it("gives two identical rows in one export two keys, and the same row in another export the same key", () => {
    const one = parseOtpStatement(bytes([ALZA, ALZA])).rows;
    assert.equal(one.length, 2);
    assert.notEqual(one[0]!.transactionKey, one[1]!.transactionKey);
    const other = parseOtpStatement(bytes([DEBIT, ALZA])).rows;
    assert.equal(other[1]!.transactionKey, one[0]!.transactionKey);
  });

  it("names the unreadable lines, and skips blank ones", () => {
    const { rows, rejected } = parseOtpStatement(
      bytes([
        "",
        '"1170900220624460";T;-1;HUF',
        DEBIT.replace('"1170900220624460"', '"12-34"'),
        DEBIT.replace(";T;", ";X;"),
        DEBIT.replace("20260801;20260801", "2026.08.01;20260801"),
        DEBIT,
      ]),
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(
      rejected.map((r) => r.line),
      [2, 3, 4, 5],
    );
  });

  it("drops a byte-order mark, and refuses bytes that are not UTF-8", () => {
    assert.equal(
      parseOtpStatement(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes([DEBIT])]),
      ).rows.length,
      1,
    );
    assert.throws(() => parseOtpStatement(Buffer.from([0x22, 0xc1, 0x22])));
  });
});

describe("originalAmountOf", () => {
  it("reads both measured forms: card (55,380EUR) and transfer (1.199,75 EUR)", () => {
    assert.deepEqual(
      [
        originalAmountOf("KÁRTYA 55,380EUR"),
        originalAmountOf("1.199,75 EUR R-99"),
      ].map((r) => r && [r.amount.toString(), r.currency]),
      [
        ["55.38", "EUR"],
        ["1199.75", "EUR"],
      ],
    );
    assert.equal(originalAmountOf("Invoice R123"), null);
  });
});
