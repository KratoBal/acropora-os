import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { drawGameWinner, type GameDrawCandidate } from "@acropora/types";

import { GameAdminService } from "./game-admin.service.js";
import {
  GameErasureScheduler,
  gameEraseDryRun,
} from "./game-erasure.scheduler.js";
import {
  GAME_ERASE_AFTER_DAYS_DEFAULT,
  gameEraseAfterDays,
  GameErasureService,
} from "./game-erasure.service.js";
import { GameService } from "./game.service.js";

/*
  THE PLAYERS' DATA ERASED AFTER THE GRAND PRIZE DRAW (card bc0ca668; the privacy notice, points 4 and 5). What turns this
  red: an erasure before the grand prize draw, or before its days have passed; a non-winner's name, address or answer
  left anywhere (the entry, a draw's candidate list, a re-run's winner); a winner's name or address lost (accounting),
  or the public list changing; a kept draw that no longer picks the same winner when run again; a second run writing
  again; a dry run writing at all; an entry of a question set up after the draw touched; an address in the audit row or
  the log; a day count past the notice's 15 taken.
*/
const DAY = 86_400_000;
const Q1_CLOSES = new Date("2026-11-21T20:00:00Z");
const Q2_CLOSES = new Date("2026-11-28T20:00:00Z");
const GRAND_AT = new Date("2026-12-26T21:00:00Z");

type Row = Record<string, any>;

/** An in-memory database for the queries the erasure, the public winner list and `verify` make. */
function fakeDatabase(rows: {
  questions: Row[];
  entries: Row[];
  draws: Row[];
}) {
  const audits: Row[] = [];
  let writes = 0;
  const pick = (row: Row, select?: Record<string, boolean>) =>
    select
      ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
      : { ...row };
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, cond]) => {
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if ("in" in cond) return cond.in.includes(row[key]);
        if ("not" in cond) return row[key] !== cond.not;
      }
      return row[key] === cond;
    });
  /** a write is lazy, like Prisma's: it lands when the transaction runs it */
  const update =
    (table: Row[]) =>
    ({ where, data }: Row) => ({
      apply: () => {
        const row = table.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        writes++;
      },
    });
  const database = {
    gameQuestion: {
      findMany: async ({ select }: Row = {}) =>
        rows.questions.map((q) => pick(q, select)),
    },
    gameEntry: {
      findMany: async ({ where, select }: Row = {}) =>
        rows.entries
          .filter((e) => matches(e, where))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((e) => pick(e, select)),
      update: update(rows.entries),
    },
    gameDraw: {
      findMany: async ({ select, include }: Row = {}) =>
        rows.draws.map((d) => ({
          ...pick(d, select),
          ...(include?.question
            ? {
                question:
                  rows.questions.find((q) => q.id === d.questionId) ?? null,
              }
            : {}),
        })),
      findUnique: async ({ where }: Row) =>
        rows.draws.find((d) => d.id === where.id) ?? null,
      update: update(rows.draws),
    },
    auditLog: {
      create: async ({ data }: Row) => void audits.push(data),
    },
    $transaction: async (ops: { apply: () => void }[]) => {
      for (const op of ops) op.apply();
    },
  };
  return { database, audits, writes: () => writes };
}

function draw(
  id: string,
  kind: "WEEKLY" | "CHRISTMAS",
  questionId: string | null,
  candidates: GameDrawCandidate[],
  seed: string,
  createdAt: Date,
) {
  const sorted = [...candidates].sort((a, b) => (a.email < b.email ? -1 : 1));
  const result = drawGameWinner(sorted, seed);
  return {
    id,
    kind,
    questionId,
    seed,
    candidates: sorted,
    winnerEmail: result?.winner.email ?? null,
    ticket: result?.ticket ?? null,
    tickets: result?.tickets ?? 0,
    createdById: "u1",
    createdAt,
  };
}

let n = 0;
const entry = (questionId: string, email: string, name: string | null) => ({
  id: `e${++n}`,
  questionId,
  email,
  name,
  answer: `valasz-${email}`,
  createdAt: new Date(Q1_CLOSES.getTime() - 3 * DAY + n * 1000),
});

