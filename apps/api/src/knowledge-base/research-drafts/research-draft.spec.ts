import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";

import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants.js";
import { vocabularyV1 } from "@acropora/knowledge-base";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { CROSSREF_BASE, EUROPE_PMC_BASE } from "../discovery/discovery-run.js";
import {
  crossrefList,
  europePmcList,
  europePmcResult,
  fakeClock,
  scriptedApis,
  type ScriptedAnswer,
} from "../discovery/discovery-test-fixtures.js";
import {
  ScholarlyClient,
  type ApiFetch,
} from "../discovery/scholarly-client.js";
import type { ClaimExtractor } from "../extraction/claim-extractor.js";
import { readFullTextClaims } from "../extraction/extraction-run.js";
import {
  JATS,
  PASSAGE,
  aiClaim,
} from "../extraction/extraction-test-fixtures.js";
import {
  queriesOf,
  summaryOf,
  type QueriesAnswer,
  type ResearchAsker,
  type SummaryAnswer,
  type SummaryClaimInput,
} from "./research-draft-client.js";
import {
  budgetedDiscovery,
  ResearchDraftController,
  ResearchDraftService,
  type ResearchDraftDeps,
} from "./research-draft.controller.js";
import {
  DRAFT_REQUEST_LIMIT,
  checkSummary,
  discoveryInputFor,
  parseResearchQuestion,
  runResearchDraft,
  type DraftDeps,
  type DraftResult,
} from "./research-draft.js";
import type { DraftStore } from "./research-draft.store.js";

/**
 * S6 slice 4b, mode B on the OS side: the chain from a question to a research
 * draft, with the real discovery (scripted APIs), the real full-text reading
 * and claim check (the invented JATS paper), and a fake AI.
 */
const DOI = "10.5555/coral.1";

function asker(
  over: {
    queries?: QueriesAnswer;
    summary?: (claims: SummaryClaimInput[]) => SummaryAnswer;
  } = {},
) {
  const calls: { queries: string[]; summary: SummaryClaimInput[][] } = {
    queries: [],
    summary: [],
  };
  const ask: ResearchAsker = {
    async queries(question) {
      calls.queries.push(question);
      return (
        over.queries ?? {
          kind: "QUERIES",
          queries: ["phosphate coral calcification"],
          refused: [],
          writtenBy: "fake research-queries/v1",
        }
      );
    },
    async summary(_question, claims) {
      calls.summary.push(claims);
      return (
        over.summary?.(claims) ?? {
          kind: "SUMMARY",
          summary: `A meszesedés 18 százalékkal csökkent 2 µmol/l foszfát mellett [[claim:${claims[0]!.id}]].`,
          kept: 1,
          dropped: [],
          writtenBy: "fake research-summary/v1",
        }
      );
    },
  };
  return { ask, calls };
}

const extractor: ClaimExtractor = {
  async extract() {
    return {
      kind: "ANSWER",
      claims: [aiClaim()],
      refusedClaims: [],
      extractedBy: "fake claim-extraction/v1",
    };
  },
};

/** The scholarly APIs by prefix, and the open full text as XML (not JSON). */
function network(
  routes: [string, ScriptedAnswer][],
  fullText: Record<string, string> = { PMC9001: JATS },
) {
  const apis = scriptedApis(routes);
  const texts: string[] = [];
  const fetch: ApiFetch = async (url, init) => {
    const m = /\/(PMC\d+)\/fullTextXML$/.exec(url);
    if (!m) return apis.fetch(url, init);
    texts.push(m[1]!);
    const xml = fullText[m[1]!];
    return xml
      ? new Response(xml, { status: 200 })
      : new Response("", { status: 404 });
  };
  return { fetch, asked: apis.asked, texts };
}

