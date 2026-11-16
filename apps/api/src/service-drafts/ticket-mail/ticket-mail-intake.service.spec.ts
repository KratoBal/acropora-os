import "reflect-metadata";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import type { TicketMailMessage } from "./ticket-mail-gmail.client.js";
import { TicketMailGmailError } from "./ticket-mail-gmail.client.js";
import { TicketMailIntakeService } from "./ticket-mail-intake.service.js";
import type { ResolvedSender } from "./ticket-mail-intake.js";

/**
 * THE TICKET@ INTAKE RUN (card ec7b947b, S2b), with a fake mailbox and a fake store (the real store is the integration spec's).
 *
 * WHAT TURNS RED: a forged sender (a known colleague's From with a failing or missing verdict) reaching the user lookup or getting the
 * colleague's name or the AI branch; a machine's mail becoming a draft or being read again; the per-run limit exceeded or the order not oldest
 * first; one broken message blocking the rest; a failure's text (which could hold a token) kept instead of a fixed code; two runs at once; a
 * run while the switch is off; the status shown to a non-admin.
 */
const saved = { ...process.env };
beforeEach(() => {
  process.env.GMAIL_TICKET_INTAKE_ENABLED = "true";
  process.env.GMAIL_TICKET_READ_CLIENT_ID = "client";
  process.env.GMAIL_TICKET_READ_CLIENT_SECRET = "secret";
  process.env.GMAIL_TICKET_READ_REFRESH_TOKEN = "refresh";
});
afterEach(() => {
  process.env = { ...saved };
});

const PASS = (domain: string) =>
  `mx.google.com; dmarc=pass (p=REJECT) header.from=${domain}`;
const FAIL = (domain: string) =>
  `mx.google.com; dmarc=fail (p=REJECT) header.from=${domain}`;

function mail(
  id: string,
  overrides: Partial<TicketMailMessage> = {},
): TicketMailMessage {
  return {
    id,
    threadId: null,
    receivedAt: new Date("2026-11-16T12:00:00.000Z"),
    subject: `Hiba ${id}`,
    from: "Kovács Anna <anna@acropora.hu>",
    fromAddress: "anna@acropora.hu",
    fromDisplayName: "Kovács Anna",
    headers: {
      autoSubmitted: null,
      precedence: null,
      listId: null,
      authenticationResults: [PASS("acropora.hu")],
    },
    text: "A szűrő csöpög.",
    attachments: [],
    droppedAttachments: [],
    ...overrides,
  };
}

interface Recorded {
  message: TicketMailMessage;
  authVerdict: string;
  outcome: { kind: string; [key: string]: unknown };
}

/** The persistent side of the fake store (the database's rows): what a restarted service still sees. */
function newStoreState() {
  return {
    attempts: new Map<string, number>(),
    sealed: [] as string[],
    seen: new Set<string>(),
  };
}

