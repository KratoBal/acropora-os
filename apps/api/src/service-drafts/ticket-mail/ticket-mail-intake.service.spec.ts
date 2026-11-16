import "reflect-metadata";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import type { TicketMailMessage } from "./ticket-mail-gmail.client.js";
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

function rig(options: {
  ids: string[];
  messages: Record<string, TicketMailMessage | Error>;
  seen?: string[];
  senders?: Record<string, ResolvedSender | null>;
  recent?: number;
}) {
  const recorded: Recorded[] = [];
  const lookups: string[] = [];
  const fetched: string[] = [];
  const store = {
    hasMessage: async (_m: string, id: string) =>
      (options.seen ?? []).includes(id) ? { id } : null,
    resolveSender: async (address: string) => {
      lookups.push(address);
      return options.senders?.[address] ?? null;
    },
    unknownCountSince: async () => options.recent ?? 0,
    record: async (input: Recorded) => {
      recorded.push(input);
      return { recorded: true, drafts: input.outcome.kind === "DRAFT" ? 1 : 0 };
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
  const service = new TicketMailIntakeService(store as never, gmail as never);
  return { service, recorded, lookups, fetched };
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
      record: async () => ({ recorded: true, drafts: 0 }),
    };
    const gmail = {
      listMessageIds: async () => {
        await gate;
        return [];
      },
      getMessage: async () => mail("x"),
    };
    const service = new TicketMailIntakeService(store as never, gmail as never);
    const first = service.run();
    await assert.rejects(service.run(), ConflictException);
    release();
    await first;
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
