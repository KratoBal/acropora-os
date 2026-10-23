import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runDiscoveryCli,
  shown,
  storeReport,
  type DiscoveryCliDeps,
} from "./discovery-run.cli.js";
import { CROSSREF_BASE, EUROPE_PMC_BASE } from "./discovery-run.js";
import type { StoreSummary } from "./discovery-run.store.js";
import {
  crossrefList,
  europePmcList,
  europePmcResult,
  fakeClock,
  scriptedApis,
  type ScriptedAnswer,
} from "./discovery-test-fixtures.js";

const INPUT = JSON.stringify({
  label: "cli-teszt",
  europePmc: [{ query: "phosphate AND Acropora", maxResults: 5 }],
});

const SUMMARY: StoreSummary = {
  runId: "run-1",
  created: 1,
  matched: 0,
  versionsCreated: 0,
  claimsDisputed: 0,
  ambiguous: [],
  unchecked: 0,
  retractionUnchecked: 0,
};

function deps(
  over: Partial<DiscoveryCliDeps> = {},
  crossref: ScriptedAnswer = {
    status: 200,
    body: crossrefList([{ DOI: "10.5555/coral.1" }]),
  },
) {
  const calls: string[] = [];
  const network = scriptedApis([
    [
      `${EUROPE_PMC_BASE}/search?query=phosphate`,
      {
        status: 200,
        body: europePmcList(
          [europePmcResult({ title: "KÜLSŐ CÍM, NEM KIÍRANDÓ" })],
          853,
        ),
      },
    ],
    [`${CROSSREF_BASE}/works?filter=doi:`, crossref],
  ]);
  const clock = fakeClock();
  const value: DiscoveryCliDeps = {
    env: { KNOWLEDGE_DISCOVERY: "on" },
    readInput: async () => INPUT,
    store: {
      preview: async () => {
        calls.push("preview");
        return { ...SUMMARY, runId: null };
      },
      startRun: async (start) => {
        calls.push(`start:${start.requestedById}`);
        return "run-1";
      },
      finishRun: async (runId, result) => {
        calls.push(
          `finish:${runId}:${result.status}:${result.candidates.length}`,
        );
        return SUMMARY;
      },
      failRun: async (runId, reason) => {
        calls.push(`fail:${runId}:${reason}`);
      },
    },
    actorExists: async (id) => id === "u-1",
    fetch: network.fetch,
    sleep: clock.sleep,
    now: clock.now,
    ...over,
  };
  return { value, calls, network };
}

function output() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    sink: {
      stdout: (t: string) => (out.stdout += t),
      stderr: (t: string) => (out.stderr += t),
    },
  };
}