function rig(options: {
  ids: string[];
  messages: Record<string, TicketMailMessage | Error>;
  seen?: string[];
  senders?: Record<string, ResolvedSender | null>;
  recent?: number;
  recipients?: Array<{ id: string }>;
  pushFails?: boolean;
  recentTotal?: number;
  /** every name the redaction knows (the users' names) */
  names?: string[];
  /** reading the users' names fails (the redaction then has no known names) */
  namesFail?: boolean;
  /** the AI client's answer for one call; absent: no AI client at all */
  ai?: (input: { subject: string; text: string }) => Promise<unknown>;
  /** a store that survives a service restart: pass the one a first rig made */
  shared?: ReturnType<typeof newStoreState>;
}) {
  const recorded: Recorded[] = [];
  const lookups: string[] = [];
  const fetched: string[] = [];
  const roles: string[] = [];
  const pushes: Array<{
    mailId: string;
    userIds: readonly string[];
    count: number;
  }> = [];
  const state = options.shared ?? newStoreState();
  for (const id of options.seen ?? []) state.seen.add(id);
  const store = {
    hasMessage: async (_m: string, id: string) =>
      state.seen.has(id) ? { id } : null,
    resolveSender: async (address: string) => {
      lookups.push(address);
      return options.senders?.[address] ?? null;
    },
    unknownCountSince: async () => options.recent ?? 0,
    unknownTotalSince: async () => options.recentTotal ?? 0,
    personNames: async () => {
      if (options.namesFail) throw new Error("db down SECRET");
      return options.names ?? [];
    },
    noteFailure: async (_m: string, id: string) => {
      const attempts = (state.attempts.get(id) ?? 0) + 1;
      state.attempts.set(id, attempts);
      return attempts;
    },
    sealFailed: async (_m: string, id: string) => {
      state.sealed.push(id);
      state.seen.add(id);
      state.attempts.delete(id);
    },
    record: async (input: Recorded) => {
      recorded.push(input);
      return {
        recorded: true,
        drafts: input.outcome.kind === "DRAFT" ? 1 : 0,
        mailId: `mail-${input.message.id}`,
      };
    },
  };
  const gmail = {
    listMessageIds: async () => options.ids,
    getMessage: async (id: string) => {
      fetched.push(id);
      const entry = options.messages[id]!;
      if (entry instanceof Error) throw entry;
      return entry;
    },
  };
  const notifications = {
    deliverTicketMailDraftsArrived: async (notice: (typeof pushes)[number]) => {
      if (options.pushFails) throw new Error("push token SECRET");
      pushes.push(notice);
    },
  };
  const jobs = {
    notificationRoleRecipients: async (role: string) => {
      roles.push(role);
      return options.recipients ?? [{ id: "manager-1" }];
    },
  };
  const aiCalls: Array<{ subject: string; text: string }> = [];
  const ai = options.ai
    ? {
        draft: async (input: { subject: string; text: string }) => {
          aiCalls.push(input);
          return options.ai!(input);
        },
      }
    : null;
  const service = new TicketMailIntakeService(
    store as never,
    gmail as never,
    notifications as never,
    jobs as never,
    ai as never,
  );
  return { service, recorded, lookups, fetched, pushes, roles, state, aiCalls };
}