function chainDeps(
  ask: ResearchAsker,
  net: ReturnType<typeof network>,
): DraftDeps {
  const clock = fakeClock();
  return {
    ask,
    // the service's own composition: a client per search, one budget
    discover: budgetedDiscovery(
      (requestLimit) =>
        new ScholarlyClient({
          fetch: net.fetch,
          sleep: clock.sleep,
          now: clock.now,
          requestLimit,
        }),
      clock.now,
    ),
    read: (pmcid, outcome) =>
      readFullTextClaims(pmcid, outcome, {
        extractor,
        fetch: net.fetch,
        vocabulary: vocabularyV1(),
        maxChunks: 3,
      }),
  };
}

const okRoutes = (
  result: Record<string, unknown> = {},
): [string, ScriptedAnswer][] => [
  [
    `${EUROPE_PMC_BASE}/search`,
    { status: 200, body: europePmcList([europePmcResult(result)]) },
  ],
  [
    CROSSREF_BASE,
    {
      status: 200,
      body: crossrefList([{ DOI, license: [], type: "journal-article" }]),
    },
  ],
];

/** The Europe PMC search in the title-and-abstract form only (the first route that matches wins). */
const TITLE_ABS_SEARCH = `${EUROPE_PMC_BASE}/search?query=${encodeURIComponent("(TITLE_ABS:")}`;

describe("mode B: the title-and-abstract search and its fallback", () => {
  for (const [name, answer] of [
    ["finds nothing", { status: 200, body: europePmcList([]) }],
    [
      "is refused (a field Europe PMC does not know)",
      { status: 400, body: {} },
    ],
  ] as [string, ScriptedAnswer][])
    it(`searches the full text once more, as before, when the title and abstract ${name}`, async () => {
      const { ask } = asker();
      const net = network([[TITLE_ABS_SEARCH, answer], ...okRoutes()]);
      const r = await runResearchDraft(
        "Mennyi foszfát árt az Acroporának?",
        "label",
        chainDeps(ask, net),
      );
      assert.equal(r.status, "DRAFT", JSON.stringify(r.report));
      const searches = net.asked
        .filter((u) => u.startsWith(`${EUROPE_PMC_BASE}/search`))
        .map((u) => new URL(u).searchParams.get("query"));
      assert.deepEqual(searches, [
        "(TITLE_ABS:(phosphate coral calcification)) AND OPEN_ACCESS:y",
        "(phosphate coral calcification) AND OPEN_ACCESS:y",
      ]);
      assert.equal(r.report.discovery?.fieldScope, "FULLTEXT_FALLBACK");
      assert.equal(r.report.discovery?.titleAbstract?.found, 0);
      assert.equal(r.report.discovery?.found, 1);
      // one client, one budget: the count holds both searches
      assert.equal(
        r.report.discovery?.requestCount,
        net.asked.filter((u) => !u.includes("fullTextXML")).length,
      );
    });
});

describe("mode B: one request budget for both searches", () => {
  it("gives the second search's client only what the first one left", async () => {
    const net = network([
      [TITLE_ABS_SEARCH, { status: 200, body: europePmcList([]) }],
      ...okRoutes(),
    ]);
    const clock = fakeClock();
    const limits: number[] = [];
    const discover = budgetedDiscovery((requestLimit) => {
      limits.push(requestLimit);
      return new ScholarlyClient({
        fetch: net.fetch,
        sleep: clock.sleep,
        now: clock.now,
        requestLimit,
      });
    }, clock.now);
    const first = await discover(
      discoveryInputFor("label", ["phosphate coral"]),
    );
    await discover(
      discoveryInputFor("label", ["phosphate coral"], "FULLTEXT_FALLBACK"),
    );
    assert.ok(first.requestCount > 0);
    assert.deepEqual(limits, [
      DRAFT_REQUEST_LIMIT,
      DRAFT_REQUEST_LIMIT - first.requestCount,
    ]);
  });
});

