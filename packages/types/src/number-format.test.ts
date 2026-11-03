import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currencyLabel,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  MISSING_VALUE_TEXT,
} from "./number-format.js";

/**
 * What must fail: the raw stored decimal ("6141.7323") or the ISO code ("HUF") reaching the
 * screen (#2079); a missing value turning into "0" or "NaN"; a non-number hidden as a number;
 * the forint getting decimals or another currency losing them.
 *
 * Intl writes a no-break space between digit groups; the expectations spell it out.
 */
const NBSP = " ";

describe("formatMoney", () => {
  it("writes the forint whole, grouped, with Ft (the #2079 value)", () => {
    assert.equal(formatMoney("6141.7323", "HUF"), "6142 Ft");
    assert.equal(formatMoney("12700", "HUF"), `12${NBSP}700 Ft`);
    assert.equal(formatMoney(-1234567, "huf"), `-1${NBSP}234${NBSP}567 Ft`);
    assert.equal(formatMoney("0", "HUF"), "0 Ft");
  });

  it("writes another currency with two decimals and its code", () => {
    assert.equal(formatMoney("100.5", "EUR"), "100,50 EUR");
    assert.equal(formatMoney(12500, " usd "), `12${NBSP}500,00 USD`);
  });

  it("leaves the currency off when there is none, with at most two decimals", () => {
    assert.equal(formatMoney("6141.7323", null), "6141,73");
    assert.equal(formatMoney("3000", ""), "3000");
  });

  it("writes a missing amount as a dash, not as zero", () => {
    assert.equal(formatMoney(null, "HUF"), MISSING_VALUE_TEXT);
    assert.equal(formatMoney(undefined, "HUF"), MISSING_VALUE_TEXT);
    assert.equal(formatMoney("  ", "HUF"), MISSING_VALUE_TEXT);
  });

  it("keeps a non-number as it came, so the data error stays visible", () => {
    assert.equal(formatMoney("12,5", "HUF"), "12,5");
    assert.equal(formatMoney("abc", "EUR"), "abc");
  });
});

describe("formatNumber, formatQuantity, formatPercent", () => {
  it("uses the comma and drops trailing zeros", () => {
    assert.equal(formatNumber("1.500"), "1,5");
    assert.equal(formatNumber(0.1234), "0,123");
    assert.equal(formatNumber(12500), `12${NBSP}500`);
    assert.equal(formatNumber(2.5, 0), "3");
  });

  it("keeps every stored quantity decimal up to six", () => {
    assert.equal(formatQuantity("0.125000"), "0,125");
    assert.equal(formatQuantity("1.000001"), "1,000001");
    assert.equal(formatQuantity("4"), "4");
  });

  it("writes percentage points with the sign and no space", () => {
    assert.equal(formatPercent(27), "27%");
    assert.equal(formatPercent("12.5"), "12,5%");
    assert.equal(formatPercent(null), MISSING_VALUE_TEXT);
    assert.equal(formatPercent("n/a"), "n/a");
  });

  it("writes a missing number as a dash and keeps a non-number", () => {
    assert.equal(formatNumber(null), MISSING_VALUE_TEXT);
    assert.equal(formatQuantity(""), MISSING_VALUE_TEXT);
    assert.equal(formatNumber("1,2,3"), "1,2,3");
  });
});

describe("currencyLabel", () => {
  it("writes the forint as Ft and another currency as its code", () => {
    assert.equal(currencyLabel(" huf "), "Ft");
    assert.equal(currencyLabel("eur"), "EUR");
    assert.equal(currencyLabel(null), "");
  });
});