const colleague = (
  overrides: Partial<ResolvedSender> = {},
): ResolvedSender => ({
  userId: "user-1",
  displayName: "Kovács Anna",
  watching: true,
  departmentIds: ["dep-1"],
  ...overrides,
});
const admin = {
  role: "ADMIN",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

describe("TicketMailIntakeService.run", () => {
  it("does nothing while the switch is off", async () => {
    process.env.GMAIL_TICKET_INTAKE_ENABLED = "false";
    const { service, fetched } = rig({
      ids: ["a"],
      messages: { a: mail("a") },
    });
    const summary = await service.run();
    assert.equal(summary.disabled, true);
    assert.equal(fetched.length, 0);
  });

  it("a verified switched-on colleague: the AI branch with their user, name and one place", async () => {
    const { service, recorded } = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
    });
    const summary = await service.run();
    assert.equal(summary.drafts, 1);
    assert.deepEqual(recorded[0]!.outcome, {
      kind: "DRAFT",
      intakeState: "AI_UNAVAILABLE",
      senderUserId: "user-1",
      reporterPersonName: "Kovács Anna",
      proposedDepartmentId: "dep-1",
    });
    assert.equal(recorded[0]!.authVerdict, "DMARC_PASS");
  });

  it("a switched-off colleague: WATCH_OFF without a place", async () => {
    const { service, recorded } = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague({ watching: false }) },
    });
    await service.run();
    assert.equal(recorded[0]!.outcome.intakeState, "WATCH_OFF");
    assert.equal(recorded[0]!.outcome.proposedDepartmentId, null);
  });

  it("CONTROL (forged sender): the From of a switched-on colleague with a FAILING header is an unknown sender and the user is never looked up", async () => {
    const forged = mail("f", {
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [FAIL("acropora.hu")],
      },
    });
    const { service, recorded, lookups } = rig({
      ids: ["f"],
      messages: { f: forged },
      senders: { "anna@acropora.hu": colleague() },
    });
    await service.run();
    assert.deepEqual(lookups, []);
    assert.deepEqual(recorded[0]!.outcome, {
      kind: "DRAFT",
      intakeState: "UNKNOWN_SENDER",
      senderUserId: null,
      reporterPersonName: null,
      proposedDepartmentId: null,
    });
    assert.equal(recorded[0]!.authVerdict, "DMARC_NOT_PASS");
  });

  it("CONTROL (forged sender): a passing header the sender put BELOW a failing one does not rescue it", async () => {
    const forged = mail("f", {
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [FAIL("acropora.hu"), PASS("acropora.hu")],
      },
    });
    const { service, recorded, lookups } = rig({
      ids: ["f"],
      messages: { f: forged },
      senders: { "anna@acropora.hu": colleague() },
    });
    await service.run();
    assert.deepEqual(lookups, []);
    assert.equal(recorded[0]!.outcome.intakeState, "UNKNOWN_SENDER");
  });

  it("CONTROL (forged sender): a missing verdict header is an unknown sender", async () => {
    const bare = mail("f", {
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [],
      },
    });
    const { service, recorded } = rig({
      ids: ["f"],
      messages: { f: bare },
      senders: { "anna@acropora.hu": colleague() },
    });
    await service.run();
    assert.equal(recorded[0]!.outcome.intakeState, "UNKNOWN_SENDER");
    assert.equal(recorded[0]!.authVerdict, "NO_HEADER");
  });

  it("CONTROL: a machine's mail is recorded as skipped, never a draft, and no user is looked up", async () => {
    const auto = mail("m", {
      headers: {
        autoSubmitted: "auto-replied",
        precedence: null,
        listId: null,
        authenticationResults: [PASS("acropora.hu")],
      },
    });
    const { service, recorded, lookups } = rig({
      ids: ["m"],
      messages: { m: auto },
    });
    const summary = await service.run();
    assert.equal(summary.skipped, 1);
    assert.equal(summary.drafts, 0);
    assert.deepEqual(lookups, []);
    assert.deepEqual(recorded[0]!.outcome, {
      kind: "SKIP",
      reason: "AUTO_SUBMITTED",
    });
  });

  it("an unknown sender over the hourly guard is recorded as capped, not listed", async () => {
    const outsider = mail("o", {
      from: "x@masik.hu",
      fromAddress: "x@masik.hu",
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [],
      },
    });
    const { service, recorded } = rig({
      ids: ["o"],
      messages: { o: outsider },
      recent: 5,
    });
    const summary = await service.run();
    assert.equal(summary.capped, 1);
    assert.equal(summary.drafts, 0);
    assert.equal(recorded[0]!.outcome.kind, "CAPPED");
  });

  it("a message already recorded is not read again", async () => {
    const { service, fetched } = rig({
      ids: ["a", "b"],
      messages: { b: mail("b") },
      seen: ["a"],
    });
    const summary = await service.run();
    assert.equal(summary.alreadySeen, 1);
    assert.deepEqual(fetched, ["b"]);
  });

  it("takes at most the per-run limit, oldest first, and defers the rest", async () => {
    process.env.TICKET_MAIL_MAX_PER_RUN = "2";
    // Gmail lists newest first: c is the newest, a the oldest
    const { service, fetched } = rig({
      ids: ["c", "b", "a"],
      messages: { a: mail("a"), b: mail("b"), c: mail("c") },
    });
    const summary = await service.run();
    assert.deepEqual(fetched, ["a", "b"]);
    assert.equal(summary.deferred, 1);
  });

  it("CONTROL: one broken message does not block the later ones, and only a fixed code is kept", async () => {
    const { service, recorded } = rig({
      ids: ["b", "a"],
      messages: {
        a: new Error("token=ya29.SECRET refresh detail"),
        b: mail("b"),
      },
    });
    const summary = await service.run();
    assert.equal(summary.failed, 1);
    assert.equal(summary.drafts, 1);
    assert.equal(recorded.length, 1);
    const status = service.status(admin);
    assert.equal(status.lastError, "TICKET_MAIL_MESSAGE_FAILED");
    assert.doesNotMatch(JSON.stringify(status), /SECRET|ya29/);
  });

  it("CONTROL: a second run while one is going is refused", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      hasMessage: async () => null,
      resolveSender: async () => null,
      unknownCountSince: async () => 0,
      record: async () => ({ recorded: true, drafts: 0, mailId: null }),
    };
    const gmail = {
      listMessageIds: async () => {
        await gate;
        return [];
      },
      getMessage: async () => mail("x"),
    };
    const service = new TicketMailIntakeService(
      store as never,
      gmail as never,
      { deliverTicketMailDraftsArrived: async () => undefined } as never,
      { notificationRoleRecipients: async () => [] } as never,
    );
    const first = service.run();
    await assert.rejects(service.run(), ConflictException);
    release();
    await first;
  });
});