describe("knowledge:discover", () => {
  it("without --apply it reads and previews, and stores nothing", async () => {
    const d = deps();
    const o = output();
    const code = await runDiscoveryCli(["--input", "x.json"], o.sink, d.value);
    assert.equal(code, 0);
    assert.deepEqual(d.calls, ["preview"]);
    assert.match(o.out.stdout, /EUROPE_PMC SEARCH .*találat 853, letöltve 1/);
    assert.match(o.out.stdout, /Próbafutás: semmi nem tárolódott/);
  });

  it("the output carries identifiers and counts, never a title", async () => {
    const d = deps();
    const o = output();
    await runDiscoveryCli(["--input", "x.json"], o.sink, d.value);
    assert.doesNotMatch(o.out.stdout, /KÜLSŐ CÍM/);
  });

  it("--apply stores with the actor", async () => {
    const d = deps();
    const o = output();
    const code = await runDiscoveryCli(
      ["--input", "x.json", "--apply", "--actor", "u-1"],
      o.sink,
      d.value,
    );
    assert.equal(code, 0);
    assert.deepEqual(d.calls, ["start:u-1", "finish:run-1:FINISHED:1"]);
    assert.match(o.out.stdout, /Futás run-1: új forrás: 1/);
  });

  it("--apply needs the switch on, before any request goes out", async () => {
    for (const env of [
      {},
      { KNOWLEDGE_DISCOVERY: "off" },
      { KNOWLEDGE_DISCOVERY: "1" },
    ]) {
      const d = deps({ env });
      const o = output();
      const code = await runDiscoveryCli(
        ["--input", "x.json", "--apply", "--actor", "u-1"],
        o.sink,
        d.value,
      );
      assert.equal(code, 1);
      assert.deepEqual(d.calls, []);
      assert.equal(d.network.asked.length, 0);
    }
  });

  it("--apply needs an existing actor", async () => {
    for (const argv of [
      ["--input", "x.json", "--apply"],
      ["--input", "x.json", "--apply", "--actor", "nincs"],
    ]) {
      const d = deps();
      assert.equal(await runDiscoveryCli(argv, output().sink, d.value), 2);
      assert.equal(d.network.asked.length, 0);
    }
  });

  it("a run that could not check every DOI stores no source, only its record: exit 3", async () => {
    const d = deps({}, { status: 503, body: {} });
    const o = output();
    const code = await runDiscoveryCli(
      ["--input", "x.json", "--apply", "--actor", "u-1"],
      o.sink,
      d.value,
    );
    assert.equal(code, 3);
    // the run is in the log with its status; no source is stored
    assert.deepEqual(d.calls, ["start:u-1", "finish:run-1:INCOMPLETE:1"]);
    assert.match(o.out.stdout, /NEM TELJES/);
    assert.match(o.out.stdout, /NEM ELÉRHETŐ: CROSSREF \(HTTP_503\)/);
  });

  it("the request limit stops it, no source stored: exit 3", async () => {
    const d = deps();
    const o = output();
    const code = await runDiscoveryCli(
      ["--input", "x.json", "--max-requests", "1", "--apply", "--actor", "u-1"],
      o.sink,
      d.value,
    );
    assert.equal(code, 3);
    assert.deepEqual(d.calls, ["start:u-1", "finish:run-1:LIMIT_REACHED:1"]);
    assert.match(o.out.stdout, /KORLÁT ELÉRVE \(1 lekérés\)/);
  });

  it("a work matching two rows is reported and makes the exit 4", async () => {
    const d = deps({
      store: {
        preview: async () => SUMMARY,
        startRun: async () => "run-1",
        failRun: async () => undefined,
        finishRun: async () => ({
          ...SUMMARY,
          ambiguous: [
            { identifiers: "doi:10.5555/coral.1 pmid:111", rowIds: ["a", "b"] },
          ],
        }),
      },
    });
    const o = output();
    const code = await runDiscoveryCli(
      ["--input", "x.json", "--apply", "--actor", "u-1"],
      o.sink,
      d.value,
    );
    assert.equal(code, 4);
    assert.match(
      o.out.stdout,
      /TÖBB SORRA ILLIK, KIHAGYVA: doi:10\.5555\/coral\.1 pmid:111 -> a, b/,
    );
  });

  it("bad arguments and bad input: exit 2, no request", async () => {
    for (const [argv, input] of [
      [[], INPUT],
      [["--input", "x.json", "--max-requests", "0"], INPUT],
      [["--input", "x.json", "--max-requests", "1001"], INPUT],
      [["--input", "x.json"], "{"],
    ] as [string[], string][]) {
      const d = deps({ readInput: async () => input });
      assert.equal(
        await runDiscoveryCli(argv, output().sink, d.value),
        2,
        argv.join(" "),
      );
      assert.equal(d.network.asked.length, 0);
    }
  });

  it("a run that throws is recorded FAILED, by the error's name only", async () => {
    const d = deps();
    d.value.store.finishRun = async () => {
      throw new SyntaxError("a text that must not be stored");
    };
    await assert.rejects(
      runDiscoveryCli(
        ["--input", "x.json", "--apply", "--actor", "u-1"],
        output().sink,
        d.value,
      ),
      SyntaxError,
    );
    assert.deepEqual(d.calls, ["start:u-1", "fail:run-1:SyntaxError"]);
  });

  it("identifiers from an API are shown short and printable only", () => {
    assert.equal(shown("10.5555/abc"), "10.5555/abc");
    assert.equal(shown("10.5555/a b\u0007c"), "10.5555/a b?c");
    assert.equal(
      shown("10.5555/ignore previous instructions", 20),
      "10.5555/ignore previ...",
    );
  });

  it("works stored without the retraction check are counted on their own line", () => {
    assert.match(
      storeReport({ ...SUMMARY, retractionUnchecked: 3 }, true),
      /Visszavonás-ellenőrzés NÉLKÜL \(nincs DOI, a Crossref nem nézhette meg\): 3/,
    );
    assert.doesNotMatch(storeReport(SUMMARY, true), /Visszavonás-ellenőrzés/);
  });
});
