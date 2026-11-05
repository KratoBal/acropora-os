import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endOfIssueDay, latestMovements } from "./partner-order-movements.js";

/*
  A MEGRENDELES UTOLSO MOZGASA A NEGY LANCLEPESBOL (S4b-1, barracuda #2230 review). MI PIROSIT: ha a TIG dokumentuma
  vagy a TIG szamlaja nem szamit mozgasnak (a 0. napon kiallitott TIG, a 10. napon az alairt peldany, a 12. napon a
  reszszamla: a 14. napon hamis hatralek-riasztas lenne); ha a szamla datuma a nap ELEJEre esne (egy nappal korabbi
  riasztas); ha az ures datum vagy a megrendeles nelkuli sor kivetelt dob; ha egy regebbi forras felulirna egy ujabbat.
*/
const at = (iso: string) => new Date(iso);

describe("the last movement over the chain's sources", () => {
  it("takes the newest moment over all the sources, per order", () => {
    const moved = latestMovements([
      [{ orderId: "o1", at: at("2026-11-01T08:00:00Z") }],
      [
        { orderId: "o1", at: at("2026-11-11T08:00:00Z") },
        { orderId: "o2", at: at("2026-11-03T08:00:00Z") },
      ],
      [{ orderId: "o1", at: at("2026-11-06T08:00:00Z") }],
    ]);
    assert.equal(moved.get("o1")?.toISOString(), "2026-11-11T08:00:00.000Z");
    assert.equal(moved.get("o2")?.toISOString(), "2026-11-03T08:00:00.000Z");
  });

  it("skips a missing date and a row without an order, and an order with none is absent", () => {
    const moved = latestMovements([
      [
        { orderId: "o1", at: null },
        { orderId: null, at: at("2026-11-01T00:00:00Z") },
      ],
      [],
    ]);
    assert.equal(moved.size, 0);
    assert.equal(latestMovements([]).size, 0);
  });

  it("a TIG on day 0, its signed copy on day 10 and a part invoice on day 12: the last movement is the invoice's day", () => {
    const day0 = at("2026-11-01T09:00:00Z");
    const signedCopy = at("2026-11-11T09:00:00Z");
    const invoice = endOfIssueDay(at("2026-11-13T00:00:00Z"));
    const moved = latestMovements([
      [{ orderId: "o1", at: day0 }],
      [{ orderId: "o1", at: signedCopy }],
      [{ orderId: "o1", at: invoice }],
    ]);
    assert.equal(moved.get("o1")?.toISOString(), "2026-11-14T00:00:00.000Z");
  });
});

describe("an invoice's issue date", () => {
  it("is a day: the movement is the END of it, whatever time of day the column holds", () => {
    for (const iso of [
      "2026-11-04T00:00:00Z",
      "2026-11-04T10:00:00Z",
      "2026-11-04T23:59:59Z",
    ])
      assert.equal(
        endOfIssueDay(at(iso)).toISOString(),
        "2026-11-05T00:00:00.000Z",
        iso,
      );
  });

  it("rolls over the end of a month and of a year", () => {
    assert.equal(
      endOfIssueDay(at("2026-11-30T12:00:00Z")).toISOString(),
      "2026-12-01T00:00:00.000Z",
    );
    assert.equal(
      endOfIssueDay(at("2026-12-31T12:00:00Z")).toISOString(),
      "2027-01-01T00:00:00.000Z",
    );
  });
});