describe("mode B: no fallback past an API that is down", () => {
  it("does not ask Europe PMC again after a 5xx on the title-and-abstract search", async () => {
    const { ask } = asker();
    const net = network([
      [TITLE_ABS_SEARCH, { status: 503, body: {} }],
      ...okRoutes(),
    ]);
    const r = await runResearchDraft(
      "Mennyi foszfát árt az Acroporának?",
      "label",
      chainDeps(ask, net),
    );
    assert.equal(r.status, "FAILED");
    assert.equal(r.reason, "NO_SOURCES");
    assert.equal(
      net.asked.filter((u) => u.startsWith(`${EUROPE_PMC_BASE}/search`)).length,
      1,
    );
    assert.equal(r.report.discovery?.fieldScope, "TITLE_ABS");
    assert.equal(r.report.discovery?.unavailable.EUROPE_PMC, "HTTP_503");
  });
});

describe("mode B: the chain from a question to a research draft", () => {
  it("reads the open full text in memory and writes a summary from its checked claims only", async () => {
    const { ask, calls } = asker();
    const net = network(okRoutes());
    const r = await runResearchDraft(
      "Mennyi foszfát árt az Acroporának?",
      "label",
      chainDeps(ask, net),
    );
    assert.equal(r.status, "DRAFT", JSON.stringify(r.report));
    assert.equal(r.summaryModel, "fake research-summary/v1");
    assert.match(r.summary!, /\[\[claim:c1\]\]\.$/);
    // the search: Europe PMC only, open access only, in the title and the abstract (not the full
    // text, where an abstract book matches every word), no abstract asked for
    const searches = net.asked
      .filter((u) => u.startsWith(`${EUROPE_PMC_BASE}/search`))
      .map((u) => new URL(u).searchParams.get("query"));
    assert.deepEqual(searches, [
      "(TITLE_ABS:(phosphate coral calcification)) AND OPEN_ACCESS:y",
    ]);
    assert.equal(r.report.discovery?.fieldScope, "TITLE_ABS");
    assert.equal(r.report.discovery?.titleAbstract, undefined);
    assert.ok(!net.asked.some((u) => u.includes("api.openalex.org")));
    assert.deepEqual(net.texts, ["PMC9001"]);
    // the claim as the OS checked it, with its source; the summary call got fields, the verbatim passage and a reference
    assert.equal(r.candidateClaims.length, 1);
    assert.equal(r.candidateClaims[0]!.id, "c1");
    assert.equal(r.candidateClaims[0]!.source, 0);
    assert.equal(r.sources[0]!.read, "READ");
    const sent = calls.summary[0]![0]!;
    assert.equal(sent.passage, PASSAGE);
    assert.match(
      sent.fields,
      /effect CALCIFICATION; direction DECREASE; quantity 2-2 µmol\/l/,
    );
    assert.equal(sent.source, "Szerző, 2013");
    assert.deepEqual(
      [r.report.claims, r.report.claimsSent, r.report.summaryDroppedHere],
      [1, 1, []],
    );
  });

  it("stops early with its reason: no AI, a refusal, no query, no source", async () => {
    const net = network(okRoutes());
    const run = (queries: QueriesAnswer) =>
      runResearchDraft("k", "l", chainDeps(asker({ queries }).ask, net));
    assert.equal(
      (await run({ kind: "UNAVAILABLE", reason: "timeout" })).reason,
      "AI_QUERIES_UNAVAILABLE",
    );
    assert.equal(
      (await run({ kind: "REFUSED", refusal: "NOT_JSON", writtenBy: "x" }))
        .reason,
      "AI_QUERIES_REFUSED",
    );
    assert.equal(
      (await run({ kind: "QUERIES", queries: [], refused: [], writtenBy: "x" }))
        .reason,
      "NO_QUERIES",
    );
    assert.deepEqual(net.asked, [], "no question reached a scholarly API");
    const empty = network([
      [`${EUROPE_PMC_BASE}/search`, { status: 200, body: europePmcList([]) }],
    ]);
    assert.equal(
      (await runResearchDraft("k", "l", chainDeps(asker().ask, empty))).reason,
      "NO_SOURCES",
    );
  });

  it("a work with no DOI is read, marked: the Crossref check never covered it (barracuda on #1930)", async () => {
    const net = network(okRoutes({ doi: undefined }));
    const r = await runResearchDraft("k", "l", chainDeps(asker().ask, net));
    assert.equal(r.status, "DRAFT", JSON.stringify(r.report));
    assert.deepEqual(
      [
        r.sources[0]!.doi,
        r.sources[0]!.read,
        r.sources[0]!.retractionUnchecked,
      ],
      [null, "READ", true],
    );
    const withDoi = await runResearchDraft(
      "k",
      "l",
      chainDeps(asker().ask, network(okRoutes())),
    );
    assert.equal(withDoi.sources[0]!.retractionUnchecked, false);
  });

  it("does not read a retracted work, nor one whose DOI the Crossref check did not reach", async () => {
    const retracted = network(
      okRoutes({ pubTypeList: { pubType: ["Retracted Publication"] } }),
    );
    const r1 = await runResearchDraft(
      "k",
      "l",
      chainDeps(asker().ask, retracted),
    );
    assert.deepEqual(
      [r1.status, r1.reason, r1.sources[0]!.read, retracted.texts],
      ["FAILED", "NO_OPEN_FULL_TEXT", "RETRACTED", []],
    );
    const unchecked = network([
      okRoutes()[0]!,
      [CROSSREF_BASE, { status: 503 }],
    ]);
    const r2 = await runResearchDraft(
      "k",
      "l",
      chainDeps(asker().ask, unchecked),
    );
    assert.deepEqual(
      [r2.reason, r2.sources[0]!.read, unchecked.texts],
      ["NO_OPEN_FULL_TEXT", "RETRACTION_UNCHECKED", []],
    );
  });

  it("a summary nothing of which passes the OS's check is no draft; the claims stay for the editor", async () => {
    const { ask } = asker({
      summary: () => ({
        kind: "SUMMARY",
        summary: "Napi 5 ml foszfátmentesítő ajánlott [[claim:c1]].",
        kept: 1,
        dropped: [],
        writtenBy: "w",
      }),
    });
    const r = await runResearchDraft(
      "k",
      "l",
      chainDeps(ask, network(okRoutes())),
    );
    assert.deepEqual(
      [r.status, r.reason, r.summary, r.candidateClaims.length],
      ["FAILED", "SUMMARY_EMPTY", null, 1],
    );
    assert.deepEqual(r.report.summaryDroppedHere, ["NUMBER_NOT_IN_CLAIMS"]);
  });
});