describe("TicketMailIntakeService.run: the poisoned message guard", () => {
  const poison = () => new Error("could not store the message");

  it("a message that fails every run is sealed after the allowed attempts, and then the good newer message gets its turn (barracuda, #2646)", async () => {
    process.env.TICKET_MAIL_MAX_PER_RUN = "2";
    // Gmail lists newest first: good is the newest; bad1 and bad2 are older and ALWAYS fail
    const options = {
      ids: ["good", "bad2", "bad1"],
      messages: { good: mail("good"), bad1: poison(), bad2: poison() },
      senders: { "anna@acropora.hu": colleague() },
    };
    const first = rig(options);
    const state = first.state;
    // runs 1 and 2: the two bad ones take both places, nothing else is read, nothing is sealed yet
    for (let run = 1; run <= 2; run++) {
      const summary = await rig({ ...options, shared: state }).service.run();
      assert.equal(summary.failed, 2, `run ${run}`);
      assert.equal(summary.sealed, 0, `run ${run}`);
      assert.equal(summary.drafts, 0, `run ${run}`);
    }
    // run 3: the third failure seals both
    const third = rig({ ...options, shared: state });
    const sealedRun = await third.service.run();
    assert.equal(sealedRun.sealed, 2);
    assert.deepEqual([...state.sealed].sort(), ["bad1", "bad2"]);
    assert.equal(third.fetched.includes("good"), false);
    // run 4: the places are free, the good message becomes a draft
    const fourth = rig({ ...options, shared: state });
    const summary = await fourth.service.run();
    assert.equal(summary.drafts, 1);
    assert.deepEqual(fourth.fetched, ["good"]);
  });

  it("the failure count is the store's, so a restart (a new service on the same store) does not reset it", async () => {
    const options = { ids: ["bad"], messages: { bad: poison() } };
    const state = newStoreState();
    await rig({ ...options, shared: state }).service.run();
    await rig({ ...options, shared: state }).service.run();
    assert.equal(state.attempts.get("bad"), 2);
    await rig({ ...options, shared: state }).service.run();
    assert.deepEqual(state.sealed, ["bad"]);
  });

  it("the number of attempts is configurable", async () => {
    process.env.TICKET_MAIL_MAX_ATTEMPTS = "1";
    const state = newStoreState();
    const summary = await rig({
      ids: ["bad"],
      messages: { bad: poison() },
      shared: state,
    }).service.run();
    assert.equal(summary.sealed, 1);
  });

  it("CONTROL: a failure of the mailbox connection ends the run and counts against NO message (one outage must not seal the mailbox)", async () => {
    for (const code of [
      "TICKET_MAIL_GMAIL_AUTH_FAILED",
      "TICKET_MAIL_GMAIL_RATE_LIMITED",
      "TICKET_MAIL_GMAIL_TIMEOUT",
      "TICKET_MAIL_GMAIL_NETWORK_FAILED",
      "TICKET_MAIL_GMAIL_HTTP_503",
    ]) {
      const state = newStoreState();
      const { service } = rig({
        ids: ["a"],
        messages: { a: new TicketMailGmailError(code) },
        shared: state,
      });
      await assert.rejects(
        service.run(),
        (error: Error) => error.message === code,
        code,
      );
      assert.equal(state.attempts.size, 0, code);
      assert.equal(service.status(admin).lastError, code);
    }
  });

  it("a 4xx Gmail answer for one message belongs to that message and is counted", async () => {
    const state = newStoreState();
    const { service } = rig({
      ids: ["gone"],
      messages: {
        gone: new TicketMailGmailError("TICKET_MAIL_GMAIL_HTTP_404"),
      },
      shared: state,
    });
    const summary = await service.run();
    assert.equal(summary.failed, 1);
    assert.equal(state.attempts.get("gone"), 1);
  });
});

describe("TicketMailIntakeService.run: the unknown senders' total guard", () => {
  const outsider = (id: string, address: string) =>
    mail(id, {
      from: address,
      fromAddress: address,
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [],
      },
    });

  it("unknown senders over the mailbox-wide hourly total are capped, whatever their addresses (rotating addresses pass the per-address guard)", async () => {
    process.env.TICKET_MAIL_UNKNOWN_TOTAL_PER_HOUR = "3";
    const { service, recorded } = rig({
      ids: ["a"],
      messages: { a: outsider("a", "fresh@masik.hu") },
      recent: 0,
      recentTotal: 3,
    });
    const summary = await service.run();
    assert.equal(summary.capped, 1);
    assert.equal(recorded[0]!.outcome.kind, "CAPPED");
  });

  it("below the total the unknown sender is listed", async () => {
    process.env.TICKET_MAIL_UNKNOWN_TOTAL_PER_HOUR = "3";
    const { service } = rig({
      ids: ["a"],
      messages: { a: outsider("a", "fresh@masik.hu") },
      recent: 0,
      recentTotal: 2,
    });
    assert.equal((await service.run()).drafts, 1);
  });
});

