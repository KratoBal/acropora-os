import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { GAME_MAIL_MAX_PER_ENTRY, GameService } from "./game.service.js";

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
  const mails: { to: readonly string[]; text: string; html?: string }[] = [];
  const days = new Map<string, number>();
  const database = {
    gameMailDay: {
      upsert: async ({ where }: { where: { day: string } }) => {
        days.set(where.day, (days.get(where.day) ?? 0) + 1);
        return { day: where.day, sent: days.get(where.day)! };
      },
      // what the data asks, not a fixed step: the amount under test must come from the code
      update: async ({
        where,
        data,
      }: {
        where: { day: string };
        data: { sent: { decrement: number } };
      }) => {
        days.set(where.day, (days.get(where.day) ?? 0) - data.sent.decrement);
      },
      findUnique: async ({ where }: { where: { day: string } }) =>
        days.has(where.day)
          ? { day: where.day, sent: days.get(where.day)! }
          : null,
    },
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
        if (where.id) {
          const own = entries.get(where.id);
          return own ? { ...own, question: q } : null;
        }
        const found = [...entries.values()].find(
          (e) => e.confirmTokenHash === where.confirmTokenHash,
        );
        return found ? { ...found, question: q } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (entries.has(data.email as string)) {
          const error = Object.assign(
            new Prisma.PrismaClientKnownRequestError("unique", {
              code: "P2002",
              clientVersion: "test",
            }),
          );
          throw error;
        }
        entries.set(data.email as string, {
          id: data.email,
          confirmedAt: null,
          mailPendingSince: null,
          ...data,
        });
        return { id: data.email };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; confirmedAt?: null };
        data: Record<string, any>;
      }) => {
        const row = entries.get(where.id);
        // only what the where asks: the condition under test must come from the code, not from this double
        if (!row) return { count: 0 };
        if ("confirmedAt" in where && row.confirmedAt !== where.confirmedAt)
          return { count: 0 };
        const { mailCount, ...rest } = data;
        Object.assign(row, rest, {
          mailCount: (row.mailCount as number) + (mailCount?.increment ?? 0),
        });
        return { count: 1 };
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
    send: async (mail: {
      to: readonly string[];
      text: string;
      html?: string;
    }) => void mails.push(mail),
  };
  const service = new GameService(sender as never, env as never);
  service.database = database as never;
  service.now = () => OPEN;
  const linkToken = (mail: { text: string }) =>
    decodeURIComponent(/megerosites\?token=([^\s]+)/.exec(mail.text)![1]!);
  return { service, entries, mails, linkToken, days, sender };
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
    name: "  Kovács   Péter ",
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

  it("keeps the name trimmed with its inner spaces collapsed, and an unconfirmed repeat takes the newer name", async () => {
    const { service, entries } = setup();
    await service.submit(entry);
    assert.equal(entries.get("jatekos@example.com")!.name, "Kovács Péter");
    // after the mail pause, as a repeat is allowed to take the new values
    service.now = () => new Date(OPEN.getTime() + 3 * 60_000);
    await service.submit({ ...entry, name: "Kovács Péter Pál" });
    assert.equal(entries.get("jatekos@example.com")!.name, "Kovács Péter Pál");
  });

  it("mails the formatted confirmation: the question, the button with the link and the closing time, and a plain-text twin", async () => {
    const { service, mails } = setup();
    await service.submit(entry);
    const mail = mails[0]!;
    assert.ok(mail.html, "an HTML body goes with the text");
    assert.match(
      mail.html!,
      /<strong>Melyik a legismertebb zátonyépítő korall\?<\/strong>/,
    );
    assert.match(
      mail.html!,
      /data-cta=""><a href="https:\/\/jatek-teszt\.acropora\.hu\/megerosites\?token=/,
    );
    assert.match(mail.html!, /23:59<\/strong> \(budapesti idő\)/);
    assert.match(
      mail.text,
      /https:\/\/jatek-teszt\.acropora\.hu\/megerosites\?token=/,
    );
  });

  it("never quotes a free-text answer: not the right one, not a link, not a bare domain, not a phone number", async () => {
    for (const valasz of [
      "acropóra",
      "http://rossz.example/megerosit",
      "nyeremeny-acropora.hu/atvetel",
      "Nyertél! Hívd: 06 30 123 4567",
      "Zoanthus sp.",
    ]) {
      const { service, mails } = setup();
      await service.submit({ ...entry, answer: valasz });
      assert.equal(mails.length, 1, valasz);
      const mail = mails[0]!;
      assert.doesNotMatch(mail.html!, /A beküldött válaszod/, valasz);
      assert.ok(!mail.html!.includes(valasz), valasz);
      assert.ok(!mail.text.includes(valasz), valasz);
      assert.match(mail.html!, /megerosites\?token=/);
    }
  });

  it("shows a choice answer by its label (our own text), not by its id", async () => {
    const { service, mails } = setup(
      question({
        type: "CHOICE",
        options: [
          { id: "a", label: "Acropora" },
          { id: "b", label: "Montipora" },
        ],
        acceptedAnswers: ["a"],
      }),
    );
    await service.submit({ ...entry, answer: "b" });
    assert.match(
      mails[0]!.html!,
      /A beküldött válaszod: <strong>Montipora<\/strong>/,
    );
    assert.doesNotMatch(mails[0]!.html!, /<strong>b<\/strong>/);
  });

  it("answers a repeat, a confirmed repeat and the bot trap exactly as a new entry", async () => {
    const { service, entries, mails, linkToken } = setup();
    await service.submit(entry);
    // an unconfirmed repeat after the pause: the new answer and a new link (a lost mail can be asked again)
    service.now = () => new Date(OPEN.getTime() + 3 * 60_000);
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

  // barracuda, #2254: WHAT TURNS THIS RED: one address flooded with mail through our own sender (the pace and the cap
  // hold whatever the caller's address claims); a confirmation in between overwritten; two first entries at once a 500
  it("three quick entries to one address send exactly one mail; past the cap, none", async () => {
    const { service, mails } = setup();
    for (let i = 0; i < 3; i++)
      await service.submit({ ...entry, answer: `valasz-${i}` });
    assert.equal(mails.length, 1);
    let at = OPEN.getTime();
    for (let i = 0; i < 10; i++) {
      at += 3 * 60_000;
      service.now = () => new Date(at);
      await service.submit(entry);
    }
    assert.equal(mails.length, GAME_MAIL_MAX_PER_ENTRY);
  });

  it("a confirmation between the read and the write keeps its answer, and a second first entry at once answers the same", async () => {
    const { service, entries, mails, linkToken } = setup();
    await service.submit(entry);
    service.now = () => new Date(OPEN.getTime() + 3 * 60_000);
    // the read sees it unconfirmed; the confirmation lands before the write
    const realFind = (service.database as any).gameEntry.findUnique;
    (service.database as any).gameEntry.findUnique = async (args: any) => {
      const row = await realFind(args);
      if (args.where.questionId_email) {
        const snapshot = row ? { ...row } : row;
        await service.confirm({ token: linkToken(mails[0]!) });
        return snapshot;
      }
      return row;
    };
    assert.deepEqual(await service.submit({ ...entry, answer: "Montipora" }), {
      status: "CHECK_EMAIL",
    });
    assert.equal(entries.get("jatekos@example.com")!.answer, "acropóra");
    assert.equal(mails.length, 1);

    const race = setup();
    (race.service.database as any).gameEntry.findUnique = async () => null;
    await race.service.submit(entry);
    assert.deepEqual(await race.service.submit(entry), {
      status: "CHECK_EMAIL",
    });
    assert.equal(race.mails.length, 1);
  });

  // acrobot 43965: WHAT TURNS THIS RED: mail past the daily cap going out anyway, or the entry past it lost
  it("past the daily cap the entry is kept, its mail waits, and the caller hears the same", async () => {
    const { service, entries, mails } = setup(question(), {
      TICKET_MAIL_MODE: "live",
      TICKET_MAIL_GAME: "live",
      TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu",
      JATEK_PUBLIC_URL: "https://jatek-teszt.acropora.hu",
      JATEK_MAIL_DAILY_CAP: "2",
    });
    for (const email of ["a@x.hu", "b@x.hu", "c@x.hu"])
      assert.deepEqual(await service.submit({ ...entry, email }), {
        status: "CHECK_EMAIL",
      });
    assert.equal(mails.length, 2);
    assert.equal(entries.size, 3);
    assert.ok(entries.get("c@x.hu")!.mailPendingSince instanceof Date);
    assert.equal(entries.get("a@x.hu")!.mailPendingSince, null);
  });

  // barracuda, #2258: WHAT TURNS THIS RED: a test link possible where mail is not redirected (production), even with
  // the switch left on
  it("the test link needs the switch AND redirected mail", () => {
    const env = (over: Record<string, string>) =>
      setup(question(), {
        TICKET_MAIL_MODE: "live",
        TICKET_MAIL_GAME: "live",
        JATEK_PUBLIC_URL: "https://jatek-teszt.acropora.hu",
        ...over,
      }).service.testLinksOn();
    assert.equal(
      env({
        JATEK_TEST_LINKS: "on",
        TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu",
      }),
      true,
    );
    assert.equal(
      env({ JATEK_TEST_LINKS: "on", TICKET_MAIL_REDIRECT_TO: "off" }),
      false,
    );
    assert.equal(env({ JATEK_TEST_LINKS: "on" }), false);
    assert.equal(
      env({
        JATEK_TEST_LINKS: "off",
        TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu",
      }),
      false,
    );
  });

  // barracuda, #2254 v3: WHAT TURNS THIS RED: a mail that cannot go out spending the day's cap, or not waiting in the
  // queue; a failed send keeping its slot
  it("a closed gate queues the mail and spends nothing of the cap; a failed send gives its slot back", async () => {
    const closed = setup(question(), {
      TICKET_MAIL_MODE: "live",
      TICKET_MAIL_GAME: "off",
      TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu",
      JATEK_PUBLIC_URL: "https://jatek-teszt.acropora.hu",
    });
    await closed.service.submit(entry);
    assert.ok(
      closed.entries.get("jatekos@example.com")!.mailPendingSince instanceof
        Date,
    );
    // no slot was taken at all (a taken and given-back slot would sum to 0 as well)
    assert.equal(closed.days.size, 0);

    const failing = setup();
    failing.sender.send = async () => {
      throw new Error("SMTP_DOWN");
    };
    await failing.service.submit(entry);
    // the admin sees why, without the log (acrobot 44026)
    assert.equal(
      failing.service.mailStatus().lastError?.reason,
      "Error: SMTP_DOWN",
    );
    assert.equal(closed.service.mailStatus().blocked, "path-off");
    assert.ok(
      failing.entries.get("jatekos@example.com")!.mailPendingSince instanceof
        Date,
    );
    assert.equal(
      [...failing.days.values()].reduce((a, b) => a + b, 0),
      0,
    );
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
    // the name is required on a new entry: absent, one character, no letter in it, or not a text
    for (const name of [undefined, "", "  ", "K", "1234", "--", 42])
      assert.equal(
        await codes(service, { ...entry, name }),
        "INVALID_NAME",
        String(name),
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
      name: "Kovács Péter",
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
      name: "Kovács Péter",
      answer: "Acropora",
    });
    service.now = () => new Date("2026-11-14T00:00:00Z");
    await assert.rejects(
      service.confirm({ token: linkToken(mails[0]!) }),
      (e: any) => e.getResponse().code === "CLOSED",
    );
  });
});
