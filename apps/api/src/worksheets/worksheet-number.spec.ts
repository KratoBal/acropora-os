import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetNumber,
  worksheetNumberIssue,
  worksheetYear,
  WORKSHEET_NUMBER_ISSUE_MESSAGES,
} from "./worksheet-number.js";

describe("worksheet number", () => {
  it("formats the agreed four-part number", () => {
    assert.equal(
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "BIO",
        year: 2026,
        sequence: 1,
      }).number,
      "FANK-BIO-2026-001",
    );
  });

  it("grows past three digits instead of wrapping around", () => {
    const last = buildWorksheetNumber({
      partnerCode: "FANK",
      departmentCode: "BIO",
      year: 2026,
      sequence: 999,
    });
    const next = buildWorksheetNumber({
      partnerCode: "FANK",
      departmentCode: "BIO",
      year: 2026,
      sequence: 1000,
    });
    assert.equal(last.number, "FANK-BIO-2026-999");
    assert.equal(next.number, "FANK-BIO-2026-1000");
  });

  it("keeps growing past four digits as well", () => {
    // A hárommal feltöltés alsó korlát, nem felső: a sorszám nem vágódik és
    // nem fordul át, csak hosszabb lesz. Egy sorozat sem áll meg attól, hogy
    // egy partner sokat dolgozik.
    assert.equal(
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "BIO",
        year: 2026,
        sequence: 10000,
      }).number,
      "FANK-BIO-2026-10000",
    );
  });

  it("refuses a partner without an abbreviation", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: null, departmentCode: "BIO" }),
      "PARTNER_CODE_MISSING",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "  ", departmentCode: "BIO" }),
      "PARTNER_CODE_MISSING",
    );
  });

  it("refuses a worksheet without a department code", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: null }),
      "DEPARTMENT_CODE_MISSING",
    );
  });

  it("refuses codes that would produce a differently shaped number", () => {
    assert.equal(
      worksheetNumberIssue({ partnerCode: "fank", departmentCode: "BIO" }),
      "PARTNER_CODE_INVALID",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "BIOD" }),
      "DEPARTMENT_CODE_INVALID",
    );
    assert.equal(
      worksheetNumberIssue({ partnerCode: "FANK", departmentCode: "BIO" }),
      null,
    );
  });

  it("has a Hungarian message for every issue", () => {
    for (const issue of [
      "PARTNER_CODE_MISSING",
      "PARTNER_CODE_INVALID",
      "DEPARTMENT_CODE_MISSING",
      "DEPARTMENT_CODE_INVALID",
    ] as const) {
      assert.ok(WORKSHEET_NUMBER_ISSUE_MESSAGES[issue].length > 10);
    }
  });

  it("never sends the reader to the customer page, where the field cannot be edited", () => {
    for (const message of Object.values(WORKSHEET_NUMBER_ISSUE_MESSAGES)) {
      assert.ok(
        !/vev[őo]/i.test(message),
        `a message still names the customer: ${message}`,
      );
    }
  });

  it("sends the reader to the partner page for a missing abbreviation", () => {
    assert.match(
      WORKSHEET_NUMBER_ISSUE_MESSAGES.PARTNER_CODE_MISSING,
      /partner adatlapján/,
    );
  });

  it("rejects a sequence that was never allocated", () => {
    assert.throws(() =>
      buildWorksheetNumber({
        partnerCode: "FANK",
        departmentCode: "BIO",
        year: 2026,
        sequence: 0,
      }),
    );
  });

  it("takes the year from Budapest local time, not from UTC", () => {
    // 2026. december 31. 23:30 UTC = 2027. január 1. 00:30 Budapesten.
    // A lezárás tehát már az új sorozatba tartozik.
    const turnOfYear = new Date("2026-12-31T23:30:00.000Z");
    assert.equal(worksheetYear(turnOfYear), 2027);
    assert.equal(worksheetYear(turnOfYear, "UTC"), 2026);
  });
});