describe("TicketMailIntakeService.run: the arrival push", () => {
  it("one push per run for the drafts of switched-on colleagues, to the role's holders, with the last mail as the target", async () => {
    const { service, pushes, roles } = rig({
      ids: ["b", "a"],
      messages: { a: mail("a"), b: mail("b") },
      senders: { "anna@acropora.hu": colleague() },
      recipients: [{ id: "manager-1" }, { id: "manager-2" }],
    });
    const summary = await service.run();
    assert.equal(pushes.length, 1);
    assert.deepEqual(pushes[0], {
      mailId: "mail-b",
      userIds: ["manager-1", "manager-2"],
      count: 2,
    });
    assert.equal(summary.notified, 2);
    assert.deepEqual(roles, ["SERVICE_TICKET_AI_DRAFT"]);
  });

  it("a connection failure that ends the run still announces the drafts filed before it (the next run will not find them new)", async () => {
    // Gmail lists newest first: a is filed first, then the connection fails on b
    const { service, pushes } = rig({
      ids: ["b", "a"],
      messages: {
        a: mail("a"),
        b: new TicketMailGmailError("TICKET_MAIL_GMAIL_AUTH_FAILED"),
      },
      senders: { "anna@acropora.hu": colleague() },
    });
    await assert.rejects(service.run(), /TICKET_MAIL_GMAIL_AUTH_FAILED/);
    assert.equal(pushes.length, 1);
    assert.deepEqual(pushes[0], {
      mailId: "mail-a",
      userIds: ["manager-1"],
      count: 1,
    });
  });

  it("CONTROL: a switched-off colleague's and an unknown sender's drafts send NO push", async () => {
    const outsider = mail("o", {
      from: "x@masik.hu",
      fromAddress: "x@masik.hu",
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [],
      },
    });
    const { service, pushes } = rig({
      ids: ["o", "a"],
      messages: { a: mail("a"), o: outsider },
      senders: { "anna@acropora.hu": colleague({ watching: false }) },
    });
    const summary = await service.run();
    assert.equal(summary.drafts, 2);
    assert.equal(pushes.length, 0);
    assert.equal(summary.notified, 0);
  });

  it("CONTROL: a machine's mail and an old (already recorded) message send no push", async () => {
    const auto = mail("m", {
      headers: {
        autoSubmitted: "auto-replied",
        precedence: null,
        listId: null,
        authenticationResults: [PASS("acropora.hu")],
      },
    });
    const { service, pushes } = rig({
      ids: ["m", "a"],
      messages: { m: auto, a: mail("a") },
      seen: ["a"],
      senders: { "anna@acropora.hu": colleague() },
    });
    await service.run();
    assert.equal(pushes.length, 0);
  });

  it("CONTROL: a push that fails, or a role nobody holds, does not fail the run, and only a fixed code is logged", async () => {
    const failing = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
      pushFails: true,
    });
    const summary = await failing.service.run();
    assert.equal(summary.drafts, 1);
    assert.equal(summary.notified, 0);
    assert.doesNotMatch(
      JSON.stringify(failing.service.status(admin)),
      /SECRET/,
    );
    const nobody = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
      recipients: [],
    });
    const quiet = await nobody.service.run();
    assert.equal(quiet.drafts, 1);
    assert.equal(nobody.pushes.length, 0);
    assert.equal(quiet.notified, 0);
  });
});