describe("the OS's own check of the summary", () => {
  const claims = [
    {
      id: "c1",
      fields: "quantity 2-2 µmol/l",
      passage: "decreased by 18 % at 2 µM",
    },
  ];
  it("keeps a sentence ending with known markers and the claims' numbers, drops the rest by code", () => {
    const r = checkSummary(
      [
        "A meszesedés 18 százalékkal csökkent 2 µmol/l mellett [[claim:c1]].",
        "Ez egy jelöletlen mondat.",
        "Egy ismeretlen [[claim:c9]].",
        "A jelölő [[claim:c1]] után még szöveg áll, ezért kiesik.",
        "Napi 5 ml kell [[claim:c1]].",
        "A PO4 szint 2 µmol/l volt [[claim:c1]].",
      ].join(" "),
      claims,
    );
    assert.deepEqual(r.dropped, [
      "UNMARKED",
      "UNKNOWN_MARKER",
      "MARKER_NOT_AT_END",
      "NUMBER_NOT_IN_CLAIMS",
    ]);
    assert.equal(r.kept, 2);
    assert.match(
      r.text,
      /^A meszesedés .*\[\[claim:c1\]\]\. A PO4 .*\[\[claim:c1\]\]\.$/,
    );
  });
});

describe("the AI answers as the OS reads them", () => {
  it("queries: the search syntax again here, at most three, codes kept", () => {
    const q = queriesOf({
      queries: [
        "phosphate coral",
        "x; DROP",
        "phosphate coral",
        "a",
        "b c d",
        "e f g",
        "h i j",
      ],
      refused: [{ index: 9, refusal: "BAD_CHARACTER" }],
      writtenBy: "m research-queries/v1",
    });
    assert.deepEqual(q, {
      kind: "QUERIES",
      queries: ["phosphate coral", "b c d", "e f g"],
      refused: [
        "BAD_CHARACTER",
        "BAD_QUERY",
        "BAD_QUERY",
        "BAD_QUERY",
        "BAD_QUERY",
      ],
      writtenBy: "m research-queries/v1",
    });
    assert.deepEqual(queriesOf({ refusal: "NOT_JSON", writtenBy: "m" }), {
      kind: "REFUSED",
      refusal: "NOT_JSON",
      writtenBy: "m",
    });
    assert.equal(queriesOf(null).kind, "UNAVAILABLE");
  });

  it("queries: an expression that would leave its wrapper is dropped", () => {
    const q = queriesOf({
      queries: [
        'phosphate AND (coral OR "stony coral")',
        "x)) OR (y",
        // balanced in count, but it closes the field before it opens again
        "phosphate) OR (coral",
        "(phosphate coral",
        'phosphate "coral',
        '"coral (stony)" phosphate',
      ],
      refused: [],
      writtenBy: "m research-queries/v1",
    });
    assert.equal(q.kind, "QUERIES");
    if (q.kind !== "QUERIES") return;
    assert.deepEqual(q.queries, ['phosphate AND (coral OR "stony coral")']);
    assert.deepEqual(q.refused, [
      "BAD_QUERY",
      "BAD_QUERY",
      "BAD_QUERY",
      "BAD_QUERY",
      "BAD_QUERY",
    ]);
  });

  it("summary: the text, the counts and the dropped codes", () => {
    assert.deepEqual(
      summaryOf({
        summary: "s",
        kept: 2,
        dropped: [{ index: 1, drop: "UNMARKED" }],
        writtenBy: "m",
      }),
      {
        kind: "SUMMARY",
        summary: "s",
        kept: 2,
        dropped: ["UNMARKED"],
        writtenBy: "m",
      },
    );
    assert.equal(summaryOf({ kept: 1 }).kind, "UNAVAILABLE");
  });

  it("the question: non-empty, at most 1000 characters, no marker brackets", () => {
    assert.equal(parseResearchQuestion({ question: "  Mennyi?  " }), "Mennyi?");
    for (const bad of [
      {},
      { question: "" },
      { question: "x".repeat(1001) },
      { question: "a [[claim:x]]" },
    ])
      assert.throws(() => parseResearchQuestion(bad));
  });
});

