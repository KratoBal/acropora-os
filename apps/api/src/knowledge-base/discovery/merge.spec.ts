import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ID_FIELDS, mergeCandidates } from "./merge.js";
import type { SourceCandidate } from "./records.js";
import { isStorable, versionsFor } from "./store-plan.js";

function candidate(over: Partial<SourceCandidate>): SourceCandidate {
  return {
    doi: null,
    openalexId: null,
    pmid: null,
    pmcid: null,
    kind: "PEER_REVIEWED",
    title: "Kitalált",
    authors: [],
    year: null,
    venue: null,
    url: null,
    licence: "UNKNOWN",
    oaUrl: null,
    discoveredVia: "OPENALEX",
    retractedFlag: false,
    referencedWorks: [],
    ...over,
  };
}

describe("merging candidates by identifier", () => {
  it("joins transitively: DOI to PMID to PMCID", () => {
    const { candidates, conflicts } = mergeCandidates([
      candidate({ doi: "10.5555/a", openalexId: "W1" }),
      candidate({ pmid: "7", pmcid: "PMC7", discoveredVia: "EUROPE_PMC" }),
      candidate({ doi: "10.5555/a", pmid: "7", discoveredVia: "EUROPE_PMC" }),
      candidate({ doi: "10.5555/b" }),
    ]);
    assert.equal(candidates.length, 2);
    assert.deepEqual(conflicts, []);
    const [a] = candidates;
    assert.equal(a?.doi, "10.5555/a");
    assert.equal(a?.openalexId, "W1");
    assert.equal(a?.pmid, "7");
    assert.equal(a?.pmcid, "PMC7");
    assert.equal(a?.discoveredVia, "OPENALEX", "the first finder stays");
  });

  it("no two results share any identifier (S2: duplicates 0)", () => {
    const input = [
      candidate({ doi: "10.5555/a", pmid: "1" }),
      candidate({ pmid: "1", openalexId: "W9" }),
      candidate({ openalexId: "W9", pmcid: "PMC3" }),
      candidate({ pmcid: "PMC3" }),
      candidate({ doi: "10.5555/c" }),
      candidate({ doi: "10.5555/c", pmid: "5" }),
    ];
    const { candidates } = mergeCandidates(input);
    for (const field of ID_FIELDS) {
      const values = candidates.map((c) => c[field]).filter(Boolean);
      assert.equal(new Set(values).size, values.length, field);
    }
    assert.equal(candidates.length, 2);
  });

  it("two values of one identifier in a group are reported, the first kept", () => {
    const { candidates, conflicts } = mergeCandidates([
      candidate({ doi: "10.5555/a", pmid: "1" }),
      candidate({ doi: "10.5555/z", pmid: "1" }),
    ]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.doi, "10.5555/a");
    assert.deepEqual(conflicts, [
      { identifier: "doi", values: ["10.5555/a", "10.5555/z"] },
    ]);
  });

  it("licence: the stricter statement; a review stays a review; Europe PMC's open copy first", () => {
    const [merged] = mergeCandidates([
      candidate({
        doi: "10.5555/a",
        licence: "CC-BY",
        oaUrl: "https://example.invalid/x.pdf",
      }),
      candidate({
        doi: "10.5555/a",
        licence: "CC-BY-NC",
        kind: "REVIEW",
        discoveredVia: "EUROPE_PMC",
        oaUrl: "https://europepmc.org/articles/PMC1",
      }),
      candidate({
        doi: "10.5555/a",
        retractedFlag: true,
        referencedWorks: ["W5"],
      }),
    ]).candidates;
    assert.equal(merged?.licence, "CC-BY-NC");
    assert.equal(merged?.kind, "REVIEW");
    assert.equal(merged?.oaUrl, "https://europepmc.org/articles/PMC1");
    assert.equal(merged?.retractedFlag, true);
    assert.deepEqual(merged?.referencedWorks, ["W5"]);
  });

  it("the same input gives the same output (the run is reproducible)", () => {
    const input = [
      candidate({ doi: "10.5555/b" }),
      candidate({ doi: "10.5555/a", pmid: "1" }),
      candidate({ pmid: "1", licence: "CC0" }),
    ];
    assert.deepEqual(mergeCandidates(input), mergeCandidates(input));
  });
});

describe("what a work stores", () => {
  it("every notice on its DOI, and OpenAlex's retraction flag when Crossref has none", () => {
    const work = candidate({ doi: "10.5555/a", retractedFlag: true });
    assert.deepEqual(versionsFor(work, []), [
      {
        versionKind: "RETRACTION",
        relatedDoi: null,
        noticeDate: null,
        detectedVia: "OPENALEX_RETRACTED",
      },
    ]);
    const notice = {
      doi: "10.5555/a",
      versionKind: "RETRACTION" as const,
      relatedDoi: "10.5555/n",
      noticeDate: null,
      detectedVia: "CROSSREF_UPDATE_TO" as const,
    };
    // Crossref's notice is the record; the flag adds nothing next to it
    assert.equal(versionsFor(work, [notice]).length, 1);
    assert.equal(versionsFor(work, [notice])[0]?.relatedDoi, "10.5555/n");
    assert.deepEqual(
      versionsFor(candidate({ doi: "10.5555/b" }), [notice]),
      [],
      "another work's notice is not ours",
    );
  });

  it("a DOI outside the notice check is not storable; a work with no DOI is", () => {
    const checked = new Set(["10.5555/a"]);
    assert.equal(isStorable(candidate({ doi: "10.5555/a" }), checked), true);
    assert.equal(isStorable(candidate({ doi: "10.5555/b" }), checked), false);
    assert.equal(isStorable(candidate({ pmid: "1" }), checked), true);
  });
});
