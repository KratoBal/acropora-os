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
  /** what Számlázz.hu answers per number; a number in the feed that is not listed is KNOWN (it is in Számlázz.hu) */
  knows: Record<string, FeedPullLine["outcome"]>;
  /** after this many asks the feed's own numbers stop being found (a key change or a fault in the middle of a round) */
  breakAfterAsks?: number;
  /** the detail line for a number that is not found (the Számlázz.hu's own wording) */
  notFoundDetail?: string;
}) {
  const checked = new Map(
    (options.checked ?? []).map((c) => [c.number, { ...c }]),
  );
  const asked: string[] = [];
  let asks = 0;
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
  const diagnosed: string[] = [];
  const feedPull = {
    diagnose: async (number: string) => {
      diagnosed.push(number);
      return [`diag ${number}`];
    },
    pull: async (numbers: string[], apply: boolean) => {
      asked.push(`${apply ? "apply" : "dry"} ${numbers.join(",")}`);
      asks += numbers.length;
      return numbers.map((number) => {
        const broken =
          options.breakAfterAsks !== undefined && asks > options.breakAfterAsks;
        const known =
          options.knows[number] ??
          (options.stored.includes(number) && !broken
            ? "WOULD_STORE"
            : "NOT_FOUND");
        return {
          number,
          outcome: known === "WOULD_STORE" && apply ? "STORED" : known,
          detail: known === "NOT_FOUND" ? (options.notFoundDetail ?? "d") : "d",
        } as FeedPullLine;
      });
    },
  };
  const service = new FeedBackfillService(feedPull as never);
  service.store = store;
  service.delayMs = 0;
  return { service, asked, checked, diagnosed };
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
      // the control first: the highest stored number of each series, which Számlázz.hu certainly has
      "dry 2026/00003",
      "dry ACRW-2026/00004",
      "dry 2026/00001",
      "dry 2026/00002",
      "dry ACRW-2026/00001",
      "dry ACRW-2026/00002",
      "dry ACRW-2026/00003",
      // the control once more at the end of the round (it had noes)
      "dry 2026/00003",
      "dry ACRW-2026/00004",
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
    assert.deepEqual(asked, [
      "dry ACRW-2026/00004",
      "dry ACRW-2026/00003",
      "dry ACRW-2026/00004",
    ]);
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

  // acrobot 57804: a 2026-11-19-i első élő kör mind az 542 számra "nincs ilyen szám"-ot rögzített, a 2026/00058-ra is
  it("when the highest stored number (which exists) is not found, the round asks nothing else, records nothing and says why", async () => {
    const { service, asked, checked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      knows: { "ACRW-2026/00004": "NOT_FOUND", "2026/00003": "NOT_FOUND" },
      notFoundDetail: "a Számlázz.hu 7-es hibakóddal felelt: Hiányzó adat",
    });
    const answer = await service.start(false, "u-1", NOW);
    assert.equal(answer.status, "control-failed");
    assert.deepEqual(asked, ["dry 2026/00003", "dry ACRW-2026/00004"]);
    assert.equal(checked.size, 0);
    const status = await service.status(NOW);
    assert.equal(status.running, null);
    assert.deepEqual(status.checked, {});
    assert.deepEqual(
      status.control?.results.map((r) => [r.number, r.passed, r.detail]),
      [
        [
          "2026/00003",
          false,
          "a Számlázz.hu 7-es hibakóddal felelt: Hiányzó adat",
        ],
        [
          "ACRW-2026/00004",
          false,
          "a Számlázz.hu 7-es hibakóddal felelt: Hiányzó adat",
        ],
      ],
    );
    // the slot is free again: a second press runs the control again
    assert.equal(
      (await service.start(false, "u-1", NOW)).status,
      "control-failed",
    );
  });

  it("one series failing its control stops the whole round (a half-trusted round would still count the failing series)", async () => {
    const { service, asked, checked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      knows: { "ACRW-2026/00004": "NOT_FOUND" },
    });
    const answer = await service.start(false, "u-1", NOW);
    assert.equal(answer.status, "control-failed");
    assert.equal(checked.size, 0);
    assert.ok(!asked.some((a) => a === "dry ACRW-2026/00001"));
    const status = await service.status(NOW);
    assert.deepEqual(
      status.control?.results.map((r) => [r.series, r.passed]),
      [
        ["2026", true],
        ["ACRW-2026", false],
      ],
    );
  });

  it("a passed control is reported, and a NOT_FOUND after it is a recorded no", async () => {
    const { service, checked } = setup({
      stored: ["2026/00003"],
      knows: { "2026/00001": "WOULD_STORE" },
    });
    assert.equal((await service.start(false, "u-1", NOW)).status, "started");
    await service.settled();
    assert.equal(checked.get("2026/00002")?.outcome, "NOT_FOUND");
    const status = await service.status(NOW);
    assert.equal(status.control?.results.length, 1);
    assert.equal(status.control?.results[0]?.passed, true);
  });

  it("only a series with a gap is controlled, and the behúzás needs no control", async () => {
    const { service, asked } = setup({
      stored: ["2026/00001", "2026/00002", "ACRW-2026/00003"],
      knows: {},
    });
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.deepEqual(asked.slice(0, 2), [
      "dry ACRW-2026/00003",
      "dry ACRW-2026/00001",
    ]);
  });

  it("an answer recorded without a control (UNVERIFIED) is asked again, a controlled no is not", async () => {
    const { service, asked } = setup({
      stored: ["ACRW-2026/00004"],
      checked: [
        {
          number: "ACRW-2026/00001",
          series: "ACRW-2026",
          outcome: "UNVERIFIED",
        },
        {
          number: "ACRW-2026/00002",
          series: "ACRW-2026",
          outcome: "NOT_FOUND",
        },
      ],
      knows: {},
    });
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.deepEqual(asked, [
      "dry ACRW-2026/00004",
      "dry ACRW-2026/00001",
      "dry ACRW-2026/00003",
      "dry ACRW-2026/00004",
    ]);
  });

  it("a round that breaks in the middle: the control asked at the end fails, and this round's noes are not final", async () => {
    // 1 control + 2 gaps pass, then the feed's own number is not found any more
    const { service, checked } = setup({
      stored: ["2026/00003"],
      knows: {},
      breakAfterAsks: 3,
    });
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.equal(checked.get("2026/00001")?.outcome, "UNVERIFIED");
    assert.equal(checked.get("2026/00002")?.outcome, "UNVERIFIED");
    const status = await service.status(NOW);
    assert.equal(status.control?.results[0]?.passed, false);
  });

  it("the behúzás round runs no control, so a 7 there is not a final no", async () => {
    const { service, checked } = setup({
      stored: ["2026/00003"],
      checked: [
        { number: "2026/00001", series: "2026", outcome: "WOULD_STORE" },
      ],
      knows: { "2026/00001": "NOT_FOUND" },
    });
    await service.start(true, "u-1", NOW);
    await service.settled();
    assert.equal(checked.get("2026/00001")?.outcome, "UNVERIFIED");
  });

  // acrobot 57902: a kontroll bukása után a három olvasó kérdés választja szét, hogy a kérés alakja vagy a szám látszata a baj
  it("a failed control carries the diagnostics of each failing series, and a passed one carries none", async () => {
    const { service, diagnosed } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      knows: { "ACRW-2026/00004": "NOT_FOUND" },
    });
    await service.start(false, "u-1", NOW);
    const results = (await service.status(NOW)).control!.results;
    assert.deepEqual(
      results.map((r) => [r.series, r.passed, r.diagnostics]),
      [
        ["2026", true, undefined],
        ["ACRW-2026", false, ["diag ACRW-2026/00004"]],
      ],
    );
    assert.deepEqual(diagnosed, ["ACRW-2026/00004"]);
  });

  it("the control asked at the end of a round does not run the diagnostics again", async () => {
    const { service, diagnosed } = setup({
      stored: ["2026/00003"],
      knows: {},
      breakAfterAsks: 3,
    });
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.deepEqual(diagnosed, []);
  });
});