// ---------------------------------------------------------------------------

const USER = { id: "u-1" } as AuthenticatedUser;

function fakeStore(over: Partial<DraftStore> = {}) {
  const calls: string[] = [];
  const finished: DraftResult[] = [];
  const store: DraftStore = {
    async abandonStale() {
      calls.push("abandonStale");
      return 0;
    },
    async running() {
      return null;
    },
    async otherRunRunning() {
      return false;
    },
    async start(input) {
      calls.push(`start:${input.question}:${input.createdById}`);
      return "d-1";
    },
    async heartbeat() {},
    async finish(id, result) {
      calls.push(`finish:${id}:${result.status}`);
      finished.push(result);
    },
    async fail(id, error) {
      calls.push(`fail:${id}:${error}`);
    },
    async list(limit) {
      calls.push(`list:${limit}`);
      return [];
    },
    async get() {
      return null;
    },
    ...over,
  };
  return { store, calls, finished };
}

function serviceDeps(over: Partial<ResearchDraftDeps> = {}): ResearchDraftDeps {
  const clock = fakeClock();
  return {
    env: { KNOWLEDGE_DISCOVERY: "on" },
    store: fakeStore().store,
    ask: asker().ask,
    extractor,
    approvedVocabulary: async () => vocabularyV1(),
    fetch: network(okRoutes()).fetch,
    sleep: clock.sleep,
    now: clock.now,
    every: () => () => undefined,
    ...over,
  };
}

