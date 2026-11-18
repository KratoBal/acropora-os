import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOTH_NOUN, BOTH_NOUN_PLURAL, jobWords } from "./job-words";

/*
  A LAP NEVE A FAJTA SZERINT (hibajegy-maradek lista, 4. fejezet, acrobot 56196). MI PIROSÍT: ha a MAINTENANCE fajta a hibajegy szavait kapja; ha a hibajegy vagy a hiányzó fajta nem hibajegy;
  ha egy ragos alak a másik fajta szavát hordozza; ha a fajta nélküli helyek szava egy fajtára szűkül.
*/
describe("jobWords", () => {
  it("a karbantartási lap a saját nevét kapja, hibajegy-szó nélkül", () => {
    const words = jobWords("MAINTENANCE");
    for (const form of Object.values(words))
      assert.doesNotMatch(form, /hibajegy|jegy/i);
    assert.deepEqual(words, {
      noun: "karbantartási lap",
      nounCap: "Karbantartási lap",
      on: "karbantartási lapon",
      to: "karbantartási laphoz",
      under: "karbantartási lap alatt",
      onto: "karbantartási lapra",
      from: "karbantartási lapról",
    });
  });

  it("a hibajegy, a hiányzó és az ismeretlen fajta hibajegyet mond", () => {
    for (const kind of ["REPAIR", undefined, null, "ALL", "valami"]) {
      const words = jobWords(kind);
      assert.equal(words.noun, "hibajegy");
      assert.equal(words.to, "hibajegyhez");
      for (const form of Object.values(words))
        assert.doesNotMatch(form, /karbantart/i);
    }
  });

  it("a fajta nélküli helyek szava mindkettőt nevezi meg", () => {
    assert.match(BOTH_NOUN, /hibajegy/);
    assert.match(BOTH_NOUN, /karbantartási lap/);
    assert.match(BOTH_NOUN_PLURAL, /hibajegyek/);
    assert.match(BOTH_NOUN_PLURAL, /karbantartási lapok/);
  });
});
