import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "../missing-invoice-matching.js";
import { corroboratedBy, senderDomain } from "./invoice-corroboration.js";

/**
 * A KÖTÉS MÁSODIK JELE (kártya 285d8ffc). Kitalált számlák. MI PIROSÍT: ha az
 * összeg, a név vagy a feladó nem számítana jelnek; ha bármelyik véletlen
 * egyezésre (rövid szó, részleges összeg) is elég lenne; ha a feladó cím nem a
 * tartományát adná.
 */
const hooks = {
  normalizeName,
  distinctiveWord: (name: string) =>
    normalizeName(name)
      .split(" ")
      .find((word) => word.length >= 4) ?? null,
};
const lines = [
  "Számla",
  "Kiállító: Tisza Kereskedelmi Kft.",
  "Végösszeg: 73 139,00 Ft",
];
const none = { grossCents: [], supplierNames: [] };

describe("corroboratedBy", () => {
  it("accepts the gross amount as a money value in the text", () => {
    assert.equal(
      corroboratedBy(lines, { ...none, grossCents: [7313900] }, null, hooks),
      "AMOUNT",
    );
  });

  it("accepts the supplier name's distinctive word as a whole word", () => {
    assert.equal(
      corroboratedBy(
        lines,
        { ...none, supplierNames: ["Tisza Kereskedelmi Kft"] },
        null,
        hooks,
      ),
      "NAME",
    );
  });

  it("does not take a part of a word for the name", () => {
    assert.equal(
      corroboratedBy(
        ["Számla", "Kiállító: Tiszavasvári Kft."],
        { ...none, supplierNames: ["Tisza Kft"] },
        null,
        hooks,
      ),
      null,
    );
  });

  it("accepts a sender whose domain carries the supplier name", () => {
    assert.equal(
      corroboratedBy(
        ["Számla"],
        { ...none, supplierNames: ["Tisza Kereskedelmi Kft"] },
        "Számlázás <szamla@tisza97.example>",
        hooks,
      ),
      "SENDER",
    );
  });

  it("returns nothing when no sign stands: other amount, other name, other sender", () => {
    assert.equal(
      corroboratedBy(
        ["Számla", "Kiállító: Másik Bt.", "Végösszeg: 1 000,00 Ft"],
        {
          grossCents: [7313900],
          supplierNames: ["Tisza Kereskedelmi Kft"],
        },
        "x@mas.example",
        hooks,
      ),
      null,
    );
  });

  it("ignores a zero amount and an empty fact set", () => {
    assert.equal(
      corroboratedBy(["0"], { ...none, grossCents: [0] }, null, hooks),
      null,
    );
    assert.equal(corroboratedBy(lines, none, "a@tisza.hu", hooks), null);
  });
});

describe("senderDomain", () => {
  it("takes the domain of a plain address and of a named one", () => {
    assert.equal(senderDomain("szamla@Tisza-97.example"), "tisza97example");
    assert.equal(senderDomain("A B <x@gumi.hu>"), "gumihu");
    assert.equal(senderDomain(null), null);
    assert.equal(senderDomain("nincs kukac"), null);
  });
});
