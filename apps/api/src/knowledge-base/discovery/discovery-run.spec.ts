import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CROSSREF_BASE,
  EUROPE_PMC_BASE,
  OPENALEX_BASE,
  parseDiscoveryInput,
  runDiscovery,
  type DiscoveryInput,
} from "./discovery-run.js";
import {
  crossrefList,
  europePmcList,
  europePmcResult,
  fakeClock,
  openAlexList,
  openAlexWork,
  scriptedApis,
  type ScriptedAnswer,
} from "./discovery-test-fixtures.js";
import { RETRY_429_MS, ScholarlyClient } from "./scholarly-client.js";

const INPUT: DiscoveryInput = {
  label: "teszt",
  openalex: [{ search: "phosphate Acropora", maxResults: 10 }],
  europePmc: [{ query: "phosphate AND Acropora", maxResults: 10 }],
  dois: [],
  citations: [],
};

/** Both searches find work 1; OpenAlex also work 2; Crossref retracts work 2. */
function pilotRoutes(over: Record<string, ScriptedAnswer> = {}) {
  const routes: Record<string, ScriptedAnswer> = {
    [`${OPENALEX_BASE}/works?filter=title_and_abstract.search:`]: {
      status: 200,
      body: openAlexList(
        [
          openAlexWork(),
          openAlexWork({
            id: "https://openalex.org/W300",
            doi: "https://doi.org/10.5555/coral.2",
            ids: {},
            title: "Kitalált cím kettő",
          }),
          openAlexWork({ id: "https://openalex.org/W400", type: "dataset" }),
        ],
        82,
      ),
    },
    [`${EUROPE_PMC_BASE}/search?query=phosphate`]: {
      status: 200,
      body: europePmcList([europePmcResult()], 853),
    },
    [`${EUROPE_PMC_BASE}/search?query=DOI`]: {
      status: 200,
      body: europePmcList([]),
    },
    [`${CROSSREF_BASE}/works?filter=doi:`]: {
      status: 200,
      body: crossrefList([
        {
          DOI: "10.5555/coral.1",
          license: [
            { URL: "https://creativecommons.org/licenses/by-nc-nd/4.0/" },
          ],
        },
        {
          DOI: "10.5555/coral.2",
          "updated-by": [
            {
              DOI: "10.5555/notice.2",
              type: "retraction",
              source: "publisher",
            },
          ],
        },
      ]),
    },
    ...over,
  };
  return scriptedApis(Object.entries(routes));
}

async function run(
  input: DiscoveryInput,
  network: ReturnType<typeof scriptedApis>,
  requestLimit = 50,
) {
  const clock = fakeClock();
  const client = new ScholarlyClient({
    fetch: network.fetch,
    sleep: clock.sleep,
    now: clock.now,
    requestLimit,
  });
  return runDiscovery(input, { client, now: clock.now });
}

