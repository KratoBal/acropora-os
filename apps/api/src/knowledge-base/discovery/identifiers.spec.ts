import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normaliseDoi,
  normaliseLicence,
  normaliseOpenAlexId,
  normalisePmcid,
  normalisePmid,
  stricterLicence,
} from "./identifiers.js";

describe("identifiers: one spelling per identifier", () => {
  it("a DOI loses its resolver prefix and its case, the three API spellings meet", () => {
    const spellings = [
      "https://doi.org/10.1016/J.MARPOLBUL.2017.02.044", // OpenAlex
      "10.1016/j.marpolbul.2017.02.044", // Crossref, Europe PMC
      "doi:10.1016/j.marpolbul.2017.02.044",
      "http://dx.doi.org/10.1016/j.marpolbul.2017.02.044",
      "  10.1016/j.marpolbul.2017.02.044 ",
    ];
    for (const s of spellings)
      assert.equal(normaliseDoi(s), "10.1016/j.marpolbul.2017.02.044", s);
  });

  it("what is not a DOI is null, not a guess", () => {
    for (const s of [
      "",
      "10.1/x",
      "11.1016/abc",
      "10.1016/",
      "10.1016/a b",
      null,
      42,
    ])
      assert.equal(normaliseDoi(s), null, String(s));
  });

  it("PMID, PMCID and OpenAlex id in every spelling the APIs use", () => {
    assert.equal(
      normalisePmid("https://pubmed.ncbi.nlm.nih.gov/42467015"),
      "42467015",
    );
    assert.equal(normalisePmid("42467015"), "42467015");
    assert.equal(normalisePmid(42467015), "42467015");
    assert.equal(normalisePmid("PMC1"), null);
    assert.equal(normalisePmcid("PMC13459583"), "PMC13459583");
    assert.equal(normalisePmcid("pmc13459583"), "PMC13459583");
    assert.equal(
      normalisePmcid("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/"),
      "PMC123",
    );
    // digits alone could be a PMID: not taken as a PMCID
    assert.equal(normalisePmcid("13459583"), null);
    assert.equal(
      normaliseOpenAlexId("https://openalex.org/W2008072895"),
      "W2008072895",
    );
    assert.equal(normaliseOpenAlexId("w12"), "W12");
    assert.equal(normaliseOpenAlexId("https://openalex.org/A5088877069"), null);
  });
});

describe("licences", () => {
  it("reads the three spellings to one value", () => {
    const cases: [string, string][] = [
      ["cc-by", "CC-BY"], // OpenAlex
      ["cc-by-nc", "CC-BY-NC"],
      ["cc by", "CC-BY"], // Europe PMC
      ["cc by-nc-nd", "CC-BY-NC-ND"],
      ["https://creativecommons.org/licenses/by-nc/4.0/", "CC-BY-NC"], // Crossref
      ["http://creativecommons.org/licenses/by-sa/3.0/", "CC-BY-SA"],
      ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0"],
      ["cc0", "CC0"],
    ];
    for (const [raw, value] of cases)
      assert.equal(normaliseLicence(raw), value, raw);
  });

  it("a publisher's own licence or an unknown word says nothing: UNKNOWN", () => {
    for (const raw of [
      "https://journals.asm.org/non-commercial-tdm-license",
      "https://www.elsevier.com/tdm/userlicense/1.0/",
      "implied-oa",
      "",
      null,
    ])
      assert.equal(normaliseLicence(raw), "UNKNOWN", String(raw));
  });

  it("the stricter statement wins, and UNKNOWN never overrides a stated one", () => {
    assert.equal(stricterLicence("CC-BY", "CC-BY-NC"), "CC-BY-NC");
    assert.equal(stricterLicence("CC-BY-NC", "CC-BY"), "CC-BY-NC");
    assert.equal(stricterLicence("CC-BY", "UNKNOWN"), "CC-BY");
    assert.equal(stricterLicence("UNKNOWN", "CC0"), "CC0");
    assert.equal(stricterLicence("CC-BY-NC-ND", "CLOSED"), "CLOSED");
  });
});
