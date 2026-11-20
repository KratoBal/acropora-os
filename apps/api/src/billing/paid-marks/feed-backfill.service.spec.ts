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
  /** does the key find the invoice the OS issued itself: true, false, or null (not known); absent: the method does not exist */
  ownKnown?: boolean | null;
  /** the round's own questions (not the control) wait for this, so a test can hold a round running */
  hold?: Promise<void>;
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
    clearForeign: async (series) => {
      let removed = 0;
      for (const [number, row] of checked)
        if (row.series === series && row.outcome === "NOT_OUR_ACCOUNT") {
          checked.delete(number);
          removed += 1;
        }
      return removed;
    },
    record: async ({ number, series, line }) =>
      void checked.set(number, { number, series, outcome: line.outcome }),
  };
  const diagnosed: string[] = [];
  const feedPull = {
    ...("ownKnown" in options
      ? { keyKnowsOwnNumber: async () => options.ownKnown ?? null }
      : {}),
    diagnose: async (number: string) => {
      diagnosed.push(number);
      return [`diag ${number}`];
    },
    pull: async (numbers: string[], apply: boolean) => {
      if (options.hold && !options.stored.includes(numbers[0]!))
        await options.hold;
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
  /*
    A MI FIÓKUNKON KÍVÜLI SOROZAT (acrobot 58095, Balázs 2026-11-20: a 2026/ és az ACRW-2026/ számlák a másik számlázó
    programból jönnek a push-végponton, a Számlázz.hu-ból soha nem tölthetők vissza). MI PIROSÍT: ha a 7-es kontroll mellett
    is megáll a kör, holott az OS saját számlája megvan (a kulcs jó); ha a kimarad-ítélet nem rögzül (újraindítás után
    újra kérdezné); ha a kimaradt sorozat hiányzó számait mégis megkérdezi; ha a másik sorozat köre ettől nem indul; ha
    az ítélet a saját számla ismerete nélkül is megszületik (a kulcs hibája is 7-et ad); ha egy hibás (nem 7-es) válasz is
    kimaradást jelent.
  */
  it("a series whose control gets a 7 while the key finds the OS's own invoice is judged foreign, recorded, and the other series goes on", async () => {
    const { service, asked, checked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      knows: { "ACRW-2026/00004": "NOT_FOUND" },
      ownKnown: true,
    });
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "started",
      phase: "dry",
      total: 2,
    });
    // the control as the press saw it (the control at the end of the round no longer asks the foreign series)
    const control = (await service.status(NOW)).control!.results;
    await service.settled();
    // the foreign series is never asked beyond the control: only the 2026 gaps are
    assert.ok(
      !asked.some((a) => a.includes("ACRW-2026/0000") && !a.includes("00004")),
    );
    assert.ok(asked.includes("dry 2026/00001"));
    assert.equal(checked.get("ACRW-2026/00004")?.outcome, "NOT_OUR_ACCOUNT");
    const status = await service.status(NOW);
    assert.equal(status.checked["ACRW-2026"]?.NOT_OUR_ACCOUNT, 1);
    assert.deepEqual(
      control.map((r) => [r.series, r.passed, r.foreign]),
      [
        ["2026", true, undefined],
        ["ACRW-2026", false, true],
      ],
    );
  });

  it("the judgement stays: the next round neither controls nor asks the foreign series, and a round with only foreign series has nothing to ask", async () => {
    const { service, asked, diagnosed } = setup({
      stored: ["ACRW-2026/00004"],
      knows: { "ACRW-2026/00004": "NOT_FOUND" },
      ownKnown: true,
    });
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "nothing",
      phase: "dry",
    });
    assert.deepEqual(asked, ["dry ACRW-2026/00004"]);
    assert.deepEqual(diagnosed, ["ACRW-2026/00004"]);
    // a second press asks nothing at all: the verdict is in the table
    asked.length = 0;
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "nothing",
      phase: "dry",
    });
    assert.deepEqual(asked, []);
  });

  it("a persisted verdict keeps the series out of the targets without any new question", async () => {
    const { service, asked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      checked: [
        {
          number: "ACRW-2026/00004",
          series: "ACRW-2026",
          outcome: "NOT_OUR_ACCOUNT",
        },
      ],
      knows: {},
      ownKnown: true,
    });
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "started",
      phase: "dry",
      total: 2,
    });
    await service.settled();
    assert.ok(!asked.some((a) => a.includes("ACRW")));
  });

  it("without the proof that the key finds the OS's own invoice (false, unknown, or no such method) a 7 stays a control failure", async () => {
    for (const ownKnown of [false, null, undefined] as const) {
      const { service, checked } = setup({
        stored: ["ACRW-2026/00004", "2026/00003"],
        knows: { "ACRW-2026/00004": "NOT_FOUND" },
        ...(ownKnown === undefined ? {} : { ownKnown }),
      });
      const answer = await service.start(false, "u-1", NOW);
      assert.equal(answer.status, "control-failed");
      assert.equal(checked.get("ACRW-2026/00004")?.outcome, undefined);
    }
  });

  it("only a 7 (not found) can be a foreign series: an error answer on the control stays a control failure even if the key is fine", async () => {
    const { service, checked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      knows: { "ACRW-2026/00004": "ERROR" },
      ownKnown: true,
    });
    const answer = await service.start(false, "u-1", NOW);
    assert.equal(answer.status, "control-failed");
    assert.equal(checked.get("ACRW-2026/00004")?.outcome, undefined);
  });
  /*
    A "NEM A MI FIÓKUNK" ÍTÉLET VISSZAVONÁSA (acrobot 58207, barracuda 58157). MI PIROSÍT: ha a visszavonás nem törli az ítéletet
    (a sorozat örökre idegen marad); ha törli a sorozat többi válaszát is (a "ismeri", "nem ismeri" számok elvesznek); ha közben
    kérdez a Számlázz.hu-tól vagy kört indít (a visszavonás csak a jelölést törli); ha kör közben fut; ha egy nem idegen sorozaton
    "törölt"-et mond; ha a következő ellenőrzés nem dönt újra (nem kontrollálja a sorozatot); ha a memóriában tartott kontroll
    továbbra is idegennek mutatja.
  */
  it("the recheck clears only the foreign verdict, asks nothing, and the next check judges the series again", async () => {
    const { service, asked, checked } = setup({
      stored: ["ACRW-2026/00004", "2026/00003"],
      checked: [
        {
          number: "ACRW-2026/00002",
          series: "ACRW-2026",
          outcome: "WOULD_STORE",
        },
      ],
      knows: { "ACRW-2026/00004": "NOT_FOUND" },
      ownKnown: true,
    });
    // judged foreign by the first check
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.equal(checked.get("ACRW-2026/00004")?.outcome, "NOT_OUR_ACCOUNT");
    asked.length = 0;

    assert.deepEqual(await service.clearForeign("ACRW-2026", "u-2"), {
      status: "cleared",
      series: "ACRW-2026",
    });
    // nothing was asked, no round started
    assert.equal(asked.length, 0);
    assert.equal(checked.get("ACRW-2026/00004"), undefined);
    // the series' other answers stay
    assert.equal(checked.get("ACRW-2026/00002")?.outcome, "WOULD_STORE");
    // the in-memory control no longer shows the series as foreign
    assert.ok(
      !(await service.status(NOW)).control?.results.some(
        (r) => r.series === "ACRW-2026",
      ),
    );

    // the next check controls the series again and judges again
    await service.start(false, "u-1", NOW);
    await service.settled();
    assert.ok(asked.includes("dry ACRW-2026/00004"));
    assert.equal(checked.get("ACRW-2026/00004")?.outcome, "NOT_OUR_ACCOUNT");
  });

  it("the control kept in memory no longer shows the cleared series as foreign", async () => {
    const { service } = setup({
      stored: ["ACRW-2026/00004"],
      knows: { "ACRW-2026/00004": "NOT_FOUND" },
      ownKnown: true,
    });
    // the only series is judged foreign, no round follows, so the control of this press is the last one
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "nothing",
      phase: "dry",
    });
    assert.equal(
      (await service.status(NOW)).control?.results[0]?.foreign,
      true,
    );
    await service.clearForeign("ACRW-2026", "u-2");
    assert.deepEqual((await service.status(NOW)).control?.results, []);
  });

  it("after the recheck a series the key now knows goes on with its numbers (the verdict is not kept)", async () => {
    const { service, asked, checked } = setup({
      stored: ["ACRW-2026/00004"],
      checked: [
        {
          number: "ACRW-2026/00004",
          series: "ACRW-2026",
          outcome: "NOT_OUR_ACCOUNT",
        },
      ],
      // now Számlázz.hu knows the control number: no entry for it, so the stored number answers WOULD_STORE
      knows: {},
      ownKnown: true,
    });
    await service.clearForeign("ACRW-2026", "u-2");
    assert.deepEqual(await service.start(false, "u-1", NOW), {
      status: "started",
      phase: "dry",
      total: 3,
    });
    await service.settled();
    assert.ok(asked.includes("dry ACRW-2026/00001"));
    assert.notEqual(checked.get("ACRW-2026/00004")?.outcome, "NOT_OUR_ACCOUNT");
  });

  it("a series with no foreign verdict says so and changes nothing; a running round blocks the recheck", async () => {
    const { service, checked } = setup({
      stored: ["2026/00003"],
      checked: [
        { number: "2026/00001", series: "2026", outcome: "WOULD_STORE" },
      ],
      knows: {},
      ownKnown: true,
    });
    assert.deepEqual(await service.clearForeign("2026", "u-2"), {
      status: "not-foreign",
      series: "2026",
    });
    assert.equal(checked.get("2026/00001")?.outcome, "WOULD_STORE");

    let release: () => void = () => undefined;
    const foreign = setup({
      hold: new Promise<void>((done) => {
        release = done;
      }),
      stored: ["ACRW-2026/00004", "2026/00003"],
      checked: [
        {
          number: "ACRW-2026/00004",
          series: "ACRW-2026",
          outcome: "NOT_OUR_ACCOUNT",
        },
      ],
      knows: {},
      ownKnown: true,
    });
    await foreign.service.start(false, "u-1", NOW);
    // a round is running (the loop has not settled yet): the recheck is refused, the verdict stays
    assert.deepEqual(await foreign.service.clearForeign("ACRW-2026", "u-2"), {
      status: "running",
    });
    assert.equal(
      foreign.checked.get("ACRW-2026/00004")?.outcome,
      "NOT_OUR_ACCOUNT",
    );
    release();
    await foreign.service.settled();
  });
});
