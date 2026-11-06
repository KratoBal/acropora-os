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

/** The moment the tests run at, and the default: every question has closed already. */
const NOW = new Date("2026-11-20T12:00:00Z");
const CLOSED = new Date("2026-11-14T20:00:00Z");

function setup(
  entries: ReturnType<typeof entry>[],
  over: { closesAt?: Date; lastCloses?: Date } = {},
) {
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
        where.id === "nincs"
          ? null
          : { id: where.id, closesAt: over.closesAt ?? CLOSED },
      // "a question that closes after `gt`": the latest closing among the questions decides, as the code's own where asks
      findFirst: async ({ where }: { where: { closesAt: { gt: Date } } }) =>
        (over.lastCloses ?? CLOSED) > where.closesAt.gt
          ? { id: "utolso" }
          : null,
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
  const service = new GameAdminService({ now: () => NOW } as never);
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

  // WHAT TURNS THIS RED: a weekly draw run while the week can still take answers (the first draw is final on the public list,
  // so a trial or accidental draw would close the week for good, with a wrong or no winner); a Christmas draw before the last
  // question has closed; a draw at or after the closing refused.
  it("a weekly draw is refused until the question has closed, and nothing is written; at the closing moment and after it, it runs", async () => {
    const open = setup([entry("a@x.hu", "w45")], {
      closesAt: new Date("2026-11-21T20:00:00Z"),
    });
    await assert.rejects(
      open.service.draw({ kind: "WEEKLY", questionId: "w45" }, "u1"),
      (e: any) => e.getResponse().code === "DRAW_TOO_EARLY",
    );
    assert.equal(open.draws.length, 0);
    assert.equal(open.audits.length, 0);
    const exactly = setup([entry("a@x.hu", "w45")], { closesAt: NOW });
    await exactly.service.draw({ kind: "WEEKLY", questionId: "w45" }, "u1");
    assert.equal(exactly.draws.length, 1);
  });

  it("the Christmas draw is refused while any question is still open, and runs once the last one has closed", async () => {
    const open = setup([entry("a@x.hu", "w45")], {
      lastCloses: new Date("2026-11-27T20:00:00Z"),
    });
    await assert.rejects(
      open.service.draw({ kind: "CHRISTMAS" }, "u1"),
      (e: any) => e.getResponse().code === "DRAW_TOO_EARLY",
    );
    assert.equal(open.draws.length, 0);
    const done = setup([entry("a@x.hu", "w45")], { lastCloses: NOW });
    await done.service.draw({ kind: "CHRISTMAS" }, "u1");
    assert.equal(done.draws.length, 1);
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
    const service = new GameAdminService({ now: () => NOW } as never);
    service.database = {
      gameQuestion: {
        findUnique: async () => ({
          closesAt: new Date("2026-11-13T22:59:59Z"),
        }),
      },
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

  // WHAT TURNS THIS RED (barracuda, #2283): a question that has closed (its correct answer public, its week drawable) given a
  // closing in the future again; or an edit of a closed question that keeps its closing in the past refused (a typo in the
  // question or the prize must stay fixable); or an open question's closing no longer movable.
  it("a closed question cannot be given a closing in the future (409, nothing written); its other fields, an open question's closing, and a closing still in the past stay editable", async () => {
    const updated: unknown[] = [];
    const tx = {
      gameQuestion: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updated.push(data);
          return { id: "q1", ...data };
        },
      },
      gameEntry: { findMany: async () => [], update: async () => undefined },
    };
    const make = (storedCloses: string) => {
      const service = new GameAdminService({ now: () => NOW } as never);
      service.database = {
        gameQuestion: {
          findUnique: async () => ({ closesAt: new Date(storedCloses) }),
        },
        $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      } as never;
      return service;
    };
    const input = (closesAt: string) => ({
      week: "2026-W45",
      type: "TEXT",
      prompt: "Melyik?",
      options: [],
      acceptedAnswers: ["Acropora"],
      opensAt: "2026-11-06T06:00:00Z",
      closesAt,
    });
    // closed at 2026-11-13, now is 2026-11-20: a closing on 2026-11-27 reopens it
    await assert.rejects(
      make("2026-11-13T22:59:59Z").updateQuestion(
        "q1",
        input("2026-11-27T22:59:59Z"),
      ),
      (e: any) => e.getResponse().code === "QUESTION_CLOSED",
    );
    assert.equal(updated.length, 0);
    // the same closed question, closing kept in the past: allowed
    await make("2026-11-13T22:59:59Z").updateQuestion(
      "q1",
      input("2026-11-13T22:59:59Z"),
    );
    // an open question (closes 2026-11-27): its closing can move
    await make("2026-11-27T22:59:59Z").updateQuestion(
      "q1",
      input("2026-11-30T22:59:59Z"),
    );
    assert.equal(updated.length, 2);
  });

  it("a weekly draw on a question that does not exist is a 404, not a 500", async () => {
    const { service } = setup([]);
    await assert.rejects(
      service.draw({ kind: "WEEKLY", questionId: "nincs" }, "u1"),
      (e: any) => e.getResponse().code === "NO_QUESTION",
    );
  });
});