describe("source discovery, end to end on scripted APIs", () => {
  it("merges the two searches, checks every DOI at Crossref, and finds the retraction", async () => {
    const result = await run(INPUT, pilotRoutes());
    assert.equal(result.status, "FINISHED");
    assert.equal(result.candidates.length, 2, "work 1 once, work 2 once");
    const one = result.candidates.find((c) => c.doi === "10.5555/coral.1");
    assert.equal(
      one?.pmcid,
      "PMC9001",
      "Europe PMC joined the OpenAlex record",
    );
    assert.equal(
      one?.licence,
      "CC-BY-NC-ND",
      "Crossref's stricter licence stays",
    );
    assert.equal(one?.oaUrl, "https://europepmc.org/articles/PMC9001");
    assert.deepEqual(result.skipped, { "OPENALEX type:dataset": 1 });
    assert.deepEqual(result.checkedDois.sort(), [
      "10.5555/coral.1",
      "10.5555/coral.2",
    ]);
    assert.deepEqual(
      result.notices.map((n) => [n.doi, n.versionKind, n.relatedDoi]),
      [["10.5555/coral.2", "RETRACTION", "10.5555/notice.2"]],
    );
  });

  it("logs every query reproducibly: text, exact URL, time, hit count, fetched", async () => {
    const result = await run(INPUT, pilotRoutes());
    assert.deepEqual(
      result.queries.map((q) => [
        q.api,
        q.kind,
        q.query,
        q.hitCount,
        q.fetched,
        q.stoppedBy,
      ]),
      [
        ["OPENALEX", "SEARCH", "phosphate Acropora", 82, 3, null],
        ["EUROPE_PMC", "SEARCH", "phosphate AND Acropora", 853, 1, null],
      ],
    );
    assert.match(
      result.queries[0]!.url,
      /^https:\/\/api\.openalex\.org\/works\?filter=title_and_abstract\.search:phosphate%20Acropora&per_page=10&page=1&select=/,
    );
    assert.equal(result.queries[0]!.executedAt, "2026-10-23T14:00:00.000Z");
    // the abstract is never asked for
    assert.doesNotMatch(result.queries[0]!.url, /abstract_inverted_index/);
  });

  it("the same answers give the same result", async () => {
    assert.deepEqual(
      await run(INPUT, pilotRoutes()),
      await run(INPUT, pilotRoutes()),
    );
  });

  it("Crossref is asked once per batch, with the slash kept and the notices selected", async () => {
    const network = pilotRoutes();
    await run(INPUT, network);
    const crossref = network.asked.filter((u) => u.startsWith(CROSSREF_BASE));
    assert.equal(crossref.length, 1);
    assert.match(
      crossref[0]!,
      /filter=doi:10\.5555\/coral\.1,doi:10\.5555\/coral\.2&rows=4&select=DOI,license,type,updated-by$/,
    );
  });

  it("Crossref refusing makes the run INCOMPLETE: no DOI is storable unchecked", async () => {
    const result = await run(
      INPUT,
      pilotRoutes({
        [`${CROSSREF_BASE}/works?filter=doi:`]: { status: 503 },
      }),
    );
    assert.equal(result.status, "INCOMPLETE");
    assert.deepEqual(result.checkedDois, []);
    assert.equal(result.unavailable.CROSSREF, "HTTP_503");
  });

  it("the request limit stops the run with LIMIT_REACHED, nothing retried", async () => {
    const network = pilotRoutes();
    const result = await run(INPUT, network, 2);
    assert.equal(result.status, "LIMIT_REACHED");
    assert.equal(result.requestCount, 2);
    assert.equal(network.asked.length, 2);
  });

  it("an OpenAlex 429 that outlasts the retries ends that API for the run, the others go on", async () => {
    const network = pilotRoutes({
      [`${OPENALEX_BASE}/works?filter=title_and_abstract.search:`]: {
        status: 429,
      },
    });
    const result = await run(INPUT, network);
    assert.equal(result.status, "FINISHED");
    assert.equal(result.queries[0]!.stoppedBy, "HTTP_429");
    assert.equal(result.unavailable.OPENALEX, "HTTP_429");
    assert.equal(result.candidates.length, 1);
    assert.equal(
      network.asked.filter((u) => u.startsWith(OPENALEX_BASE)).length,
      1 + RETRY_429_MS.length,
      "the bounded retries, then nothing more",
    );
  });

  it("hand-named DOIs come through OpenAlex; one nobody knows is reported", async () => {
    const network = pilotRoutes({
      [`${OPENALEX_BASE}/works?filter=doi:`]: {
        status: 200,
        body: openAlexList([openAlexWork()]),
      },
    });
    const result = await run(
      {
        ...INPUT,
        openalex: [],
        europePmc: [],
        dois: ["10.5555/coral.1", "10.5555/nincs"],
      },
      network,
    );
    assert.deepEqual(result.notFoundDois, ["10.5555/nincs"]);
    assert.equal(result.candidates[0]?.discoveredVia, "MANUAL");
    assert.match(
      network.asked[0]!,
      /filter=doi:10\.5555\/coral\.1\|10\.5555\/nincs&/,
    );
  });

  it("the citation graph: a seed's references by OpenAlex id, in batches", async () => {
    const network = pilotRoutes({
      [`${OPENALEX_BASE}/works/doi:10.5555/seed`]: {
        status: 200,
        body: {
          id: "https://openalex.org/W1",
          referenced_works: [
            "https://openalex.org/W100",
            "https://openalex.org/W300",
          ],
        },
      },
      [`${OPENALEX_BASE}/works?filter=openalex:`]: {
        status: 200,
        body: openAlexList([openAlexWork()]),
      },
    });
    const result = await run(
      {
        ...INPUT,
        openalex: [],
        europePmc: [],
        citations: [
          { doi: "10.5555/seed", direction: "references", maxResults: 10 },
        ],
      },
      network,
    );
    const log = result.queries[0]!;
    assert.deepEqual(
      [log.kind, log.hitCount, log.fetched],
      ["REFERENCES", 2, 1],
    );
    assert.equal(result.candidates[0]?.discoveredVia, "CITATION_GRAPH");
    assert.ok(
      network.asked.some((u) => u.includes("filter=openalex:W100|W300&")),
    );
  });
});

describe("the input file", () => {
  it("lists every problem at once", () => {
    const parsed = parseDiscoveryInput(
      JSON.stringify({
        label: "",
        openalex: [{ search: "a, b", maxResults: 0 }],
        dois: ["nem-doi"],
        citations: [{ doi: "10.5555/x", direction: "sideways", maxResults: 5 }],
      }),
    );
    assert.ok(!parsed.ok);
    assert.equal(parsed.problems.length, 5);
  });

  it("accepts the pilot shape and normalises the DOIs", () => {
    const parsed = parseDiscoveryInput(
      JSON.stringify({
        label: "pilot",
        europePmc: [{ query: "phosphate AND Acropora", maxResults: 200 }],
        dois: ["https://doi.org/10.5555/ABC"],
      }),
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.input.dois, ["10.5555/abc"]);
    assert.deepEqual(parsed.input.openalex, []);
  });
});
