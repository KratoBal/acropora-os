import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameService } from "./game.service.js";

/*
  THE GIVEAWAY'S PUBLIC SIDE (card 31445d0f; contract exchange/jatek/jatek-api-szerzodes.md). What turns this red: the
  accepted answers leaving on the public question; a caller learning whether an address played already (a repeat, a
  confirmed repeat or the bot trap answered differently from a new entry); a bot-trap entry kept; a confirmed entry
  overwritten; an unconfirmed repeat not getting a new link; an answer outside the window or a choice that is not an
  option taken; a mail sent with the gate closed, or without the link; a link confirming twice, or after the close.
*/
const OPEN = new Date("2026-11-06T12:00:00Z");
const question = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  week: "2026-W45",
  type: "TEXT",
  prompt: "Melyik a legismertebb zátonyépítő korall?",
  options: [],
  acceptedAnswers: ["Acropora"],
  opensAt: new Date("2026-11-06T06:00:00Z"),
  closesAt: new Date("2026-11-13T22:59:59Z"),
  ...over,
});

function setup(
  q = question(),
  env: Record<string, string> = {
    TICKET_MAIL_MODE: "live",
    TICKET_MAIL_GAME: "live",
    TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu",
    JATEK_PUBLIC_URL: "https://jatek-teszt.acropora.hu/",
  },
) {
  const entries = new Map<string, Record<string, unknown>>();
  const mails: { to: readonly string[]; text: string }[] = [];
  const database = {
    gameQuestion: {
      findFirst: async () =>
        OPEN >= q.opensAt && OPEN < q.closesAt ? q : null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === q.id ? q : null,
    },
    gameEntry: {
      findUnique: async ({ where }: { where: Record<string, any> }) => {
        if (where.questionId_email)
          return entries.get(where.questionId_email.email) ?? null;
        const found = [...entries.values()].find(
          (e) => e.confirmTokenHash === where.confirmTokenHash,
        );
        return found ? { ...found, question: q } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        entries.set(data.email as string, {
          id: data.email,
          confirmedAt: null,
          ...data,
        });
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        Object.assign(entries.get(where.id)!, data);
      },
    },
  };
  const sender = {
    send: async (mail: { to: readonly string[]; text: string }) =>
      void mails.push(mail),
  };
  const service = new GameService(sender as never, env as never);
  service.database = database as never;
  service.now = () => OPEN;
  const linkToken = (mail: { text: string }) =>
    decodeURIComponent(/megerosites\?token=([^\s]+)/.exec(mail.text)![1]!);
  return { service, entries, mails, linkToken };
}

describe("the public question", () => {
  it("shows the open question without its accepted answers, or none", async () => {
    const { service } = setup(
      question({
        type: "CHOICE",
        options: [{ id: "a", label: "Acropora" }],
        acceptedAnswers: ["a"],
      }),
    );
    const { question: shown } = await service.current();
    assert.deepEqual(Object.keys(shown!).sort(), [
      "closesAt",
      "id",
      "opensAt",
      "options",
      "prompt",
      "type",
      "week",
    ]);
    assert.deepEqual(shown!.options, [{ id: "a", label: "Acropora" }]);
    const closed = setup(
      question({ closesAt: new Date("2026-11-06T07:00:00Z") }),
    );
    assert.deepEqual(await closed.service.current(), { question: null });
  });
});

