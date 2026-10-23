import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDeJongStocklist } from "./dejong-stocklist.parser.js";
import { PriceListParseError } from "./price-list.types.js";

// Generated, format-faithful: the letterhead, the header row, section titles
// with a stray stock cell, and rows with four cells. No real supplier data.
const LETTERHEAD = [
  "STOCKLIST EXAMPLE MARINELIFE B.V.,,,,,",
  "Tel. +31(0)000-000000,,,,,",
  "WEEK 99,,,,,",
  "We are proud to present a growing list.,,,,,",
  "Code,Description,Price,Stock,Order,",
];

function file(...rows: string[]): string {
  return [...LETTERHEAD, ...rows].join("\r\n") + "\r\n";
}

describe("parseDeJongStocklist", () => {
  it("finds the header below the letterhead and reads dot-decimal prices exactly", () => {
    const parsed = parseDeJongStocklist(
      file(
        "AAA-001,Example fish package 1 (Mix),165,10",
        "AAA-002,Example clownfish pair,12.50,3",
        "AAA-003,Example goby,4.10,0",
      ),
    );
    assert.equal(parsed.format, "DEJONG_STOCKLIST");
    assert.deepEqual(
      parsed.entries.map((e) => [e.supplierSku, e.unitPrice, e.supplierName]),
      [
        ["AAA-001", "165", "Example fish package 1 (Mix)"],
        ["AAA-002", "12.5", "Example clownfish pair"],
        ["AAA-003", "4.1", "Example goby"],
      ],
    );
    assert.equal(parsed.entries[0]!.gtin, null);
    assert.equal(parsed.entries[0]!.brand, null);
    assert.equal(parsed.entries[0]!.listRetailPrice, null);
    assert.deepEqual(parsed.rejected, []);
  });

  it("reads the binary-float noise of a spreadsheet export as the intended price", () => {
    const parsed = parseDeJongStocklist(
      file(
        "AAA-001,Example rock box,138.88999999999999,4",
        "AAA-002,Example arches,287.04000000000002,2",
      ),
    );
    assert.deepEqual(parsed.entries.map((e) => e.unitPrice), ["138.89", "287.04"]);
    assert.deepEqual(parsed.rejected, []);
  });

  it("still rejects a real five-decimal price", () => {
    const parsed = parseDeJongStocklist(file("AAA-001,Example,1.23456,4"));
    assert.deepEqual(parsed.rejected.map((r) => r.reason), ["BAD_PRICE"]);
  });

  it("numbers rows by record, counting the letterhead", () => {
    const parsed = parseDeJongStocklist(file("AAA-001,Example,5,1"));
    assert.equal(parsed.entries[0]!.rowNumber, LETTERHEAD.length + 1);
  });

  it("skips a section title and a blank line, and counts them", () => {
    const parsed = parseDeJongStocklist(
      file("TANKBRED FISHES:,,,1,1", ",,,,,", "AAA-001,Example,5,1"),
    );
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.skippedRows, 2);
    assert.deepEqual(parsed.rejected, []);
  });

  it("rejects a named product without a price, a comma price and a row without a code", () => {
    const parsed = parseDeJongStocklist(
      file(
        "AAA-001,Example without price,,4",
        'AAA-002,Example comma price,"12,50",3',
        ",Example without code,9,1",
        "AAA-004,Example text price,on request,1",
      ),
    );
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      ["NO_PRICE", "BAD_PRICE", "NO_CODE", "BAD_PRICE"],
    );
    assert.equal(parsed.entries.length, 0);
  });

  it("counts an identical repeat and rejects a repeat with another price", () => {
    const parsed = parseDeJongStocklist(
      file(
        "AAA-001,Example,5,1",
        "AAA-001,Example,5.00,1",
        "AAA-001,Example,6,1",
      ),
    );
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.duplicateRows, 1);
    assert.deepEqual(parsed.rejected.map((r) => r.reason), ["CONFLICTING_DUPLICATE"]);
  });

  it("refuses a file without the header", () => {
    assert.throws(
      () => parseDeJongStocklist("Artikelnummer|Preis\n1|2\n"),
      (error) =>
        error instanceof PriceListParseError && error.code === "HEADER_NOT_FOUND",
    );
  });
});
