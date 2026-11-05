import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameAdminService } from "./game-admin.service.js";

/*
  THE GIVEAWAY'S ADMIN (card 31445d0f, slice 2). What turns this red: an unconfirmed or a wrong entry in the draw (Balázs:
  only the right answer goes in); a person's decision not overriding the automatic one, either way; the Christmas weight
  not the number of right weeks; a kept draw that picks another winner when run again (it is shown live); a draw or a
  decision without an audit row; a CHOICE question whose right answer is not one of its options.
*/
const D = new Date("2026-11-06T10:00:00Z");
const entry = (
  email: string,
  questionId: string,
  over: Partial<{
    confirmedAt: Date | null;
    autoCorrect: boolean;
    manualCorrect: boolean | null;
  }> = {},
) => ({
  email,
  questionId,
  confirmedAt: D,
  autoCorrect: true,
  manualCorrect: null,
  ...over,
});

function setup(entries: ReturnType<typeof entry>[]) {
  const draws: Record<string, any>[] = [];
  const audits: Record<string, unknown>[] = [];
  const tx = {
    gameDraw: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `d${draws.length + 1}`, ...data };
        draws.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void audits.push(data),
    },
  };
  const database = {
    ...tx,
    gameQuestion: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "nincs" ? null : { id: where.id },
    },
    gameEntry: {
      findMany: async ({ where }: { where: { questionId?: string } }) =>
        entries.filter(
          (e) =>
            e.confirmedAt !== null &&
            (!where.questionId || e.questionId === where.questionId),
        ),
    },
    gameDraw: {
      ...tx.gameDraw,
      findUnique: async ({ where }: { where: { id: string } }) =>
        draws.find((d) => d.id === where.id) ?? null,
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new GameAdminService();
  service.database = database as never;
  return { service, draws, audits };
}

describe("the draw", () => {
  it("takes only confirmed, right entries; a person's decision overrides the automatic one", async () => {
    const { service, draws } = setup([
      entry("jo@x.hu", "w45"),
      entry("rossz@x.hu", "w45", { autoCorrect: false }),
      entry("nincs-megerositve@x.hu", "w45", { confirmedAt: null }),
      entry("kezzel-elfogadva@x.hu", "w45", {
        autoCorrect: false,
        manualCorrect: true,
      }),
      entry("kezzel-elutasitva@x.hu", "w45", { manualCorrect: false }),
      entry("masik-het@x.hu", "w46"),
    ]);
    await service.draw({ kind: "WEEKLY", questionId: "w45" }, "u1");
    assert.deepEqual(
      draws[0]!.candidates.map((c: { email: string }) => c.email),
      ["jo@x.hu", "kezzel-elfogadva@x.hu"],
    );
    assert.ok(
      ["jo@x.hu", "kezzel-elfogadva@x.hu"].includes(draws[0]!.winnerEmail),
    );
  });

  it("the Christmas weight is the number of right, confirmed weeks", async () => {
    const { service, draws } = setup([
      entry("a@x.hu", "w45"),
      entry("a@x.hu", "w46"),
      entry("b@x.hu", "w46"),
      entry("b@x.hu", "w45", { autoCorrect: false }),
    ]);
    await service.draw({ kind: "CHRISTMAS" }, "u1");
    assert.deepEqual(draws[0]!.candidates, [
      { email: "a@x.hu", weight: 2 },
      { email: "b@x.hu", weight: 1 },
    ]);
    assert.equal(draws[0]!.tickets, 3);
  });

  it("is kept with its seed and candidates, audited, and run again picks the same winner", async () => {
    const { service, draws, audits } = setup([
      entry("a@x.hu", "w45"),
      entry("b@x.hu", "w45"),
      entry("c@x.hu", "w45"),
    ]);
    const draw = await service.draw(
      { kind: "WEEKLY", questionId: "w45" },
      "u1",
    );
    assert.match(draw.seed, /^[0-9a-f]{32}$/);
    assert.equal(audits.length, 1);
    const again = await service.verify(draws[0]!.id);
    assert.equal(again.same, true);
    assert.equal(again.winnerEmail, draws[0]!.winnerEmail);
  });

  it("a weekly draw needs its question", async () => {
    const { service } = setup([]);
    await assert.rejects(
      service.draw({ kind: "WEEKLY" }, "u1"),
      (e: any) => e.getResponse().code === "INVALID_DRAW",
    );
  });
});

