import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suggestionThreshold } from "./invoice-collection.config.js";
import { suggestionOf } from "./invoice-collection-letter-classifier.js";

/**
 * A JEV BESOROLÁSÁBÓL JAVASLAT (levél-válogatás terv, 4. szelet): tiszta
 * döntés. MI PIROSÍT: ha egy hibás besorolás (bizonyosság 0..1 kívül, üres
 * futás-azonosító, más osztály, küszöb alatti) javaslat lenne; ha a jó nem.
 * Az üres futás-azonosító azért nem javaslat, mert a jóváhagyás azzal oldja fel
 * a futást: nélküle a mérleg sosem tudná meg, mit döntött az ember.
 */
describe("suggestionOf", () => {
  const ok = { kind: "BEJOVO_SZAMLA", confidence: 0.9, decisionRunId: "r1" };

  it("an incoming invoice at or above the threshold is a suggestion", () => {
    assert.deepEqual(suggestionOf(ok, 0.8), {
      confidence: 0.9,
      decisionRunId: "r1",
    });
    assert.deepEqual(suggestionOf({ ...ok, confidence: 0.8 }, 0.8), {
      confidence: 0.8,
      decisionRunId: "r1",
    });
  });

  it("a broken, another or a weaker classification is not", () => {
    for (const bad of [
      null,
      { ...ok, kind: "NYUGTA" },
      { ...ok, confidence: 0.79 },
      { ...ok, confidence: 1.5 },
      { ...ok, confidence: -0.1 },
      { ...ok, confidence: Number.NaN },
      { ...ok, decisionRunId: "" },
    ])
      assert.equal(suggestionOf(bad, 0.8), null, JSON.stringify(bad));
  });
});

/**
 * A KÜSZÖB CONFIGJA: alap 0,8 (nautilus DEV-értékelése), tizedesvesszővel is,
 * a 0,5..1 tartományon kívül az alap. MI PIROSÍT: ha egy elgépelt érték
 * csendben mindent javaslattá tenne (0,3) vagy semmit (2).
 */
describe("suggestionThreshold", () => {
  it("reads the threshold, a Hungarian decimal comma too, and falls back to 0.8", () => {
    const at = (value?: string) =>
      suggestionThreshold(
        value === undefined ? {} : { JEV_INVOICE_COLLECTION_THRESHOLD: value },
      );
    assert.deepEqual(
      [at(), at("0.9"), at("0,95"), at("0.3"), at("2"), at("abc"), at("")],
      [0.8, 0.9, 0.95, 0.8, 0.8, 0.8, 0.8],
    );
  });
});