/** Two closed weeks and the grand prize draw (with a re-run of week 1), and a question set up after it. */
function round() {
  const questions = [
    { id: "q1", week: "2026-W47", prizeName: "Pólo", closesAt: Q1_CLOSES },
    { id: "q2", week: "2026-W48", prizeName: "Bögre", closesAt: Q2_CLOSES },
    {
      id: "q9",
      week: "2027-W47",
      prizeName: null,
      closesAt: new Date("2027-11-20T20:00:00Z"),
    },
  ];
  const entries = [
    entry("q1", "anna@x.hu", "Kiss Anna"),
    entry("q1", "bela@x.hu", "Nagy Béla"),
    entry("q1", "dani@x.hu", "Tóth Dániel"),
    entry("q2", "anna@x.hu", "Kiss Anna"),
    entry("q2", "cili@x.hu", "Szabó Cili"),
    entry("q2", "edit@x.hu", null),
    entry("q9", "fanni@x.hu", "Varga Fanni"),
  ];
  const weekly1 = [
    { email: "anna@x.hu", weight: 1 },
    { email: "bela@x.hu", weight: 1 },
    { email: "dani@x.hu", weight: 1 },
  ];
  const weekly2 = [
    { email: "anna@x.hu", weight: 1 },
    { email: "cili@x.hu", weight: 1 },
  ];
  const christmas = [
    { email: "anna@x.hu", weight: 2 },
    { email: "bela@x.hu", weight: 1 },
    { email: "cili@x.hu", weight: 1 },
    { email: "dani@x.hu", weight: 1 },
  ];
  const draws = [
    draw(
      "d1",
      "WEEKLY",
      "q1",
      weekly1,
      "mag-1",
      new Date(Q1_CLOSES.getTime() + DAY),
    ),
    draw(
      "d2",
      "WEEKLY",
      "q2",
      weekly2,
      "mag-2",
      new Date(Q2_CLOSES.getTime() + DAY),
    ),
    // a re-run of week 1: a check, no one's result
    draw(
      "d3",
      "WEEKLY",
      "q1",
      weekly1,
      "mag-3",
      new Date(Q2_CLOSES.getTime() + 2 * DAY),
    ),
    draw("d4", "CHRISTMAS", null, christmas, "mag-4", GRAND_AT),
    // a re-run of the Christmas draw
    draw(
      "d5",
      "CHRISTMAS",
      null,
      christmas,
      "mag-5",
      new Date(GRAND_AT.getTime() + 60_000),
    ),
  ];
  return { questions, entries, draws };
}

function services(rows: ReturnType<typeof round>, now: Date, env: Row = {}) {
  const fake = fakeDatabase(rows);
  const erasure = new GameErasureService();
  erasure.database = fake.database as never;
  erasure.now = () => now;
  erasure.environment = env;
  const game = new GameService(null, {});
  game.database = fake.database as never;
  const admin = new GameAdminService(game);
  admin.database = fake.database as never;
  return { ...fake, erasure, game, admin };
}

const firstWinners = (rows: ReturnType<typeof round>) =>
  new Set(
    ["d1", "d2", "d4"]
      .map((id) => rows.draws.find((d) => d.id === id)!.winnerEmail)
      .filter((e): e is string => e !== null),
  );

