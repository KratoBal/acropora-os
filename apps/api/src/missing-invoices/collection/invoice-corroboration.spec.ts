import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "../missing-invoice-matching.js";
import {
  corroboratedBy,
  nameSigns,
  senderDomain,
} from "./invoice-corroboration.js";

/**
 * A KÖTÉS MÁSODIK JELE (kártya 285d8ffc). Kitalált számlák. MI PIROSÍT: ha az
 * összeg, a név vagy a feladó nem számítana jelnek; ha bármelyik véletlen
 * egyezésre (rövid szó, részleges összeg) is elég lenne; ha a feladó cím nem a
 * tartományát adná.
 */
const hooks = { normalizeName };
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

describe("generic words are no sign of a supplier (barracuda 35766)", () => {
  const telekom = { grossCents: [], supplierNames: ["Magyar Telekom Nyrt."] };

  it("does not let 'magyar' alone corroborate a Magyar Telekom invoice", () => {
    assert.equal(
      corroboratedBy(
        ["Számla", "Magyar Államkincstár, magyar nyelvű tájékoztató"],
        telekom,
        null,
        hooks,
      ),
      null,
    );
    assert.equal(
      corroboratedBy(["Számla", "Telekom díjak"], telekom, null, hooks),
      "NAME",
    );
  });

  it("does not take a 'magyar' domain for a Magyar Telekom sender, but a Telekom domain", () => {
    assert.equal(
      corroboratedBy(["Számla"], telekom, "x@magyar-posta.example", hooks),
      null,
    );
    assert.equal(
      corroboratedBy(["Számla"], telekom, "x@telekom.example", hooks),
      "SENDER",
    );
  });

  it("gives a name made only of generic words no name or sender sign at all", () => {
    const generic = { grossCents: [], supplierNames: ["Global Trade Kft."] };
    assert.deepEqual(nameSigns("Global Trade Kft.", normalizeName), []);
    assert.equal(
      corroboratedBy(
        ["Global trade invoice"],
        generic,
        "a@global-trade.example",
        hooks,
      ),
      null,
    );
  });

  it("needs both distinctive words of a two-word name in the text", () => {
    const gumi = { grossCents: [], supplierNames: ["Gumi Profi Team Kft."] };
    assert.deepEqual(nameSigns("Gumi Profi Team Kft.", normalizeName), [
      "gumi",
      "profi",
    ]);
    assert.equal(corroboratedBy(["Gumi akció"], gumi, null, hooks), null);
    assert.equal(
      corroboratedBy(["Gumi Profi számla"], gumi, null, hooks),
      "NAME",
    );
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
