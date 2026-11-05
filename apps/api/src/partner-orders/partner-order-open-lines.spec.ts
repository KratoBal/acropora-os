import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { openLineCount } from "./partner-order-open-lines.js";

/*
  A HATRALEKOS TETELEK SZAMA (S4, 38caeac2). MI PIROSIT: ha a reszteljesites nem csokkenti a hatralekot
  (a tetel nyitott marad, amig valami hatra van, es nem addig, amig egy TIG sem szol rola); ha egy teljesen
  igazolt tetel nyitottnak szamit; ha a tobbszoros TIG egy tetelre nem adodik ossze; ha egy MASIK tetel TIG-je
  levonodik; ha a tizedes mennyiseg lebegopontosan hasonlitodik.
*/
const lines = [
  { quoteItemId: "a", quantity: "10" },
  { quoteItemId: "b", quantity: "2.5" },
  { quoteItemId: "c", quantity: "1" },
];

describe("the open line count", () => {
  it("every line is open while nothing is certified", () => {
    assert.equal(openLineCount(lines, []), 3);
  });

  it("a part certificate leaves the line open, the closing one closes it", () => {
    assert.equal(
      openLineCount(lines, [{ quoteItemId: "a", quantity: "4" }]),
      3,
    );
    assert.equal(
      openLineCount(lines, [
        { quoteItemId: "a", quantity: "4" },
        { quoteItemId: "a", quantity: new Prisma.Decimal("6") },
      ]),
      2,
    );
  });

  it("a fully certified order has no open line", () => {
    assert.equal(
      openLineCount(lines, [
        { quoteItemId: "a", quantity: "10" },
        { quoteItemId: "b", quantity: "2.5" },
        { quoteItemId: "c", quantity: "1" },
      ]),
      0,
    );
  });

  it("one line's certificate never closes another's", () => {
    assert.equal(
      openLineCount(lines, [{ quoteItemId: "b", quantity: "10" }]),
      2,
    );
  });

  it("a decimal quantity is compared exactly: 0.1 + 0.2 closes a line of 0.3", () => {
    assert.equal(
      openLineCount(
        [{ quoteItemId: "x", quantity: "0.3" }],
        [
          { quoteItemId: "x", quantity: "0.1" },
          { quoteItemId: "x", quantity: "0.2" },
        ],
      ),
      0,
    );
  });

  it("a certified line the order does not have is ignored, and an order with no lines has none open", () => {
    assert.equal(
      openLineCount(lines, [{ quoteItemId: "zz", quantity: "5" }]),
      3,
    );
    assert.equal(openLineCount([], [{ quoteItemId: "a", quantity: "1" }]), 0);
  });
});
