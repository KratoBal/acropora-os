import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { europePmcResult, openAlexWork } from "./discovery-test-fixtures.js";
import {
  crossrefLicence,
  crossrefNotices,
  fromEuropePmcResult,
  fromOpenAlexWork,
} from "./records.js";
import { versionsFor } from "./store-plan.js";

describe("OpenAlex work to a candidate", () => {
  it("reads the fixed fields, and normalises every identifier", () => {
    const mapped = fromOpenAlexWork(openAlexWork(), "OPENALEX");
    assert.ok(mapped.ok);
    const c = mapped.candidate;
    assert.equal(c.doi, "10.5555/coral.1");
    assert.equal(c.openalexId, "W100");
    assert.equal(c.pmid, "111");
    assert.equal(c.kind, "PEER_REVIEWED");
    assert.equal(c.year, 2013);
    assert.equal(c.venue, "Kitalált Folyóirat");
    assert.deepEqual(c.authors, [
      { name: "Kitalált Szerző", orcid: "0000-0000-0000-0001" },
    ]);
    assert.deepEqual(c.referencedWorks, ["W200"]);
    // OpenAlex knowing no open copy is not a licence statement
    assert.equal(c.licence, "UNKNOWN");
    assert.equal(c.oaUrl, null);
  });

  it("an open copy gives the licence and the link", () => {
    const mapped = fromOpenAlexWork(
      openAlexWork({
        open_access: { is_oa: true, oa_status: "gold" },
        primary_location: { license: "cc-by" },
        best_oa_location: {
          license: "cc-by-nc",
          pdf_url: "https://example.invalid/a.pdf",
        },
      }),
      "OPENALEX",
    );
    assert.ok(mapped.ok);
    // two statements, the stricter one stays
    assert.equal(mapped.candidate.licence, "CC-BY-NC");
    assert.equal(mapped.candidate.oaUrl, "https://example.invalid/a.pdf");
  });

  it("a type the pilot has no kind for is skipped WITH its type", () => {
    for (const type of ["dataset", "dissertation", "erratum", "paratext"]) {
      const mapped = fromOpenAlexWork(openAlexWork({ type }), "OPENALEX");
      assert.deepEqual(mapped, {
        ok: false,
        skipped: { api: "OPENALEX", reason: `type:${type}` },
      });
    }
    const review = fromOpenAlexWork(
      openAlexWork({ type: "review" }),
      "OPENALEX",
    );
    assert.ok(review.ok && review.candidate.kind === "REVIEW");
  });

  it("carries OpenAlex's retraction flag", () => {
    const mapped = fromOpenAlexWork(
      openAlexWork({ is_retracted: true }),
      "MANUAL",
    );
    assert.deepEqual(mapped.ok && mapped.candidate.versionSignals, [
      { versionKind: "RETRACTION", detectedVia: "OPENALEX_RETRACTED" },
    ]);
    assert.equal(mapped.ok && mapped.candidate.discoveredVia, "MANUAL");
  });
});

describe("Europe PMC result to a candidate", () => {
  it("reads PMID, PMCID, licence and the open full-text page", () => {
    const mapped = fromEuropePmcResult(europePmcResult());
    assert.ok(mapped.ok);
    const c = mapped.candidate;
    assert.equal(c.pmid, "111");
    assert.equal(c.pmcid, "PMC9001");
    assert.equal(c.doi, "10.5555/coral.1");
    assert.equal(c.licence, "CC-BY-NC");
    assert.equal(c.oaUrl, "https://europepmc.org/articles/PMC9001");
    assert.equal(c.kind, "PEER_REVIEWED");
  });

  it("a closed record has no open link, whatever its URL list says", () => {
    const mapped = fromEuropePmcResult(
      europePmcResult({ isOpenAccess: "N", license: undefined }),
    );
    assert.ok(mapped.ok);
    assert.equal(mapped.candidate.oaUrl, null);
    assert.equal(mapped.candidate.licence, "UNKNOWN");
  });

  it("a preprint server record and a review are told apart", () => {
    const preprint = fromEuropePmcResult(
      europePmcResult({ source: "PPR", id: "PPR1", pmid: undefined }),
    );
    assert.ok(preprint.ok && preprint.candidate.kind === "PREPRINT");
    assert.equal(preprint.ok && preprint.candidate.pmid, null);
    const review = fromEuropePmcResult(
      europePmcResult({
        pubTypeList: { pubType: ["review", "Journal Article"] },
      }),
    );
    assert.ok(review.ok && review.candidate.kind === "REVIEW");
  });
});