describe("TicketMailIntakeService.run: the AI step", () => {
  const filled = {
    kind: "DRAFT",
    title: "A szűrő csöpög",
    summary: "A szűrő a hétvége óta csöpög.",
    extractedBy: "gpt-5.1 ticket-draft/v1",
  };
  const aiOn = () => {
    process.env.TICKET_MAIL_AI_ENABLED = "true";
  };
  const withText = (id: string, text: string, subject = "Szűrő hiba") =>
    mail(id, { text, subject });
  const outsider = (id: string) =>
    mail(id, {
      from: "x@masik.hu",
      fromAddress: "x@masik.hu",
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [],
      },
    });

  it("a switched-on colleague's mail goes to the AI REDACTED, and the draft becomes an AI draft with the AI's title and summary", async () => {
    aiOn();
    const { service, recorded, aiCalls, pushes } = rig({
      ids: ["a"],
      messages: {
        a: withText(
          "a",
          "Szia Gábor,\nKovács Péter (+36 20 555 1234, peter.kovacs@pelda.hu) szerint a szűrő csöpög, lásd https://pelda.example/12345678.",
          "Hiba: Kovács Péter jelzése",
        ),
      },
      senders: { "anna@acropora.hu": colleague({ displayName: "Szabó Anna" }) },
      names: ["Kovács Péter", "Szabó Anna"],
      ai: async () => filled,
    });
    const summary = await service.run();
    assert.equal(aiCalls.length, 1);
    const sent = JSON.stringify(aiCalls[0]);
    for (const trace of [
      "Gábor",
      "Kovács",
      "Péter",
      "+36",
      "555",
      "peter.kovacs",
      "pelda",
      "12345678",
    ])
      assert.equal(sent.includes(trace), false, trace);
    assert.match(aiCalls[0]!.text, /szerint a szűrő csöpög/);
    assert.equal(summary.aiDrafts, 1);
    assert.equal(summary.aiCalls, 1);
    assert.equal(recorded[0]!.outcome.intakeState, "AI_DRAFT");
    const content = (
      recorded[0] as unknown as { content: Record<string, string> }
    ).content;
    assert.equal(content.title, "A szűrő csöpög");
    assert.equal(content.aiSummary, "A szűrő a hétvége óta csöpög.");
    assert.equal(content.aiExtractedBy, "gpt-5.1 ticket-draft/v1");
    // an AI draft announces itself like an AI-less one
    assert.equal(pushes.length, 1);
  });

  it("CONTROL: the AI is asked ONLY for a verified switched-on colleague: not for a switched-off one, an unknown sender, a forged sender or a machine's mail", async () => {
    aiOn();
    const forged = mail("f", {
      headers: {
        autoSubmitted: null,
        precedence: null,
        listId: null,
        authenticationResults: [FAIL("acropora.hu")],
      },
    });
    const auto = mail("m", {
      headers: {
        autoSubmitted: "auto-replied",
        precedence: null,
        listId: null,
        authenticationResults: [PASS("acropora.hu")],
      },
    });
    const off = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague({ watching: false }) },
      ai: async () => filled,
    });
    const unknown = rig({
      ids: ["o"],
      messages: { o: outsider("o") },
      ai: async () => filled,
    });
    const fake = rig({
      ids: ["f"],
      messages: { f: forged },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => filled,
    });
    const machine = rig({
      ids: ["m"],
      messages: { m: auto },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => filled,
    });
    for (const one of [off, unknown, fake, machine]) {
      await one.service.run();
      assert.equal(one.aiCalls.length, 0);
    }
  });

  it("without the AI switch, or without an AI client, nothing is called and the draft stays AI-less", async () => {
    const noSwitch = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => filled,
    });
    await noSwitch.service.run();
    assert.equal(noSwitch.aiCalls.length, 0);
    assert.equal(noSwitch.recorded[0]!.outcome.intakeState, "AI_UNAVAILABLE");
    aiOn();
    const noClient = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
    });
    await noClient.service.run();
    assert.equal(noClient.recorded[0]!.outcome.intakeState, "AI_UNAVAILABLE");
    assert.equal(noClient.service.status(admin).ai.enabled, false);
  });

  it("a refusal keeps the draft AI-less with the original title, and is counted", async () => {
    aiOn();
    const { service, recorded } = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => ({ kind: "REFUSED", refusal: "UNSAFE_OUTPUT" }),
    });
    const summary = await service.run();
    assert.equal(summary.aiRefused, 1);
    assert.equal(recorded[0]!.outcome.intakeState, "AI_UNAVAILABLE");
    const content = (
      recorded[0] as unknown as { content: Record<string, string | undefined> }
    ).content;
    assert.equal(content.title, "Hiba a");
    assert.equal(content.aiSummary, undefined);
  });

  it("CONTROL: after the allowed unavailable answers in a row the run stops calling, and the rest are filed without the AI", async () => {
    aiOn();
    const { service, aiCalls, recorded } = rig({
      ids: ["c", "b", "a"],
      messages: { a: mail("a"), b: mail("b"), c: mail("c") },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => ({ kind: "UNAVAILABLE", reason: "HTTP 502" }),
    });
    const summary = await service.run();
    assert.equal(aiCalls.length, 2);
    assert.equal(summary.aiUnavailable, 2);
    assert.equal(summary.drafts, 3);
    assert.equal(recorded.length, 3);
    assert.equal(
      recorded.every((r) => r.outcome.intakeState === "AI_UNAVAILABLE"),
      true,
    );
  });

  it("an answer in between resets the failure count", async () => {
    aiOn();
    const answers = [
      { kind: "UNAVAILABLE", reason: "HTTP 502" },
      filled,
      { kind: "UNAVAILABLE", reason: "HTTP 502" },
      filled,
    ];
    let call = 0;
    const { service, aiCalls } = rig({
      ids: ["d", "c", "b", "a"],
      messages: { a: mail("a"), b: mail("b"), c: mail("c"), d: mail("d") },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => answers[call++],
    });
    await service.run();
    assert.equal(aiCalls.length, 4);
  });

  it("at most the configured number of AI calls in one run", async () => {
    aiOn();
    process.env.TICKET_MAIL_AI_MAX_PER_RUN = "1";
    const { service, aiCalls, recorded } = rig({
      ids: ["b", "a"],
      messages: { a: mail("a"), b: mail("b") },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => filled,
    });
    await service.run();
    assert.equal(aiCalls.length, 1);
    assert.deepEqual(
      recorded.map((r) => r.outcome.intakeState),
      ["AI_DRAFT", "AI_UNAVAILABLE"],
    );
  });

  it("CONTROL: a client that throws is an unavailable AI, not a failed message", async () => {
    aiOn();
    const { service, recorded } = rig({
      ids: ["a"],
      messages: { a: mail("a") },
      senders: { "anna@acropora.hu": colleague() },
      ai: async () => {
        throw new Error("token SECRET");
      },
    });
    const summary = await service.run();
    assert.equal(summary.failed, 0);
    assert.equal(summary.aiUnavailable, 1);
    assert.equal(recorded[0]!.outcome.intakeState, "AI_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(service.status(admin)), /SECRET/);
  });

  it("CONTROL: when the users' names cannot be read there is NO call, the draft is still made and the run goes on (barracuda, #2650)", async () => {
    aiOn();
    const { service, recorded, aiCalls } = rig({
      ids: ["a", "b"],
      messages: { a: mail("a"), b: mail("b") },
      senders: { "anna@acropora.hu": colleague() },
      namesFail: true,
      ai: async () => filled,
    });
    const summary = await service.run();
    assert.equal(aiCalls.length, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.aiCalls, 0);
    assert.equal(summary.aiUnavailable, 2);
    assert.equal(summary.drafts, 2);
    assert.deepEqual(
      recorded.map((r) => r.outcome.kind === "DRAFT" && r.outcome.intakeState),
      ["AI_UNAVAILABLE", "AI_UNAVAILABLE"],
    );
    assert.doesNotMatch(JSON.stringify(service.status(admin)), /SECRET/);
  });

  it("a mail that is nothing but names and numbers once redacted is not sent", async () => {
    aiOn();
    const { service, aiCalls } = rig({
      ids: ["a"],
      messages: {
        a: withText("a", "Szabó Anna +36 30 123 4567 12345678", "Kovács Péter"),
      },
      senders: { "anna@acropora.hu": colleague({ displayName: "Szabó Anna" }) },
      names: ["Kovács Péter", "Szabó Anna"],
      ai: async () => filled,
    });
    await service.run();
    assert.equal(aiCalls.length, 0);
  });
});

describe("TicketMailIntakeService.status", () => {
  it("shows the switch, the limits and the last run to an internal admin", async () => {
    const { service } = rig({ ids: [], messages: {} });
    await service.run();
    const status = service.status(admin);
    assert.equal(status.enabled, true);
    assert.equal(status.mailbox, "ticket@acropora.hu");
    assert.equal(status.maxMessagesPerRun, 50);
    assert.ok(status.lastRunAt);
  });

  it("CONTROL: refuses a non-admin, a partner account and a supplier account", () => {
    const { service } = rig({ ids: [], messages: {} });
    for (const user of [
      { role: "MANAGER", customerId: null, supplierId: null },
      { role: "ADMIN", customerId: "c1", supplierId: null },
      { role: "ADMIN", customerId: null, supplierId: "s1" },
    ])
      assert.throws(
        () => service.status(user as AuthenticatedUser),
        ForbiddenException,
      );
  });
});