describe("the mail queue (acrobot 43965)", () => {
  // WHAT TURNS THIS RED: a waiting mail sent with its old link, sent past today's cap, or the send not audited
  it("sends the waiting mails oldest first with a new link, and stops where the cap queues again", async () => {
    const waiting = ["a@x.hu", "b@x.hu", "c@x.hu"].map((email) => ({
      id: email,
      email,
      question: { week: "2026-W45" },
      confirmTokenHash: "regi",
    }));
    const delivered: string[] = [];
    const audits: unknown[] = [];
    const writes: Record<string, unknown>[] = [];
    const game = {
      deliver: async (
        _id: string,
        email: string,
        _token: string,
        _week: string,
        countOnSend: boolean,
      ) => {
        // the queue's send counts the attempt only once it went out (barracuda, #2254 v3)
        assert.equal(countOnSend, true);
        if (delivered.length === 2) return "NOT_SENT";
        delivered.push(email);
        return "SENT";
      },
      sentToday: async () => 3000,
      dailyCap: () => 3000,
      mailStatus: () => ({ blocked: null, lastError: null }),
      testLinksOn: () => false,
    };
    const service = new GameAdminService(game as never);
    service.database = {
      gameEntry: {
        findMany: async () => waiting,
        count: async () => 1,
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, any>;
        }) => {
          writes.push(data);
          Object.assign(
            waiting.find((w) => w.id === where.id)!,
            { confirmTokenHash: data.confirmTokenHash },
          );
        },
      },
      auditLog: {
        create: async ({ data }: { data: unknown }) => void audits.push(data),
      },
    } as never;
    const result = await service.sendQueued("u1");
    assert.deepEqual(delivered, ["a@x.hu", "b@x.hu"]);
    assert.equal(result.sent, 2);
    assert.ok(waiting.slice(0, 2).every((w) => w.confirmTokenHash !== "regi"));
    assert.equal(audits.length, 1);
    // only the new link is written before the send; the count comes with a sent mail (in deliver)
    assert.ok(
      writes.every((w) => Object.keys(w).join() === "confirmTokenHash"),
    );
  });
});

