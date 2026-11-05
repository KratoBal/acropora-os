import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FeedPullLine } from "../feed-pull.js";
import {
  FeedBackfillService,
  type FeedBackfillStore,
} from "./feed-backfill.service.js";

/*
  A VISSZATÖLTÉS KÖREI (6fd8c574; acrobot 43766, 43768, 43776). MI PIROSÍT: ha a száraz kör behúz, vagy egy már
  véglegesen megválaszolt számot újra megkérdez (nem folytatható), vagy a hibásat nem kérdezi újra; ha a behúzás olyan
  számot is húz, amit a Számlázz.hu nem ismer; ha két gombnyomás két kört indít; ha az állapot nem mondja meg
  sorozatonként, hányat ismer a Számlázz.hu. (A korhatár nélküli jelölést a visszatöltés NEM indítja: acrobot 43822,
  előbb a száraz előnézete, utána külön gomb; a szolgáltatásnak ezért nincs is ütemező-függősége.)
*/
const NOW = new Date("2026-11-05T20:00:00Z");

function setup(options: {
  stored: string[];
  checked?: { number: string; series: string; outcome: string }[];
  /** what Számlázz.hu answers per number */
  knows: Record<string, FeedPullLine["outcome"]>;
}) {
  const checked = new Map(
    (options.checked ?? []).map((c) => [c.number, { ...c }]),
  );
  const asked: string[] = [];
  const store: FeedBackfillStore = {
    storedNumbers: async () =>
      options.stored.map((documentNumber) => ({
        documentNumber,
        kindCode: "SZ",
      })),
    checked: async () => [...checked.values()],
    record: async ({ number, series, line }) =>
      void checked.set(number, { number, series, outcome: line.outcome }),
  };
  const feedPull = {
    pull: async (numbers: string[], apply: boolean) => {
      asked.push(`${apply ? "apply" : "dry"} ${numbers.join(",")}`);
      return numbers.map((number) => {
        const known = options.knows[number] ?? "NOT_FOUND";
        return {
          number,
          outcome: known === "WOULD_STORE" && apply ? "STORED" : known,
          detail: "d",
        } as FeedPullLine;
      });
    },
  };
  const service = new FeedBackfillService(feedPull as never);
  service.store = store;
  service.delayMs = 0;
  return { service, asked, checked };
}

describe("the feed backfill", () => {
  it("the dry round asks every gap once, writes nothing, and the status counts the answers per series", async () => {
    const { service, asked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      knows: { "ACRW-2026/00002": "WOULD_STORE", "2026/00001": "WOULD_STORE" },
    });
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "started",
      phase: "dry",
      total: 5,
    });
    await service.settled();
    assert.deepEqual(asked, [
      "dry 2026/00001",
      "dry 2026/00002",
      "dry ACRW-2026/00001",
      "dry ACRW-2026/00002",
      "dry ACRW-2026/00003",
    ]);
    const status = await service.status(NOW);
    assert.deepEqual(status.checked, {
      "2026": { WOULD_STORE: 1, NOT_FOUND: 1 },
      "ACRW-2026": { NOT_FOUND: 2, WOULD_STORE: 1 },
    });
    assert.equal(status.running, null);
    assert.equal(status.last?.phase, "dry");
  });

  it("a second dry round asks only what has no final answer (an error again, not a known or an unknown one)", async () => {
    const { service, asked } = setup({
      stored: ["ACRW-2026/00004"],
      checked: [
        {
          number: "ACRW-2026/00001",
          series: "ACRW-2026",
          outcome: "NOT_FOUND",
        },
        {
          number: "ACRW-2026/00002",
          series: "ACRW-2026",
          outcome: "WOULD_STORE",
        },
        { number: "ACRW-2026/00003", series: "ACRW-2026", outcome: "ERROR" },
      ],
      knows: {},
    });
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.deepEqual(asked, ["dry ACRW-2026/00003"]);
  });

  it("the pull takes only what Számlázz.hu knows", async () => {
    const { service, asked, checked } = setup({
      stored: ["ACRW-2026/00004"],
      checked: [
        {
          number: "ACRW-2026/00001",
          series: "ACRW-2026",
          outcome: "NOT_FOUND",
        },
        {
          number: "ACRW-2026/00002",
          series: "ACRW-2026",
          outcome: "WOULD_STORE",
        },
      ],
      knows: { "ACRW-2026/00002": "WOULD_STORE" },
    });
    assert.deepEqual(await service.start(true, "u-1", NOW), {
      status: "started",
      phase: "apply",
      total: 1,
    });
    await service.settled();
    assert.deepEqual(asked, ["apply ACRW-2026/00002"]);
    assert.equal(checked.get("ACRW-2026/00002")?.outcome, "STORED");
    assert.deepEqual((await service.status(NOW)).last, {
      phase: "apply",
      finishedAt: (await service.status(NOW)).last!.finishedAt,
      done: 1,
    });
  });

  it("one round at a time, and nothing to do says so", async () => {
    const { service } = setup({
      stored: ["ACRW-2026/00003"],
      knows: {},
    });
    const first = service.start(false, "u-1", NOW);
    assert.deepEqual(await service.start(false, "u-2", NOW), {
      status: "running",
    });
    await first;
    await service.settled();
    assert.deepEqual(await service.start(true, "u-1", NOW), {
      status: "nothing",
      phase: "apply",
    });
  });
});
