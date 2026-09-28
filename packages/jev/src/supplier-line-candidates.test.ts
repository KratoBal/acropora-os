import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANDIDATE_LIMIT,
  candidateTokens,
  foldCandidateText,
  generateCandidates,
  indexCandidateMaster,
  type CandidateProfile,
} from "./supplier-line-candidates.js";

/**
 * A szabályok egyenként, szintetikus törzsön. A valódi törzsön mért paritást
 * (260 név, a Python `stage-a-v3` ellen) a PR írja le; ezek a tesztek azt a
 * két szabályt is lefedik, amit az a 260 név nem próbál ki: a "ß" hajtogatását
 * és a címszót.
 */
const PROFILE: CandidateProfile = {
  brandRouting: [{ pattern: /^fm\d{5}$/, words: ["fauna", "marin"] }],
  brandAliases: [{ when: ["microbe", "lift"], alternatives: [["arka"]] }],
  titleWords: ["dr"],
};

const MASTER = indexCandidateMaster([
  { variantId: "v01", text: "Fauna Marin Professional Sea Salt 20kg" },
  { variantId: "v02", text: "Fauna Marin Professional Sea Salt 4kg" },
  { variantId: "v03", text: "Fauna Marin Balling Calcium Mix 2 kg" },
  { variantId: "v04", text: "Dr. Bassleer Biofish-food Garlic XL 68g" },
  { variantId: "v05", text: "Dr. Tim's Aquatics One & Only 100ml" },
  { variantId: "v06", text: "ARKA myAqua190 - finom szűrő" },
  { variantId: "v07", text: "Rowaphos foszfátmegkötő 250 ml" },
  { variantId: "v08", text: "Tropic Marin Pro-Reef tengeri só 25 kg" },
  { variantId: "v09", text: "Große Pumpe 300W" },
]);

const run = (name: string, code = "") =>
  generateCandidates(name, code, MASTER, PROFILE);

describe("generateCandidates (stage-a-v3)", () => {
  it("folds like Python: accents off, casefold, and ß becomes ss", () => {
    assert.equal(foldCandidateText("Größe Szűrő"), "grosse szuro");
    assert.deepEqual(
      [...candidateTokens("Größe S, 20 kg")],
      ["grosse", "20", "kg"],
    );
    // a German ß meets the same word written out
    assert.deepEqual(run("Grosse Pumpe").candidates, ["v09"]);
  });

  it("splits at letter/digit borders and drops one-letter words, not digits", () => {
    assert.deepEqual(
      [...candidateTokens("myAqua1900 150W 5 x")].sort(),
      ["150", "1900", "5", "myaqua"].sort(),
    );
  });

  it("routes a code prefix to its brand, and only a full-code match counts", () => {
    const routed = run("SEA Salz 20 kg", "fm14264");
    assert.equal(routed.brandSource, "routing");
    assert.deepEqual(routed.candidates.slice(0, 3), ["v01", "v02", "v03"]);
    assert.equal(run("SEA Salz 20 kg", "fm142641").brandSource, "nev");
  });

  it("a title word takes the next word into the brand", () => {
    // with the title rule the brand is {dr, bassleer}: Dr. Tim's is not in the pool
    assert.deepEqual(run("Dr. Bassleer BF Garlic L 150 g").candidates, ["v04"]);
    const noTitle = generateCandidates(
      "Dr. Bassleer BF Garlic L 150 g",
      "",
      MASTER,
      { ...PROFILE, titleWords: [] },
    );
    assert.deepEqual(noTitle.candidates, ["v04", "v05"]);
  });

  it("a brand alias adds a pool, and a 4-letter prefix is a brand match", () => {
    // no shared word at all: only the alias brings the ARKA row in
    assert.deepEqual(run("Microbe-Lift Feinfilter").candidates, ["v06"]);
    assert.deepEqual(run("RowaPhos 500 ml").candidates, ["v07"]);
  });

  it("with no brand hit falls back to the whole master, without the brand bonus", () => {
    const fallback = run("Zeovit Salz 25 kg");
    assert.equal(fallback.fallback, true);
    // "25" and "kg" are shared with v08 only once each; one shared word is enough
    assert.equal(fallback.candidates[0], "v08");
    assert.ok(!fallback.candidates.includes("v04"));
  });

  it("orders by score, then by variant id in code-point order, at most K", () => {
    const many = indexCandidateMaster(
      Array.from({ length: 40 }, (_, i) => ({
        variantId: `v${String(39 - i).padStart(2, "0")}`,
        text: "Fauna Marin Artikel",
      })),
    );
    const result = generateCandidates("Fauna Marin Artikel", "", many, PROFILE);
    assert.equal(result.candidates.length, CANDIDATE_LIMIT);
    assert.deepEqual(result.candidates.slice(0, 3), ["v00", "v01", "v02"]);
  });
});