describe("Europe PMC's own version words (barracuda, #1834 review)", () => {
  // the measured words, 2026-10-23: PUB_TYPE:"Retracted Publication" AND coral
  it("a retracted record, with no DOI, carries a RETRACTION signal", () => {
    const mapped = fromEuropePmcResult(
      europePmcResult({
        doi: undefined,
        pubTypeList: { pubType: ["Retracted Publication", "Journal Article"] },
        commentCorrectionList: {
          commentCorrection: [
            { type: "Retraction in", source: "MED", id: "9" },
          ],
        },
      }),
    );
    assert.ok(mapped.ok);
    assert.equal(mapped.candidate.doi, null);
    assert.deepEqual(mapped.candidate.versionSignals, [
      { versionKind: "RETRACTION", detectedVia: "EUROPE_PMC" },
    ]);
    // and it becomes a stored version although Crossref never saw it
    assert.deepEqual(versionsFor(mapped.candidate, []), [
      {
        versionKind: "RETRACTION",
        relatedDoi: null,
        noticeDate: null,
        detectedVia: "EUROPE_PMC",
      },
    ]);
  });

  it("the link alone is enough, and an erratum is a version too", () => {
    const linked = fromEuropePmcResult(
      europePmcResult({
        commentCorrectionList: {
          commentCorrection: [
            { type: "Retraction in" },
            { type: "Erratum in" },
          ],
        },
      }),
    );
    assert.ok(linked.ok);
    assert.deepEqual(
      linked.candidate.versionSignals.map((v) => v.versionKind),
      ["RETRACTION", "ERRATUM"],
    );
  });

  it("a notice record is not a source: skipped with its type", () => {
    for (const [over, reason] of [
      [
        { pubTypeList: { pubType: ["Retraction Notice"] } },
        "notice:retraction notice",
      ],
      [
        { pubTypeList: { pubType: ["Published Erratum"] } },
        "notice:published erratum",
      ],
      [
        {
          commentCorrectionList: {
            commentCorrection: [{ type: "Erratum for" }],
          },
        },
        "notice:erratum for",
      ],
    ] as [Record<string, unknown>, string][]) {
      assert.deepEqual(fromEuropePmcResult(europePmcResult(over)), {
        ok: false,
        skipped: { api: "EUROPE_PMC", reason },
      });
    }
  });

  it("an ordinary record has no signal", () => {
    const mapped = fromEuropePmcResult(europePmcResult());
    assert.ok(mapped.ok);
    assert.deepEqual(mapped.candidate.versionSignals, []);
  });
});

describe("Crossref notices", () => {
  // the measured shape (2026-10-23): the work's own record names its notices
  const work = {
    DOI: "10.5555/CORAL.1",
    type: "journal-article",
    "updated-by": [
      {
        DOI: "10.5555/notice.9",
        type: "retraction",
        source: "retraction-watch",
        updated: { "date-time": "2021-12-15T00:00:00Z" },
      },
      {
        DOI: "10.5555/NOTICE.9",
        type: "retraction",
        source: "publisher",
        updated: { "date-time": "2021-12-14T00:00:00Z" },
      },
    ],
  };

  it("a notice on the work's record becomes one version of it", () => {
    const versions = crossrefNotices([work], new Set(["10.5555/coral.1"]));
    assert.equal(
      versions.length,
      1,
      "publisher and Retraction Watch state ONE notice",
    );
    assert.deepEqual(versions[0], {
      doi: "10.5555/coral.1",
      versionKind: "RETRACTION",
      relatedDoi: "10.5555/notice.9",
      noticeDate: new Date("2021-12-14T00:00:00Z"),
      detectedVia: "CROSSREF_UPDATE_TO",
    });
  });

  it("Retraction Watch alone is recorded as such", () => {
    const only = { ...work, "updated-by": [work["updated-by"][0]] };
    const [v] = crossrefNotices([only], new Set(["10.5555/coral.1"]));
    assert.equal(v?.detectedVia, "RETRACTION_WATCH");
  });

  it("a publisher marking the work itself: the notice DOI is the work's own", () => {
    const self = {
      DOI: "10.5555/coral.2",
      "updated-by": [
        { DOI: "10.5555/coral.2", type: "correction", source: "publisher" },
      ],
    };
    const [v] = crossrefNotices([self], new Set(["10.5555/coral.2"]));
    assert.equal(v?.versionKind, "CORRECTION");
    assert.equal(v?.relatedDoi, "10.5555/coral.2");
    assert.equal(v?.noticeDate, null);
  });

  it("a record nobody asked about is not ours, and no notice means no version", () => {
    assert.deepEqual(crossrefNotices([work], new Set(["10.5555/other"])), []);
    assert.deepEqual(
      crossrefNotices(
        [{ DOI: "10.5555/coral.1" }],
        new Set(["10.5555/coral.1"]),
      ),
      [],
    );
  });

  it("each kind maps, an unknown kind is an UPDATE, not dropped", () => {
    const kinds: [string, string][] = [
      ["erratum", "ERRATUM"],
      ["expression_of_concern", "EXPRESSION_OF_CONCERN"],
      ["withdrawal", "RETRACTION"],
      ["new_edition", "UPDATE"],
    ];
    for (const [type, kind] of kinds) {
      const [v] = crossrefNotices(
        [{ DOI: "10.5555/w", "updated-by": [{ DOI: "10.5555/n", type }] }],
        new Set(["10.5555/w"]),
      );
      assert.equal(v?.versionKind, kind, type);
    }
  });

  it("licence: the stricter Creative Commons statement, publisher terms ignored", () => {
    assert.equal(
      crossrefLicence({
        license: [
          { URL: "https://creativecommons.org/licenses/by/4.0/" },
          { URL: "https://journals.asm.org/non-commercial-tdm-license" },
        ],
      }),
      "CC-BY",
    );
    assert.equal(crossrefLicence({}), "UNKNOWN");
  });
});
