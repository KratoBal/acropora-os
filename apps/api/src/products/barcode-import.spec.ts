import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseImportFile, summarise } from "./barcode-import.js";

describe("parseImportFile", () => {
  it("reads sku and barcode by header name, not by position", () => {
    const result = parseImportFile("barcode,sku\n5901234123457,ACR-113\n");
    assert.deepEqual(
      result.rows.map((row) => [row.sku, row.code]),
      [["ACR-113", "5901234123457"]],
    );
  });

  it("refuses a file whose header does not name the columns", () => {
    // Importing barcodes as SKUs because someone swapped two columns is
    // exactly the failure a required header exists to prevent.
    assert.throws(
      () => parseImportFile("ACR-113,5901234123457\n"),
      /Hiányzó oszlop/,
    );
    assert.throws(() => parseImportFile("   \n"), /üres/);
  });

  it("keeps going after a bad row and reports it by line number", () => {
    const result = parseImportFile(
      [
        "sku,barcode",
        "ACR-113,5901234123457",
        "ACR-114,59/8",
        ",5901234123458",
        "ACR-115,96385074",
      ].join("\n"),
    );
    assert.equal(result.rows.length, 2);
    assert.deepEqual(
      result.rejected.map((row) => [row.line, row.outcome]),
      [
        [3, "INVALID_BARCODE"],
        [4, "MALFORMED_ROW"],
      ],
    );
  });

  it("catches a code repeated inside the file before it reaches the database", () => {
    const result = parseImportFile(
      ["sku,barcode", "ACR-113,5901234123457", "ACR-114,5901234123457"].join(
        "\n",
      ),
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejected[0]?.outcome, "DUPLICATE_IN_FILE");
    assert.match(result.rejected[0]?.reason ?? "", /2\. sorában/);
  });

  it("normalises codes, so a spreadsheet's stray space is not a new barcode", () => {
    const result = parseImportFile("sku,barcode\nACR-113,  5901234 123457 \n");
    assert.equal(result.rows[0]?.code, "5901234123457");
  });

  it("carries the EAN verdict per row without rejecting on it", () => {
    const result = parseImportFile(
      [
        "sku,barcode",
        "ACR-113,5901234123457",
        "ACR-114,5901234123458",
        "ACR-115,ACRO12345",
      ].join("\n"),
    );
    assert.deepEqual(
      result.rows.map((row) => row.eanCheckDigitValid),
      [true, false, null],
    );
  });

  it("reads the optional isPrimary column in the forms a human writes", () => {
    const result = parseImportFile(
      [
        "sku,barcode,isPrimary",
        "ACR-113,5901234123457,igen",
        "ACR-114,96385074,0",
        "ACR-115,036000291452,",
      ].join("\n"),
    );
    assert.deepEqual(
      result.rows.map((row) => row.isPrimary),
      [true, false, undefined],
    );
  });

  it("ignores blank lines and surrounding quotes", () => {
    const result = parseImportFile(
      ["sku,barcode", "", '"ACR-113","5901234123457"', ""].join("\n"),
    );
    assert.deepEqual(
      result.rows.map((row) => [row.sku, row.code]),
      [["ACR-113", "5901234123457"]],
    );
  });
});

describe("summarise", () => {
  it("counts every outcome, including the ones that did not occur", () =>
    assert.deepEqual(summarise(["CREATED", "CREATED", "UNKNOWN_SKU"]), {
      CREATED: 2,
      ALREADY_PRESENT: 0,
      TAKEN_BY_OTHER_VARIANT: 0,
      UNKNOWN_SKU: 1,
      INVALID_BARCODE: 0,
      MALFORMED_ROW: 0,
      DUPLICATE_IN_FILE: 0,
    }));
});
