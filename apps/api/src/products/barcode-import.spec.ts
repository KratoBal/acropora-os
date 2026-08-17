import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseImportFile, summarise } from "./barcode-import.js";

describe("parseImportFile", () => {
  it("reads the key and the barcode by header name, not by position", () => {
    const result = parseImportFile(
      "barcode,unas_id\n5901234123457,159850145\n",
    );
    assert.equal(result.keyKind, "unasId");
    assert.deepEqual(
      result.rows.map((row) => [row.key, row.code]),
      [["159850145", "5901234123457"]],
    );
  });

  it("still accepts a hand-written file keyed by sku", () => {
    const result = parseImportFile("sku,barcode\nACR-113,5901234123457\n");
    assert.equal(result.keyKind, "sku");
    assert.equal(result.rows[0]?.key, "ACR-113");
  });

  it("refuses a file that names both identifiers", () =>
    // Which one wins would be a silent guess about where the barcode belongs.
    assert.throws(
      () => parseImportFile("unas_id,sku,barcode\n1,ACR-113,5901234123457\n"),
      /Pontosan az egyik azonosítót/,
    ));

  it("refuses a file whose header does not name the columns", () => {
    assert.throws(
      () => parseImportFile("159850145,5901234123457\n"),
      /Hiányzó oszlop/,
    );
    assert.throws(
      () => parseImportFile("barcode\n5901234123457\n"),
      /Hiányzó azonosító oszlop/,
    );
    assert.throws(() => parseImportFile("   \n"), /üres/);
  });

  it("rejects an EAN-shaped code whose check digit disagrees", () => {
    // Seven such codes exist in the catalogue, invented by hand rather than
    // read off a product. They must not be imported quietly.
    const result = parseImportFile(
      ["unas_id,barcode", "1,5901234123458"].join("\n"),
    );
    assert.equal(result.rows.length, 0);
    assert.equal(result.rejected[0]?.outcome, "INVALID_EAN_CHECK_DIGIT");
  });

  it("still accepts a code that is not EAN-shaped at all", () => {
    // The shop's internal numbering is not EAN and never claimed to be, so
    // "not applicable" must not be treated as "wrong".
    const result = parseImportFile(
      ["unas_id,barcode", "1,ACRO12345"].join("\n"),
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejected.length, 0);
  });

  it("keeps going after a bad row and reports it by line number", () => {
    const result = parseImportFile(
      [
        "unas_id,barcode",
        "1,5901234123457",
        "2,59/8",
        ",5998200310010",
        "3,96385074",
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
      ["unas_id,barcode", "1,5901234123457", "2,5901234123457"].join("\n"),
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejected[0]?.outcome, "DUPLICATE_IN_FILE");
    assert.match(result.rejected[0]?.reason ?? "", /2\. sorában/);
  });

  it("normalises codes, so a spreadsheet's stray space is not a new barcode", () => {
    const result = parseImportFile("unas_id,barcode\n1,  5901234 123457 \n");
    assert.equal(result.rows[0]?.code, "5901234123457");
  });

  it("reads the optional isPrimary column in the forms a human writes", () => {
    const result = parseImportFile(
      [
        "unas_id,barcode,isPrimary",
        "1,5901234123457,igen",
        "2,96385074,0",
        "3,036000291452,",
      ].join("\n"),
    );
    assert.deepEqual(
      result.rows.map((row) => row.isPrimary),
      [true, false, undefined],
    );
  });

  it("ignores blank lines and surrounding quotes", () => {
    const result = parseImportFile(
      ["unas_id,barcode", "", '"159850145","5901234123457"', ""].join("\n"),
    );
    assert.deepEqual(
      result.rows.map((row) => [row.key, row.code]),
      [["159850145", "5901234123457"]],
    );
  });
});

describe("summarise", () => {
  it("counts every outcome, including the ones that did not occur", () =>
    assert.deepEqual(summarise(["CREATED", "CREATED", "AMBIGUOUS_VARIANT"]), {
      CREATED: 2,
      ALREADY_PRESENT: 0,
      TAKEN_BY_OTHER_VARIANT: 0,
      UNKNOWN_KEY: 0,
      AMBIGUOUS_VARIANT: 1,
      INVALID_BARCODE: 0,
      INVALID_EAN_CHECK_DIGIT: 0,
      MALFORMED_ROW: 0,
      DUPLICATE_IN_FILE: 0,
    }));
});
