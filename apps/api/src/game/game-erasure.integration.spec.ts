import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";
import { drawGameWinner, type GameDrawCandidate } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { GameAdminService } from "./game-admin.service.js";
import { GameErasureService } from "./game-erasure.service.js";
import { GameService } from "./game.service.js";

const gate = integrationDatabaseGate(process.env);
const WEEKS = ["1999-W01", "1999-W02"];
const DAY = 86_400_000;
const GRAND_AT = new Date("1999-01-20T21:00:00Z");

async function removeLeftovers() {
  const questions = await prisma.gameQuestion.findMany({
    where: { week: { in: WEEKS } },
    select: { id: true },
  });
  const ids = questions.map((q) => q.id);
  const draws = await prisma.gameDraw.findMany({
    where: { OR: [{ questionId: { in: ids } }, { createdById: "erasure-it" }] },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      action: "game.data-erased",
      entityId: { in: draws.map((d) => d.id) },
    },
  });
  await prisma.gameDraw.deleteMany({
    where: { id: { in: draws.map((d) => d.id) } },
  });
  await prisma.gameEntry.deleteMany({ where: { questionId: { in: ids } } });
  await prisma.gameQuestion.deleteMany({ where: { id: { in: ids } } });
}

/*
  THE ERASURE ON THE REAL SCHEMA (card bc0ca668). What turns this red: an erased address colliding with the
  one-address-per-week rule; a batch write the database refuses; the kept candidate list not written back as JSON; a
  winner's name or address lost; a non-winner's address left in an entry or a draw; a second run writing again.
*/
describe(
  "the game data erasure on the database",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const [q1, q2] = await Promise.all(
        WEEKS.map((week, i) =>
          prisma.gameQuestion.create({
            data: {
              week,
              type: "TEXT",
              prompt: "Próba",
              acceptedAnswers: ["igen"],
              opensAt: new Date(GRAND_AT.getTime() - (20 - i * 7) * DAY),
              closesAt: new Date(GRAND_AT.getTime() - (14 - i * 7) * DAY),
              prizeName: `Díj ${i + 1}`,
            },
          }),
        ),
      );
      let n = 0;
      const entry = (questionId: string, email: string, name: string) =>
        prisma.gameEntry.create({
          data: {
            questionId,
            email,
            name,
            answer: "igen",
            autoCorrect: true,
            confirmTokenHash: `erasure-it-${++n}-${Date.now()}`,
            confirmedAt: new Date(GRAND_AT.getTime() - 15 * DAY),
          },
        });
      for (const [q, email, name] of [
        [q1!.id, "it-anna@x.hu", "Kiss Anna"],
        [q1!.id, "it-bela@x.hu", "Nagy Béla"],
        [q2!.id, "it-anna@x.hu", "Kiss Anna"],
        [q2!.id, "it-cili@x.hu", "Szabó Cili"],
        [q2!.id, "it-dani@x.hu", "Tóth Dániel"],
      ] as const)
        await entry(q, email, name);
      const drawRow = (
        kind: "WEEKLY" | "CHRISTMAS",
        questionId: string | null,
        candidates: GameDrawCandidate[],
        seed: string,
        createdAt: Date,
      ) => {
        const result = drawGameWinner(candidates, seed);
        return prisma.gameDraw.create({
          data: {
            kind,
            questionId,
            seed,
            candidates: candidates as unknown as Prisma.InputJsonValue,
            winnerEmail: result?.winner.email ?? null,
            ticket: result?.ticket ?? null,
            tickets: result?.tickets ?? 0,
            createdById: "erasure-it",
            createdAt,
          },
        });
      };
      await drawRow(
        "WEEKLY",
        q1!.id,
        [
          { email: "it-anna@x.hu", weight: 1 },
          { email: "it-bela@x.hu", weight: 1 },
        ],
        "it-1",
        new Date(GRAND_AT.getTime() - 13 * DAY),
      );
      await drawRow(
        "WEEKLY",
        q2!.id,
        [
          { email: "it-anna@x.hu", weight: 1 },
          { email: "it-cili@x.hu", weight: 1 },
          { email: "it-dani@x.hu", weight: 1 },
        ],
        "it-2",
        new Date(GRAND_AT.getTime() - 6 * DAY),
      );
      await drawRow(
        "CHRISTMAS",
        null,
        [
          { email: "it-anna@x.hu", weight: 2 },
          { email: "it-bela@x.hu", weight: 1 },
          { email: "it-cili@x.hu", weight: 1 },
          { email: "it-dani@x.hu", weight: 1 },
        ],
        "it-3",
        GRAND_AT,
      );
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    it("erases the non-winners, keeps the winners, and a second run writes nothing", async () => {
      const erasure = new GameErasureService();
      erasure.now = () => new Date(GRAND_AT.getTime() + 15 * DAY);
      erasure.environment = {};
      const game = new GameService(null, {});
      const admin = new GameAdminService(game);
      game.now = () => new Date(GRAND_AT.getTime() + DAY);
      const publicBefore = await game.winners();
      assert.ok(publicBefore.winners.length > 0);

      const result = await erasure.run({ dryRun: false });
      assert.equal(result.due, true);

      const draws = await prisma.gameDraw.findMany({
        where: { createdById: "erasure-it" },
      });
      const winners = new Set(
        draws.map((d) => d.winnerEmail).filter((e): e is string => !!e),
      );
      const entries = await prisma.gameEntry.findMany({
        where: { question: { week: { in: WEEKS } } },
      });
      for (const e of entries) {
        if (e.email.startsWith("erased:")) {
          assert.equal(e.email, `erased:${e.id}`);
          assert.equal(e.name, null);
          assert.equal(e.answer, "");
        } else {
          assert.ok(winners.has(e.email), e.email);
          assert.ok(e.name);
          assert.equal(e.answer, "");
        }
      }
      for (const email of winners)
        assert.ok(
          entries.some((e) => e.email === email && e.name),
          email,
        );
      const stored = JSON.stringify({ entries, draws });
      for (const p of ["anna", "bela", "cili", "dani"]) {
        const email = `it-${p}@x.hu`;
        if (!winners.has(email)) assert.ok(!stored.includes(email), email);
      }
      for (const d of draws)
        assert.equal((await admin.verify(d.id)).same, true, d.id);
      // the public list: empty once the erasure is due; before it, the kept rows name the same winners
      game.now = erasure.now;
      assert.deepEqual(await game.winners(), { winners: [] });
      game.now = () => new Date(GRAND_AT.getTime() + DAY);
      assert.deepEqual(await game.winners(), publicBefore);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "game.data-erased",
          entityId: draws.find((d) => d.kind === "CHRISTMAS")!.id,
        },
      });
      assert.ok(audit);
      assert.ok(!JSON.stringify(audit.metadata).includes("@"));

      const again = await erasure.run({ dryRun: false });
      assert.equal(
        again.entriesErased +
          again.winnerEntriesTrimmed +
          again.drawsAnonymised,
        0,
      );
    });
  },
);
