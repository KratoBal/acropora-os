import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  GAME_MAIL_MAX_PER_ENTRY,
  GameService,
  shortPublicName,
} from "./game.service.js";

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
  prizeName: null as string | null,
  prizeDescription: null as string | null,
  prizeImageId: null as string | null,
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
  more: {
    questions?: ReturnType<typeof question>[];
    draws?: Record<string, unknown>[];
    images?: Record<string, { content: Buffer; contentType: string }>;
    named?: { email: string; questionId: string; name: string }[];
  } = {},
) {
  const all = [q, ...(more.questions ?? [])];
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
      // honours the where and the order it is given: the open one (opensAt lte now, closesAt gt now) and the next one
      // (opensAt gt now, soonest first) come from the code's own query
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { opensAt: { lte?: Date; gt?: Date }; closesAt?: { gt: Date } };
        orderBy: { opensAt: "asc" | "desc" };
      }) =>
        all
          .filter(
            (x) =>
              (!where.opensAt.lte || x.opensAt <= where.opensAt.lte) &&
              (!where.opensAt.gt || x.opensAt > where.opensAt.gt) &&
              (!where.closesAt || x.closesAt > where.closesAt.gt),
          )
          .sort((a, b) =>
            orderBy.opensAt === "asc"
              ? a.opensAt.getTime() - b.opensAt.getTime()
              : b.opensAt.getTime() - a.opensAt.getTime(),
          )[0] ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        all.find((x) => x.id === where.id) ?? null,
    },
    mailImage: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        more.images?.[where.id] ?? null,
    },
    gameDraw: {
      findMany: async () => more.draws ?? [],
    },
    gameEntry: {
      findMany: async () => more.named ?? [],
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
      "prize",
      "prompt",
      "type",
      "week",
    ]);
    assert.deepEqual(shown!.options, [{ id: "a", label: "Acropora" }]);
    const closed = setup(
      question({ closesAt: new Date("2026-11-06T07:00:00Z") }),
    );
    assert.deepEqual(await closed.service.current(), {
      question: null,
      next: null,
    });
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

describe("the prize, the next question and the winners on the public page (Balázs, 2026-11-06)", () => {
  // WHAT TURNS THIS RED: the next question's prompt or options leaving before it opens; the question after the next one
  // shown ahead (its prize picture given out early); a prize picture given for a question that is not public; a
  // winner's full name or address on the public list; a winner shown by anything but "surname + initial."; a winner
  // without a name on the list; a prize with no name shown (a description or picture alone).
  const NANO = {
    prizeName: "Aquaforest AF Nano Tank",
    prizeDescription: "Egy kis akvárium.",
    prizeImageId: "img-nano",
  };
  const NEXT = question({
    id: "q2",
    week: "2026-W46",
    prompt: "A következő kérdés szövege",
    opensAt: new Date("2026-11-13T23:00:00Z"),
    closesAt: new Date("2026-11-20T22:59:59Z"),
    prizeName: "Pumpa",
    prizeImageId: "img-pumpa",
  });
  const LATER = question({
    id: "q3",
    week: "2026-W47",
    prompt: "Még későbbi kérdés",
    opensAt: new Date("2026-11-20T23:00:00Z"),
    closesAt: new Date("2026-11-27T22:59:59Z"),
    prizeName: "Titok",
    prizeImageId: "img-titok",
  });
  const images = {
    "img-nano": { content: Buffer.from("nano"), contentType: "image/png" },
    "img-pumpa": { content: Buffer.from("pumpa"), contentType: "image/png" },
    "img-titok": { content: Buffer.from("titok"), contentType: "image/png" },
  };

  it("the open question carries its prize (name, description, whether it has a picture), and the next one is seen ahead without its prompt", async () => {
    const { service } = setup(question(NANO), undefined, {
      questions: [NEXT, LATER],
    });
    const { question: open, next } = await service.current();
    assert.deepEqual(open!.prize, {
      name: "Aquaforest AF Nano Tank",
      description: "Egy kis akvárium.",
      hasImage: true,
    });
    assert.deepEqual(next, {
      id: "q2",
      week: "2026-W46",
      opensAt: "2026-11-13T23:00:00.000Z",
      prize: { name: "Pumpa", description: null, hasImage: true },
    });
    assert.equal(
      JSON.stringify(next).includes("következő kérdés szövege"),
      false,
    );
  });

  it("with nothing open, the next question comes with the time it opens; without a prize name there is no prize", async () => {
    const closed = question({ closesAt: new Date("2026-11-06T07:00:00Z") });
    const { service } = setup(closed, undefined, {
      questions: [{ ...NEXT, prizeName: null }],
    });
    const result = await service.current();
    assert.equal(result.question, null);
    assert.equal(result.next!.prize, null);
    assert.equal(result.next!.opensAt, "2026-11-13T23:00:00.000Z");
  });

  it("gives a prize picture for an opened question and for the very next one, not for a later one, not for a nameless question", async () => {
    const { service } = setup(question(NANO), undefined, {
      questions: [NEXT, LATER],
      images,
    });
    assert.equal((await service.prizeImage("q1"))?.bytes.toString(), "nano");
    assert.equal((await service.prizeImage("q2"))?.bytes.toString(), "pumpa");
    assert.equal(await service.prizeImage("q3"), null);
    assert.equal(await service.prizeImage("nincs"), null);
    const noImage = setup(question(), undefined, { images });
    assert.equal(await noImage.service.prizeImage("q1"), null);
  });

  it("lists the winners by the shortened name only, newest as given, skipping a winner without a name", async () => {
    const { service } = setup(question(NANO), undefined, {
      draws: [
        {
          kind: "WEEKLY",
          questionId: "q1",
          winnerEmail: "kovacs@x.hu",
          createdAt: new Date("2026-11-14T20:00:00Z"),
          question: { week: "2026-W45", prizeName: "Aquaforest AF Nano Tank" },
        },
        {
          kind: "WEEKLY",
          questionId: "q1",
          winnerEmail: "nev-nelkul@x.hu",
          createdAt: new Date("2026-11-14T19:00:00Z"),
          question: { week: "2026-W45", prizeName: null },
        },
        {
          kind: "CHRISTMAS",
          questionId: null,
          winnerEmail: "nagy@x.hu",
          createdAt: new Date("2026-12-23T20:00:00Z"),
          question: null,
        },
      ],
      named: [
        { email: "kovacs@x.hu", questionId: "q1", name: "Kovács Péter" },
        { email: "nagy@x.hu", questionId: "q0", name: "nagy  anna Mária" },
      ],
    });
    const { winners } = await service.winners();
    assert.deepEqual(
      winners.map((w) => [w.kind, w.week, w.name, w.prizeName]),
      [
        ["WEEKLY", "2026-W45", "Kovács P.", "Aquaforest AF Nano Tank"],
        ["CHRISTMAS", null, "nagy A.", null],
      ],
    );
    const text = JSON.stringify(winners);
    for (const secret of ["@", "Péter", "Mária"])
      assert.equal(text.includes(secret), false, secret);
  });

  it("shortens a name to the first word and the first name's initial", () => {
    assert.equal(shortPublicName("Kovács Péter"), "Kovács P.");
    assert.equal(shortPublicName("  Nagy   Anna Mária "), "Nagy A.");
    assert.equal(shortPublicName("Kovács éva"), "Kovács É.");
    assert.equal(shortPublicName("Éva"), "Éva");
    assert.equal(shortPublicName(""), "");
  });
});