describe("starting a research draft", () => {
  it("403 with the switch off, 503 without the AI, 400 on a bad question, before the store is touched", async () => {
    const t = fakeStore();
    const status = (e: unknown) => (e as { getStatus(): number }).getStatus();
    const s = (over: Partial<ResearchDraftDeps>) =>
      new ResearchDraftService(serviceDeps({ store: t.store, ...over }));
    await assert.rejects(
      s({ env: {} }).start({ question: "k" }, USER),
      (e) => status(e) === 403,
    );
    await assert.rejects(
      s({ ask: null }).start({ question: "k" }, USER),
      (e) => status(e) === 503,
    );
    await assert.rejects(
      s({ extractor: null }).start({ question: "k" }, USER),
      (e) => status(e) === 503,
    );
    await assert.rejects(
      s({}).start({ question: "" }, USER),
      (e) => status(e) === 400,
    );
    assert.deepEqual(t.calls, []);
  });

  it("409 while a draft, a discovery or an extraction runs", async () => {
    const status = (e: unknown) => (e as { getStatus(): number }).getStatus();
    const a = fakeStore({ running: async () => ({ id: "d-0" }) });
    await assert.rejects(
      new ResearchDraftService(serviceDeps({ store: a.store })).start(
        { question: "k" },
        USER,
      ),
      (e) => status(e) === 409,
    );
    const b = fakeStore({ otherRunRunning: async () => true });
    await assert.rejects(
      new ResearchDraftService(serviceDeps({ store: b.store })).start(
        { question: "k" },
        USER,
      ),
      (e) => status(e) === 409,
    );
    assert.ok(
      !a.calls.some((c) => c.startsWith("start")) &&
        !b.calls.some((c) => c.startsWith("start")),
    );
  });

  it("202 with the id; the chain runs after the answer and the row ends as a DRAFT", async () => {
    const t = fakeStore();
    const service = new ResearchDraftService(serviceDeps({ store: t.store }));
    assert.deepEqual(
      await service.start({ question: "Mennyi foszfát árt?" }, USER),
      { id: "d-1", status: "RUNNING" },
    );
    await Promise.all(service.inFlight.values());
    assert.deepEqual(t.calls, [
      "abandonStale",
      "start:Mennyi foszfát árt?:u-1",
      "finish:d-1:DRAFT",
    ]);
    assert.equal(t.finished[0]!.candidateClaims.length, 1);
  });

  it("a crash in the chain marks the row FAILED by the error's name only", async () => {
    const t = fakeStore();
    const service = new ResearchDraftService(
      serviceDeps({
        store: t.store,
        approvedVocabulary: async () => {
          throw new TypeError("a source's text would be here");
        },
      }),
    );
    await service.start({ question: "k" }, USER);
    await Promise.all(service.inFlight.values());
    assert.equal(t.calls.at(-1), "fail:d-1:TypeError");
  });
});

describe("the research draft endpoints", () => {
  const proto = ResearchDraftController.prototype;
  it("every route needs knowledge.manage; the start answers 202", () => {
    for (const handler of [proto.start, proto.list, proto.get])
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler),
        [PERMISSIONS.KNOWLEDGE_MANAGE],
        handler.name,
      );
    assert.equal(
      Reflect.getMetadata(HTTP_CODE_METADATA, proto.start),
      HttpStatus.ACCEPTED,
    );
  });
});