describe("the game data erasure", () => {
  it("erases nothing before the grand prize draw, nor before its days have passed", async () => {
    const before = round();
    before.draws = before.draws.filter((d) => d.kind === "WEEKLY");
    const early = services(before, new Date("2027-01-30T00:00:00Z"));
    const none = await early.erasure.run({ dryRun: false });
    assert.equal(none.due, false);
    assert.equal(none.dueAt, null);
    assert.equal(early.writes(), 0);

    const rows = round();
    const almost = services(
      rows,
      new Date(GRAND_AT.getTime() + GAME_ERASE_AFTER_DAYS_DEFAULT * DAY - 1),
    );
    const notYet = await almost.erasure.run({ dryRun: false });
    assert.equal(notYet.due, false);
    assert.equal(
      notYet.dueAt,
      new Date(GRAND_AT.getTime() + 14 * DAY).toISOString(),
    );
    assert.equal(almost.writes(), 0);
    assert.equal(almost.audits.length, 0);
  });

  it("the due date is the FIRST Christmas draw plus the days, not a re-run's", async () => {
    const rows = round();
    const s = services(rows, new Date(GRAND_AT.getTime() + 14 * DAY));
    const plan = await s.erasure.plan();
    assert.equal(plan.grandDrawId, "d4");
    assert.equal(plan.due, true);
    const custom = services(round(), new Date(GRAND_AT.getTime() + 3 * DAY), {
      JATEK_ERASE_AFTER_DAYS: "3",
    });
    assert.equal((await custom.erasure.plan()).due, true);
  });

  it("after the days: no non-winner is left anywhere, the winners keep name and address, the draws repeat", async () => {
    const rows = round();
    const winners = firstWinners(rows);
    const s = services(rows, new Date(GRAND_AT.getTime() + 15 * DAY));
    const publicBefore = await s.game.winners();
    const result = await s.erasure.run({ dryRun: false, userId: null });

    assert.equal(result.due, true);
    assert.equal(result.keptWinners, winners.size);

    const inRound = rows.entries.filter((e) => e.questionId !== "q9");
    const remaining = inRound.filter((e) => !e.email.startsWith("erased:"));
    // every winner keeps one entry with name and address, without the answer; nobody else keeps one
    for (const email of winners)
      assert.ok(
        remaining.some((e) => e.email === email && e.name),
        `${email} kept`,
      );
    for (const e of remaining) {
      assert.ok(winners.has(e.email), `${e.email} is a winner`);
      assert.equal(e.answer, "");
    }
    for (const e of inRound.filter((e) => e.email.startsWith("erased:"))) {
      assert.equal(e.email, `erased:${e.id}`);
      assert.equal(e.name, null);
      assert.equal(e.answer, "");
    }

    // no non-winner's address in any entry or draw; a draw keeps only its own first-draw winner
    const losers = ["anna", "bela", "cili", "dani", "edit"]
      .map((p) => `${p}@x.hu`)
      .filter((e) => !winners.has(e));
    assert.ok(losers.length > 0);
    const everything = JSON.stringify({
      entries: inRound,
      draws: rows.draws,
    });
    for (const email of losers) assert.ok(!everything.includes(email), email);
    for (const d of rows.draws) {
      const first = ["d1", "d2", "d4"].includes(d.id);
      const addresses = (d.candidates as GameDrawCandidate[])
        .map((c) => c.email)
        .filter((e) => e.includes("@"));
      assert.deepEqual(
        addresses,
        first && d.winnerEmail ? [d.winnerEmail] : [],
        d.id,
      );
      if (!first) assert.ok(!d.winnerEmail?.includes("@"), `${d.id} winner`);
    }

    // every kept draw picks the same (kept or placeholder) winner when run again
    for (const d of rows.draws)
      assert.equal((await s.admin.verify(d.id)).same, true, d.id);
    // the public list is what it was
    assert.deepEqual(await s.game.winners(), publicBefore);

    // a question set up after the draw: untouched
    const later = rows.entries.find((e) => e.questionId === "q9")!;
    assert.equal(later.email, "fanni@x.hu");
    assert.equal(later.answer, "valasz-fanni@x.hu");

    // one audit row, with counts and no address
    assert.equal(s.audits.length, 1);
    assert.equal(s.audits[0]!.action, "game.data-erased");
    assert.equal(s.audits[0]!.entityId, "d4");
    assert.equal(s.audits[0]!.metadata.entriesErased, result.entriesErased);
    assert.ok(!JSON.stringify(s.audits).includes("@"));
  });

  it("a second run finds nothing left: no write, no audit row", async () => {
    const rows = round();
    const s = services(rows, new Date(GRAND_AT.getTime() + 15 * DAY));
    await s.erasure.run({ dryRun: false });
    const writes = s.writes();
    const snapshot = JSON.stringify(rows);
    const again = await s.erasure.run({ dryRun: false });
    assert.equal(
      again.entriesErased + again.winnerEntriesTrimmed + again.drawsAnonymised,
      0,
    );
    assert.equal(s.writes(), writes);
    assert.equal(JSON.stringify(rows), snapshot);
    assert.equal(s.audits.length, 1);
  });

  it("a dry run counts what a run would erase and writes nothing", async () => {
    const rows = round();
    const snapshot = JSON.stringify(rows);
    const s = services(rows, new Date(GRAND_AT.getTime() + 15 * DAY));
    const dry = await s.erasure.run({ dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.entriesErased > 0 && dry.drawsAnonymised > 0);
    assert.equal(s.writes(), 0);
    assert.equal(s.audits.length, 0);
    assert.equal(JSON.stringify(rows), snapshot);
    // and the real run erases exactly what the dry run counted
    const real = await s.erasure.run({ dryRun: false });
    assert.deepEqual({ ...real, dryRun: true }, dry);
  });
});

describe("the erasure's days and switch", () => {
  it("0..15 days are taken, anything else falls back to 14 and says so", () => {
    assert.deepEqual(gameEraseAfterDays(undefined), { days: 14, error: null });
    assert.deepEqual(gameEraseAfterDays("0"), { days: 0, error: null });
    assert.deepEqual(gameEraseAfterDays("15"), { days: 15, error: null });
    for (const bad of ["16", "-1", "1.5", "tizenot"]) {
      const out = gameEraseAfterDays(bad);
      assert.equal(out.days, 14, bad);
      assert.ok(out.error?.includes("JATEK_ERASE_AFTER_DAYS"), bad);
    }
  });

  it("the dry run is on only for an explicit on", () => {
    assert.equal(gameEraseDryRun({ JATEK_ERASE_DRY_RUN: "on" }), true);
    assert.equal(gameEraseDryRun({ JATEK_ERASE_DRY_RUN: " ON " }), true);
    assert.equal(gameEraseDryRun({ JATEK_ERASE_DRY_RUN: "off" }), false);
    assert.equal(gameEraseDryRun({}), false);
  });

  it("the scheduled run passes the switch, and a failure logs no address", async () => {
    const calls: unknown[] = [];
    const scheduler = new GameErasureScheduler({
      run: async (options: unknown) => {
        calls.push(options);
        if (calls.length === 2)
          throw Object.assign(new Error("write failed for anna@x.hu"), {
            code: "P2025",
          });
        return {} as never;
      },
    } as never);
    const logged: string[] = [];
    (
      scheduler as unknown as { logger: { error: (m: string) => void } }
    ).logger = { error: (m: string) => void logged.push(m) };
    scheduler.environment = { JATEK_ERASE_DRY_RUN: "on" };
    assert.equal(await scheduler.runOnce(), "DONE");
    scheduler.environment = {};
    assert.equal(await scheduler.runOnce(), "FAILED");
    assert.deepEqual(calls, [{ dryRun: true }, { dryRun: false }]);
    assert.equal(logged.length, 1);
    assert.ok(logged[0]!.includes("P2025"));
    assert.ok(!logged[0]!.includes("@"));
  });
});
