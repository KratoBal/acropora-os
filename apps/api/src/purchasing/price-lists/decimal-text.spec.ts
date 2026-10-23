import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareDecimal,
  parseCommaDecimal,
  parseDotDecimal,
  parseSpreadsheetDotDecimal,
} from "./decimal-text.js";

describe("parseDotDecimal", () => {
  it("reads a dot decimal exactly and trims trailing zeros", () => {
    assert.equal(parseDotDecimal("30.65"), "30.65");
    assert.equal(parseDotDecimal("4.10"), "4.1");
    assert.equal(parseDotDecimal("165"), "165");
    assert.equal(parseDotDecimal(" 2.1597 "), "2.1597");
    assert.equal(parseDotDecimal("007.50"), "7.5");
    assert.equal(parseDotDecimal("0.0500"), "0.05");
  });

  it("refuses everything that is not a plain unsigned dot decimal", () => {
    for (const bad of [
      "",
      "4,10",
      "-1.00",
      "1e3",
      "1 000.00",
      "1.2.3",
      ".5",
      "5.",
    ])
      assert.equal(parseDotDecimal(bad), null, bad);
  });

  it("refuses more than four significant decimals instead of rounding", () => {
    assert.equal(parseDotDecimal("1.23456"), null);
    assert.equal(parseDotDecimal("1.2345"), "1.2345");
    // zeros at the end add nothing: 1.23450 is exactly 1.2345
    assert.equal(parseDotDecimal("1.23450"), "1.2345");
    assert.equal(parseDotDecimal("1.234500001"), null);
  });
});

describe("parseCommaDecimal", () => {
  it("reads a comma decimal", () => {
    assert.equal(parseCommaDecimal("45,75"), "45.75");
    assert.equal(parseCommaDecimal("566,07"), "566.07");
    assert.equal(parseCommaDecimal("98,00"), "98");
    assert.equal(parseCommaDecimal("12"), "12");
  });

  it("reads dots only as thousands separators in groups of three", () => {
    assert.equal(parseCommaDecimal("1.234,56"), "1234.56");
    assert.equal(parseCommaDecimal("12.345.678,9"), "12345678.9");
  });

  it("does not guess about a bare dot number", () => {
    assert.equal(parseCommaDecimal("1.234"), null);
    assert.equal(parseCommaDecimal("30.65"), null);
    assert.equal(parseCommaDecimal("1.23,45"), null);
    assert.equal(parseCommaDecimal("45,75 EUR"), null);
    assert.equal(parseCommaDecimal(""), null);
  });
});

describe("compareDecimal", () => {
  it("compares exactly, across different numbers of decimals", () => {
    assert.equal(compareDecimal("30.65", "45.75"), -1);
    assert.equal(compareDecimal("45.75", "30.65"), 1);
    assert.equal(compareDecimal("7.5", "7.50"), 0);
    assert.equal(compareDecimal("7", "7.0001"), -1);
    assert.equal(compareDecimal("100", "99.9999"), 1);
    // a float would call the next two equal (both are the double 2^53)
    assert.equal(compareDecimal("9007199254740993", "9007199254740992"), 1);
    assert.equal(compareDecimal("0.30000000000000004", "0.3"), 1);
  });
});

describe("parseSpreadsheetDotDecimal", () => {
  it("cleans the binary-float noise of a spreadsheet export to the intended price", () => {
    assert.equal(parseSpreadsheetDotDecimal("138.88999999999999"), "138.89");
    assert.equal(parseSpreadsheetDotDecimal("287.04000000000002"), "287.04");
    assert.equal(parseSpreadsheetDotDecimal("74.069999999999993"), "74.07");
    assert.equal(parseSpreadsheetDotDecimal("277.77999999999997"), "277.78");
    assert.equal(parseSpreadsheetDotDecimal("0.30000000000000004"), "0.3");
    // arithmetic noise one unit in the last place off the 15-digit form
    assert.equal(parseSpreadsheetDotDecimal("1.9300000000000002"), "1.93");
    assert.equal(parseSpreadsheetDotDecimal("4.9399999999999995"), "4.94");
  });

  it("reads an ordinary price exactly as the strict reader does", () => {
    assert.equal(parseSpreadsheetDotDecimal("165"), "165");
    assert.equal(parseSpreadsheetDotDecimal("12.50"), "12.5");
    assert.equal(parseSpreadsheetDotDecimal("2.1597"), "2.1597");
  });

  it("still refuses a genuine five-decimal price and anything that is not float noise", () => {
    assert.equal(parseSpreadsheetDotDecimal("1.23456"), null);
    assert.equal(parseSpreadsheetDotDecimal("123.45678"), null);
    // 17 significant digits, but the 15-digit form is a different number
    assert.equal(parseSpreadsheetDotDecimal("123456789012.12345"), null);
    assert.equal(parseSpreadsheetDotDecimal("12,50"), null);
    assert.equal(parseSpreadsheetDotDecimal("-5.00"), null);
    assert.equal(parseSpreadsheetDotDecimal(""), null);
  });
});