describe("an edit of a question (barracuda, #2254)", () => {
  // WHAT TURNS THIS RED: an accepted variant added after the answers came in, and the stored "no match" staying, so a
  // right answer falls out of the draw; or a person's decision overwritten by the recount
  it("works the stored decision out again; a person's decision stays", async () => {
    const rows = [
      { id: "e1", answer: "akropóra", autoCorrect: false, manualCorrect: null },
      {
        id: "e2",
        answer: "Montipora",
        autoCorrect: false,
        manualCorrect: true,
      },
      { id: "e3", answer: "Acropora", autoCorrect: true, manualCorrect: null },
    ];
    const tx = {
      gameQuestion: {
        update: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "q1",
          ...data,
        }),
      },
      gameEntry: {
        findMany: async () =>
          rows.map(({ id, answer, autoCorrect }) => ({
            id,
            answer,
            autoCorrect,
          })),
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { autoCorrect: boolean };
        }) => {
          Object.assign(
            rows.find((r) => r.id === where.id)!,
            data,
          );
        },
      },
    };
    const service = new GameAdminService();
    service.database = {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never;
    await service.updateQuestion("q1", {
      week: "2026-W45",
      type: "TEXT",
      prompt: "Melyik?",
      options: [],
      acceptedAnswers: ["Acropora", "Akropora"],
      opensAt: "2026-11-06T06:00:00Z",
      closesAt: "2026-11-13T22:59:59Z",
    });
    assert.deepEqual(
      rows.map((r) => [r.id, r.autoCorrect, r.manualCorrect]),
      [
        ["e1", true, null],
        ["e2", false, true],
        ["e3", true, null],
      ],
    );
  });

  it("a weekly draw on a question that does not exist is a 404, not a 500", async () => {
    const { service } = setup([]);
    await assert.rejects(
      service.draw({ kind: "WEEKLY", questionId: "nincs" }, "u1"),
      (e: any) => e.getResponse().code === "NO_QUESTION",
    );
  });
});

describe("a question", () => {
  const base = {
    week: "2026-W45",
    type: "CHOICE",
    prompt: "Melyik?",
    options: [
      { id: "a", label: "Acropora" },
      { id: "b", label: "Montipora" },
    ],
    acceptedAnswers: ["a"],
    opensAt: "2026-11-06T06:00:00Z",
    closesAt: "2026-11-13T22:59:59Z",
  };
  const code = async (input: Record<string, unknown>) => {
    const created: unknown[] = [];
    const service = new GameAdminService();
    service.database = {
      gameQuestion: {
        create: async ({ data }: { data: unknown }) => void created.push(data),
      },
    } as never;
    return service.createQuestion({ ...base, ...input } as never).then(
      () => "ok",
      (e) => e.getResponse().code + ":" + e.getResponse().message,
    );
  };

  it("a CHOICE's right answer must be one of its options; the week has its shape; it closes after it opens", async () => {
    assert.equal(await code({}), "ok");
    assert.match(await code({ acceptedAnswers: ["z"] }), /^INVALID_QUESTION/);
    assert.match(await code({ week: "46. hét" }), /^INVALID_QUESTION/);
    assert.match(
      await code({ closesAt: "2026-11-05T00:00:00Z" }),
      /^INVALID_QUESTION/,
    );
    assert.match(
      await code({ type: "TEXT", options: [], acceptedAnswers: [] }),
      /^INVALID_QUESTION/,
    );
    assert.equal(
      await code({ type: "TEXT", options: [], acceptedAnswers: ["Acropora"] }),
      "ok",
    );
  });
});
