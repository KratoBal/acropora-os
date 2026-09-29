import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GLS_COMPENSATION_0827_LINES,
  GLS_COMPENSATION_0910_LINES,
} from "../../testing/gls-compensation-pdf-lines.fixture.js";
import {
  isGlsCompensationLetter,
  readGlsCompensationLetter,
} from "./gls-compensation.parser.js";

const errorCode = (lines: readonly string[]) => {
  try {
    readGlsCompensationLetter(lines);
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "no error";
};

const replaceLine = (
  lines: readonly string[],
  from: string,
  to: string | string[],
) => {
  const at = lines.indexOf(from);
  assert.ok(at >= 0, `fixture line missing: ${from}`);
  return [...lines.slice(0, at), ...[to].flat(), ...lines.slice(at + 1)];
};

const ROW_0910 =
  "3480031291 | 28 900 | 18 111 | 10 789 HU00920611 | 18 111 | 0 2026.09.10";

describe("readGlsCompensationLetter", () => {
  it("reads a letter that sets three GLS invoices off and leaves part open", () => {
    assert.deepEqual(readGlsCompensationLetter(GLS_COMPENSATION_0827_LINES), {
      date: "2026-08-27",
      clientNumber: "3480031291",
      cod: 6950,
      compensated: 6950,
      transferred: 0,
      // the order they stand in, the lines above and below the row too
      references: ["HU00905612", "HU00898334", "HU00912382"],
      debt: 14963,
      remaining: 8013,
    });
  });

  it("reads an amount that runs into the invoice number in one cell", () => {
    const letter = readGlsCompensationLetter(GLS_COMPENSATION_0910_LINES);
    assert.deepEqual(
      [letter.cod, letter.compensated, letter.transferred, letter.references],
      [28900, 18111, 10789, ["HU00920611"]],
    );
    assert.equal(letter.date, "2026-09-10");
  });

  it("refuses a letter whose own sums do not hold", () => {
    assert.equal(
      errorCode(
        replaceLine(
          GLS_COMPENSATION_0910_LINES,
          ROW_0910,
          "3480031291 | 28 900 | 18 111 | 10 889 HU00920611 | 18 111 | 0 2026.09.10",
        ),
      ),
      "GLS_COMPENSATION_SUM_MISMATCH",
    );
    // the debt side is checked too: debt - set off = left open
    assert.equal(
      errorCode(
        replaceLine(
          GLS_COMPENSATION_0910_LINES,
          ROW_0910,
          "3480031291 | 28 900 | 18 111 | 10 789 HU00920611 | 18 111 | 100 2026.09.10",
        ),
      ),
      "GLS_COMPENSATION_SUM_MISMATCH",
    );
  });

  it("refuses a letter with two rows instead of guessing how they split", () => {
    assert.equal(
      errorCode(
        replaceLine(GLS_COMPENSATION_0910_LINES, ROW_0910, [
          ROW_0910,
          "3480031291 | 1 000 | 1 000 | 0 HU00920612 | 1 000 | 0 2026.09.10",
        ]),
      ),
      "GLS_COMPENSATION_MULTIPLE_ROWS",
    );
  });

  it("refuses a row with a missing amount", () => {
    assert.equal(
      errorCode(
        replaceLine(
          GLS_COMPENSATION_0910_LINES,
          ROW_0910,
          "3480031291 | 28 900 | 18 111 | HU00920611 | 18 111 | 0 2026.09.10",
        ),
      ),
      "GLS_COMPENSATION_UNREADABLE",
    );
  });

  it("knows a compensation letter from another PDF", () => {
    assert.equal(isGlsCompensationLetter(GLS_COMPENSATION_0910_LINES), true);
    const other = GLS_COMPENSATION_0910_LINES.filter(
      (line) => !line.startsWith("KOMPENZÁCIÓS"),
    );
    assert.equal(isGlsCompensationLetter(other), false);
    assert.equal(errorCode(other), "GLS_DOCUMENT_UNKNOWN");
  });
});
