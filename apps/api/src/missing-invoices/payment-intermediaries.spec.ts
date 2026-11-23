import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  foldText,
  isIntermediaryIssuer,
  issuersForPayment,
  parsePaymentIntermediaries,
} from "./payment-intermediaries.js";

/*
  A KONFIGBÓL JÖVŐ LEKÉPEZÉS (acrobot 58103). MI PIROSÍT: ha a hibás JSON, a nem tömb, a hibás reguláris kifejezés vagy a
  túl hosszú minta kivételt dob, vagy az egész listát viszi (egy rossz elem mellett a jó elem is eltűnik); ha egy hibás
  elem NEM kerül a problémák közé (csendes eldobás); ha az ékezetes név az ékezet nélküli mintára nem illeszkedik; ha egy
  regex-escape (`\S`) a tisztítás után az ellenkezője lesz; ha a közvetítő mintája nem a közleményen ÉS a partnernéven
  fut; ha az üres konfiguráció bármit felismer.
*/
const EXAMPLE = JSON.stringify([
  { payment: "simplep[*]dijne", issuers: ["^mohu\\b", "csatornazasi muvek"] },
  { payment: "pcsomag", issuers: ["micro-?trend"] },
]);

describe("parsePaymentIntermediaries", () => {
  it("reads the example with two mappings and no problem", () => {
    const parsed = parsePaymentIntermediaries(EXAMPLE);
    assert.equal(parsed.intermediaries.length, 2);
    assert.deepEqual(parsed.problems, []);
  });

  it("an empty or missing value is an empty list, not a problem", () => {
    for (const value of [undefined, "", "   "]) {
      const parsed = parsePaymentIntermediaries(value);
      assert.deepEqual(parsed.intermediaries, []);
      assert.deepEqual(parsed.problems, []);
    }
  });

  it("invalid JSON and a non-array give an empty list and say why", () => {
    assert.deepEqual(
      parsePaymentIntermediaries("{not json").intermediaries,
      [],
    );
    assert.deepEqual(parsePaymentIntermediaries("{not json").problems, [
      "not valid JSON",
    ]);
    assert.deepEqual(parsePaymentIntermediaries('{"payment":"x"}').problems, [
      "not a JSON array",
    ]);
  });

  it("a bad entry is skipped and named, the good one beside it stays", () => {
    const parsed = parsePaymentIntermediaries(
      JSON.stringify([
        { payment: "(unclosed", issuers: ["x"] },
        { payment: "pcsomag", issuers: ["micro-?trend", "[bad"] },
        { payment: "pcsomag" },
        "nonsense",
        { payment: "a".repeat(201), issuers: ["x"] },
      ]),
    );
    assert.equal(parsed.intermediaries.length, 1);
    assert.equal(parsed.intermediaries[0]!.issuers.length, 1);
    assert.equal(parsed.problems.length, 5);
    assert.ok(parsed.problems.some((p) => p.startsWith("entry 1 payment")));
    assert.ok(parsed.problems.some((p) => p.startsWith("entry 2 issuers[1]")));
    assert.ok(parsed.problems.some((p) => p.startsWith("entry 3 issuers")));
    assert.ok(
      parsed.problems.some((p) => p.startsWith("entry 4: not an object")),
    );
    assert.ok(parsed.problems.some((p) => p.startsWith("entry 5 payment")));
  });

  it("only the first 50 entries are read, and it says so", () => {
    const many = Array.from({ length: 51 }, () => ({
      payment: "x",
      issuers: ["y"],
    }));
    const parsed = parsePaymentIntermediaries(JSON.stringify(many));
    assert.equal(parsed.intermediaries.length, 50);
    assert.deepEqual(parsed.problems, ["only the first 50 entries are read"]);
  });
});

describe("matching a payment and an issuer", () => {
  const { intermediaries } = parsePaymentIntermediaries(EXAMPLE);
  const payment = (counterpartyName: string | null, narrative = "") => ({
    counterpartyName,
    narrative,
  });

  it("the payment pattern reads the counterparty name AND the narrative, and the truncated statement form", () => {
    assert.equal(
      issuersForPayment(intermediaries, payment("SIMPLEP*dijnet")).length,
      2,
    );
    assert.equal(
      issuersForPayment(
        intermediaries,
        payment(null, "2026.05.10 SIMPLEP*DIJNE 1234"),
      ).length,
      2,
    );
    assert.equal(
      issuersForPayment(intermediaries, payment("PCSOMAG356")).length,
      1,
    );
    assert.equal(
      issuersForPayment(intermediaries, payment("SIMPLEP*VIZMUVEK.HU")).length,
      0,
    );
    assert.equal(issuersForPayment([], payment("SIMPLEP*dijnet")).length, 0);
  });

  it("an accented issuer name matches an accent-free pattern, case-insensitively", () => {
    const issuers = issuersForPayment(
      intermediaries,
      payment("SIMPLEP*dijnet"),
    );
    assert.equal(
      isIntermediaryIssuer(issuers, "Fővárosi CSATORNÁZÁSI MŰVEK Zrt."),
      true,
    );
    assert.equal(
      isIntermediaryIssuer(issuers, "MOHU MOL Hulladékgazdálkodási Zrt."),
      true,
    );
    assert.equal(isIntermediaryIssuer(issuers, "Dijnet Zrt."), false);
    // ^mohu\b: the word, not a prefix of another one
    assert.equal(isIntermediaryIssuer(issuers, "MOHUSZ Kft."), false);
  });

  it("a regex escape survives the accent folding (no lower-casing of the pattern)", () => {
    const parsed = parsePaymentIntermediaries(
      JSON.stringify([{ payment: "x", issuers: ["^abc\\S+"] }]),
    );
    const issuers = parsed.intermediaries[0]!.issuers;
    assert.equal(isIntermediaryIssuer(issuers, "ABCdef"), true);
    assert.equal(isIntermediaryIssuer(issuers, "ABC def"), false);
    assert.equal(foldText("Művek"), "Muvek");
  });
});