describe("the stage test link (acrobot 44026)", () => {
  // WHAT TURNS THIS RED: a link handed out without the stage switch, for a confirmed entry, or without a new token
  // and an audit row
  const setupLink = (on: boolean, entry: Record<string, unknown> | null) => {
    const writes: Record<string, unknown>[] = [];
    const audits: unknown[] = [];
    const game = {
      testLinksOn: () => on,
      publicUrlSet: () => true,
      confirmLink: (token: string) =>
        `https://jatek-teszt.acropora.hu/megerosites?token=${token}`,
    };
    const service = new GameAdminService(game as never);
    service.database = {
      gameEntry: {
        findUnique: async () => entry,
        update: async ({ data }: { data: Record<string, unknown> }) =>
          void writes.push(data),
      },
      auditLog: {
        create: async ({ data }: { data: unknown }) => void audits.push(data),
      },
    } as never;
    return { service, writes, audits };
  };
  const open = {
    id: "e1",
    confirmedAt: null,
    question: { closesAt: new Date("2099-01-01") },
  };

  it("gives a new link, audited, only with the stage switch on and only for an unconfirmed entry of an open week", async () => {
    const off = setupLink(false, open);
    await assert.rejects(
      off.service.testLink("e1", "u1"),
      (e: any) => e.getResponse().code === "TEST_LINKS_OFF",
    );
    assert.equal(off.writes.length, 0);

    const confirmed = setupLink(true, { ...open, confirmedAt: new Date() });
    await assert.rejects(
      confirmed.service.testLink("e1", "u1"),
      (e: any) => e.getResponse().code === "NOT_LINKABLE",
    );

    const noUrl = setupLink(true, open);
    (noUrl.service as any).game.publicUrlSet = () => false;
    await assert.rejects(
      noUrl.service.testLink("e1", "u1"),
      (e: any) => e.getResponse().code === "NO_PUBLIC_URL",
    );
    assert.equal(noUrl.writes.length, 0);

    const on = setupLink(true, open);
    const { link } = await on.service.testLink("e1", "u1");
    const token = decodeURIComponent(/token=(.+)$/.exec(link)![1]!);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(
      on.writes[0]!.confirmTokenHash,
      token,
      "only the hash is kept",
    );
    assert.equal(on.audits.length, 1);
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
    const service = new GameAdminService(null as never);
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

describe("the week's prize and the players' names (card 31445d0f, Balázs 2026-11-06)", () => {
  // WHAT TURNS THIS RED: a prize description or picture saved without a name; a picture id that is not in the image store
  // saved (a database error at the foreign key instead of a sentence); a blank prize field kept as an empty text instead
  // of cleared; an absent prize key on an edit clearing the stored prize; the entries list or the draws list without the
  // name next to the address; a draw's kept candidates changed to carry the names (the seed would no longer replay).
  const QUESTION = {
    week: "2026-W46",
    type: "TEXT",
    prompt: "Mi a kérdés?",
    options: [],
    acceptedAnswers: ["acropora"],
    opensAt: "2026-11-07T20:00:00.000Z",
    closesAt: "2026-11-14T20:00:00.000Z",
  };

  function prizeSetup(images: string[] = ["img1"]) {
    const created: Record<string, unknown>[] = [];
    const entryQueries: Record<string, any>[] = [];
    const database = {
      gameQuestion: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "q1", ...data };
        },
      },
      mailImage: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          images.includes(where.id) ? { id: where.id } : null,
      },
      gameEntry: {
        findMany: async (query: Record<string, any>) => {
          entryQueries.push(query);
          return [
            { email: "a@x.hu", name: "Kovács Péter" },
            { email: "a@x.hu", name: "Kovács Péter Pál" },
            { email: "b@x.hu", name: "Nagy Anna" },
          ];
        },
      },
      gameDraw: {
        findMany: async () => [
          {
            id: "d1",
            winnerEmail: "a@x.hu",
            candidates: [
              { email: "a@x.hu", weight: 1 },
              { email: "b@x.hu", weight: 1 },
            ],
            question: { week: "2026-W46" },
          },
        ],
      },
    };
    const service = new GameAdminService(null as never);
    service.database = database as never;
    return { service, created, entryQueries };
  }
  const code = (error: any) => error.getResponse().code;

  it("keeps the prize trimmed; a blank field is cleared, an absent key is left out of the write", async () => {
    const { service, created } = prizeSetup();
    await service.createQuestion({
      ...QUESTION,
      prizeName: "  Aquaforest Nano  ",
      prizeDescription: "   ",
      prizeImageId: "img1",
    });
    assert.equal(created[0]!.prizeName, "Aquaforest Nano");
    assert.equal(created[0]!.prizeDescription, null);
    assert.equal(created[0]!.prizeImageId, "img1");
    await service.createQuestion({ ...QUESTION, week: "2026-W47" });
    for (const key of ["prizeName", "prizeDescription", "prizeImageId"])
      assert.equal(key in created[1]!, false, key);
  });

  it("refuses a description or a picture without a name, and a picture that is not in the store", async () => {
    const { service, created } = prizeSetup();
    await assert.rejects(
      service.createQuestion({ ...QUESTION, prizeDescription: "csak leírás" }),
      (e: any) => code(e) === "INVALID_QUESTION",
    );
    await assert.rejects(
      service.createQuestion({ ...QUESTION, prizeImageId: "img1" }),
      (e: any) => code(e) === "INVALID_QUESTION",
    );
    await assert.rejects(
      service.createQuestion({
        ...QUESTION,
        prizeName: "Nano",
        prizeImageId: "nincs-ilyen",
      }),
      (e: any) => code(e) === "INVALID_QUESTION",
    );
    assert.equal(created.length, 0);
  });

  it("the draws list carries a name per address (the latest entry with one) and leaves the kept candidates alone", async () => {
    const { service, entryQueries } = prizeSetup();
    const [draw] = await service.draws();
    assert.deepEqual(draw!.names, {
      "a@x.hu": "Kovács Péter Pál",
      "b@x.hu": "Nagy Anna",
    });
    assert.deepEqual(draw!.candidates, [
      { email: "a@x.hu", weight: 1 },
      { email: "b@x.hu", weight: 1 },
    ]);
    assert.deepEqual(entryQueries[0]!.where.email.in.sort(), [
      "a@x.hu",
      "b@x.hu",
    ]);
  });
});