describe("an entry", () => {
  const entry = {
    questionId: "q1",
    email: " Jatekos@Example.com ",
    answer: "acropóra",
    website: "",
  };

  it("is kept unconfirmed, marked right or wrong, and mailed a confirmation link", async () => {
    const { service, entries, mails, linkToken } = setup();
    assert.deepEqual(await service.submit(entry), { status: "CHECK_EMAIL" });
    const kept = entries.get("jatekos@example.com")!;
    assert.equal(kept.autoCorrect, true);
    assert.equal(kept.confirmedAt, null);
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0]!.to, ["jatekos@example.com"]);
    assert.match(
      mails[0]!.text,
      /https:\/\/jatek-teszt\.acropora\.hu\/megerosites\?token=/,
    );
    assert.notEqual(
      kept.confirmTokenHash,
      linkToken(mails[0]!),
      "only the token's hash is kept",
    );
  });

  it("answers a repeat, a confirmed repeat and the bot trap exactly as a new entry", async () => {
    const { service, entries, mails, linkToken } = setup();
    await service.submit(entry);
    // an unconfirmed repeat: the new answer and a new link (a lost mail can be asked again)
    assert.deepEqual(await service.submit({ ...entry, answer: "Montipora" }), {
      status: "CHECK_EMAIL",
    });
    assert.equal(entries.get("jatekos@example.com")!.autoCorrect, false);
    assert.equal(mails.length, 2);
    await service.confirm({ token: linkToken(mails[1]!) });
    // a confirmed one is left alone, and nothing says so
    assert.deepEqual(await service.submit({ ...entry, answer: "Acropora" }), {
      status: "CHECK_EMAIL",
    });
    assert.equal(entries.get("jatekos@example.com")!.answer, "Montipora");
    assert.equal(mails.length, 2);
    // the bot trap: the same answer, nothing kept, nothing mailed
    assert.deepEqual(
      await service.submit({
        ...entry,
        email: "bot@example.com",
        website: "http://spam",
      }),
      { status: "CHECK_EMAIL" },
    );
    assert.equal(entries.has("bot@example.com"), false);
    assert.equal(mails.length, 2);
  });

  it("refuses a bad address, an empty answer, a choice that is no option, and a closed week, in the contract's codes", async () => {
    const codes = async (
      service: GameService,
      input: Record<string, unknown>,
    ) =>
      service.submit(input).then(
        () => "ok",
        (e) => (e.getResponse() as { code: string }).code,
      );
    const { service } = setup();
    assert.equal(
      await codes(service, { ...entry, email: "nem-email" }),
      "INVALID_EMAIL",
    );
    assert.equal(
      await codes(service, { ...entry, answer: "  " }),
      "INVALID_ANSWER",
    );
    assert.equal(
      await codes(service, { ...entry, questionId: "nincs" }),
      "NO_QUESTION",
    );
    const choice = setup(
      question({
        type: "CHOICE",
        options: [{ id: "a", label: "A" }],
        acceptedAnswers: ["a"],
      }),
    );
    assert.equal(
      await codes(choice.service, { ...entry, answer: "z" }),
      "INVALID_ANSWER",
    );
    const closed = setup(
      question({ closesAt: new Date("2026-11-06T07:00:00Z") }),
    );
    assert.equal(await codes(closed.service, entry), "CLOSED");
  });

  it("with the mail gate closed the entry is kept and nothing is mailed", async () => {
    const { service, entries, mails } = setup(question(), {
      TICKET_MAIL_MODE: "live",
      TICKET_MAIL_GAME: "off",
      TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu",
      JATEK_PUBLIC_URL: "https://jatek-teszt.acropora.hu",
    });
    assert.deepEqual(await service.submit(entry), { status: "CHECK_EMAIL" });
    assert.equal(entries.size, 1);
    assert.equal(mails.length, 0);
  });
});

describe("the confirmation", () => {
  it("confirms once, says so the second time, and refuses an unknown link", async () => {
    const { service, entries, mails, linkToken } = setup();
    await service.submit({
      questionId: "q1",
      email: "a@x.hu",
      answer: "Acropora",
    });
    const token = linkToken(mails[0]!);
    assert.deepEqual(await service.confirm({ token }), {
      status: "CONFIRMED",
      week: "2026-W45",
    });
    assert.ok(entries.get("a@x.hu")!.confirmedAt instanceof Date);
    assert.deepEqual(await service.confirm({ token }), {
      status: "ALREADY_CONFIRMED",
      week: "2026-W45",
    });
    await assert.rejects(
      service.confirm({ token: "nincs-ilyen" }),
      (e: any) => e.getResponse().code === "INVALID_TOKEN",
    );
  });

  it("does not count a confirmation after the week closed", async () => {
    const { service, mails, linkToken } = setup();
    await service.submit({
      questionId: "q1",
      email: "a@x.hu",
      answer: "Acropora",
    });
    service.now = () => new Date("2026-11-14T00:00:00Z");
    await assert.rejects(
      service.confirm({ token: linkToken(mails[0]!) }),
      (e: any) => e.getResponse().code === "CLOSED",
    );
  });
});
