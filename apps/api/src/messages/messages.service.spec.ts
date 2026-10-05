import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  type AuthenticatedUser,
  type MessageStreamEvent,
  type UserRole,
} from "@acropora/types";
import { firstValueFrom, take, toArray } from "rxjs";

import { InMemoryMessageEventBus } from "./message-event-bus.js";
import type {
  ConversationRow,
  MemberRow,
  MessageRow,
  MessagingUserRow,
} from "./messages.repository.js";
import {
  decodeCursor,
  messagePushText,
  pushRecipients,
  directKeyOf,
  encodeCursor,
  mayJoinInternal,
} from "./messages.rules.js";
import { MessagesService } from "./messages.service.js";

/*
  AZ ÜZENETEK 1. FÁZISA (kártya 51d7aba0). MI PIROSÍT:
  - két ember között második DIRECT beszélgetés keletkezik, vagy a sorrend számít;
  - nem tag bármelyik beszélgetés-útvonalon választ kap (404 helyett);
  - partnerfiók, gépi ágens vagy inaktív kolléga bekerül egy belső beszélgetésbe;
  - egy újraküldés második üzenetet hoz létre;
  - a törölt üzenet szövege kimegy;
  - a push a küldőnek, kilépett vagy elnémított tagnak is megy;
  - az esemény nem tagnak is kimegy.
*/

const person = (
  id: string,
  over: Partial<MessagingUserRow> = {},
): MessagingUserRow => ({
  id,
  role: "SERVICE",
  isActive: true,
  customerId: null,
  supplierId: null,
  displayName: `Teljes ${id}`,
  nickname: null,
  avatarUrl: null,
  ...over,
});

const viewer = (id: string, over: Partial<AuthenticatedUser> = {}) =>
  ({
    id,
    email: `${id}@x.invalid`,
    displayName: `Teljes ${id}`,
    nickname: null,
    role: "SERVICE",
    customerId: null,
    supplierId: null,
    ...over,
  }) as AuthenticatedUser;

/** A tárolót utánzó hamis repository: annyit tud, amennyit a szolgáltatás kér. */
function fakeRepository(users: MessagingUserRow[]) {
  const people = new Map(users.map((u) => [u.id, u]));
  const conversations = new Map<
    string,
    {
      id: string;
      type: "DIRECT" | "GROUP";
      title: string | null;
      directKey: string | null;
      members: Map<string, MemberRow & { lastReadMessageId: string | null }>;
      lastMessageId: string | null;
      lastMessageAt: Date | null;
    }
  >();
  const messages: MessageRow[] = [];
  const audits: string[] = [];
  let n = 0;
  const repo = {
    audits,
    messages,
    conversations,
    users: async (ids: readonly string[]) =>
      ids.flatMap((id) => (people.has(id) ? [people.get(id)!] : [])),
    people: async () => [...people.values()],
    directConversationId: async (key: string) =>
      [...conversations.values()].find((c) => c.directKey === key)?.id ?? null,
    createConversation: async (input: {
      type: "DIRECT" | "GROUP";
      title: string | null;
      directKey: string | null;
      memberIds: readonly string[];
    }) => {
      const existing = input.directKey
        ? await repo.directConversationId(input.directKey)
        : null;
      if (existing) return { id: existing, created: false };
      const id = `c${++n}`;
      conversations.set(id, {
        id,
        type: input.type,
        title: input.title,
        directKey: input.directKey,
        members: new Map(
          input.memberIds.map((userId) => [
            userId,
            {
              userId,
              leftAt: null,
              notify: "ALL" as const,
              mutedUntil: null,
              lastReadMessageId: null,
            },
          ]),
        ),
        lastMessageId: null,
        lastMessageAt: null,
      });
      return { id, created: true };
    },
    activeMembership: async (conversationId: string, userId: string) => {
      const m = conversations.get(conversationId)?.members.get(userId);
      return m && m.leftAt === null
        ? {
            joinedAt: new Date(0),
            lastReadAt: null,
            lastReadMessageId: m.lastReadMessageId,
          }
        : null;
    },
    conversation: async (id: string): Promise<ConversationRow | null> => {
      const c = conversations.get(id);
      if (!c) return null;
      return {
        id: c.id,
        type: c.type,
        audience: "INTERNAL",
        title: c.title,
        description: null,
        createdByUserId: [...c.members.keys()][0]!,
        lastMessageId: c.lastMessageId,
        lastMessageAt: c.lastMessageAt,
        members: [...c.members.values()]
          .filter((m) => m.leftAt === null)
          .map((m) => ({
            userId: m.userId,
            lastReadMessageId: m.lastReadMessageId,
            user: people.get(m.userId)!,
          })),
      } as ConversationRow;
    },
    conversationsOf: async (userId: string) =>
      (
        await Promise.all(
          [...conversations.values()]
            .filter((c) => c.members.get(userId)?.leftAt === null)
            .map((c) => repo.conversation(c.id)),
        )
      ).filter((c): c is ConversationRow => c !== null),
    messagesByIds: async (ids: readonly string[]) =>
      messages.filter((m) => ids.includes(m.id)),
    unreadCounts: async () =>
      new Map([
        ["c1", 2],
        ["c2", 0],
        ["c3", 5],
      ]),
    messageByClientId: async (senderUserId: string, clientMessageId: string) =>
      messages.find(
        (m) =>
          m.senderUserId === senderUserId &&
          m.clientMessageId === clientMessageId,
      ) ?? null,
    createMessage: async (input: {
      conversationId: string;
      senderUserId: string;
      text: string;
      clientMessageId: string;
    }) => {
      const sender = people.get(input.senderUserId)!;
      const row = {
        id: `m${messages.length + 1}`,
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        type: "TEXT",
        text: input.text,
        clientMessageId: input.clientMessageId,
        replyToMessageId: null,
        createdAt: new Date(1_000 + messages.length),
        editedAt: null,
        deletedAt: null,
        sender: { displayName: sender.displayName, nickname: sender.nickname },
        attachments: [],
        reactions: [],
        replyTo: null,
        pins: [],
        forwardedFromMessageId: null,
        forwardedFromUserId: null,
        forwardedFromUser: null,
      } as MessageRow;
      messages.push(row);
      const c = conversations.get(input.conversationId)!;
      c.lastMessageId = row.id;
      c.lastMessageAt = row.createdAt;
      return row;
    },
    messageInConversation: async (conversationId: string, messageId: string) =>
      messages.find(
        (m) => m.id === messageId && m.conversationId === conversationId,
      ) ?? null,
    markRead: async () => true,
    messagesPage: async (input: { conversationId: string; limit: number }) => {
      const rows = messages
        .filter((m) => m.conversationId === input.conversationId)
        .reverse();
      return {
        rows: rows.slice(0, input.limit),
        hasOlder: rows.length > input.limit,
      };
    },
    members: async (conversationId: string) => [
      ...conversations.get(conversationId)!.members.values(),
    ],
    audit: async (input: { action: string; conversationId: string }) =>
      void audits.push(`${input.action} ${input.conversationId}`),
  };
  return repo;
}

function setup(users: MessagingUserRow[]) {
  const repo = fakeRepository(users);
  const bus = new InMemoryMessageEventBus();
  const published: string[] = [];
  const realPublish = bus.publish.bind(bus);
  bus.publish = (userIds, event) => {
    published.push(`${event.type} -> ${[...userIds].sort().join(",")}`);
    realPublish(userIds, event);
  };
  const pushes: { userIds: readonly string[]; title: string; body: string }[] =
    [];
  const notifications = {
    notifyNewMessage: (notice: {
      userIds: readonly string[];
      title: string;
      body: string;
    }) => void pushes.push(notice),
  };
  const service = new MessagesService(
    repo as never,
    bus,
    notifications as never,
  );
  return { service, repo, bus, published, pushes };
}

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

describe("who may message", () => {
  it("every internal human role, VIEWER included; no agent and no partner (acrobot 26174)", () => {
    const allowed = USER_ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].includes(PERMISSIONS.MESSAGES_USE),
    );
    assert.deepEqual(
      [...allowed].sort(),
      [
        "ADMIN",
        "MANAGER",
        "OWNER",
        "SALES",
        "SERVICE",
        "VIEWER",
        "WAREHOUSE",
      ].sort(),
    );
  });

  it("an internal conversation takes no partner, agent or inactive account", () => {
    const check = (over: Partial<MessagingUserRow>) =>
      mayJoinInternal(person("x", over));
    assert.equal(check({}), true);
    assert.equal(check({ role: "VIEWER" }), true);
    assert.equal(check({ role: "PARTNER_SERVICE" }), false);
    assert.equal(check({ role: "CONTENT_AGENT" as UserRole }), false);
    assert.equal(check({ role: "ASSET_IMPORT_AGENT" as UserRole }), false);
    // egy belső szerepkörű, de partnerhez kötött fiók sem
    assert.equal(check({ customerId: "cust-1" }), false);
    assert.equal(check({ supplierId: "sup-1" }), false);
    assert.equal(check({ isActive: false }), false);
  });
});

describe("conversations", () => {
  const users = [person("a"), person("b"), person("c")];

  it("one DIRECT conversation between two people, whoever starts it", async () => {
    const { service, repo } = setup(users);
    const first = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    const again = await service.createConversation(viewer("a"), {
      memberIds: ["b", "a"],
    });
    const reverse = await service.createConversation(viewer("b"), {
      memberIds: ["a"],
    });
    assert.equal(first.type, "DIRECT");
    assert.deepEqual([again.id, reverse.id], [first.id, first.id]);
    assert.equal(repo.conversations.size, 1);
    assert.equal(directKeyOf("b", "a"), directKeyOf("a", "b"));
    assert.deepEqual(repo.audits, [`conversation.created ${first.id}`]);
  });

  it("several people make a GROUP with its name; a DIRECT keeps no title", async () => {
    const { service } = setup(users);
    const group = await service.createConversation(viewer("a"), {
      memberIds: ["b", "c"],
      title: " Zoo szerviz ",
    });
    const direct = await service.createConversation(viewer("a"), {
      memberIds: ["c"],
      title: "ignored",
    });
    assert.deepEqual(
      [group.type, group.title, direct.type, direct.title],
      ["GROUP", "Zoo szerviz", "DIRECT", null],
    );
    assert.deepEqual(group.members.map((m) => m.userId).sort(), ["b", "c"]);
  });

  it("refuses a partner, an agent, an inactive or an unknown member, and a partner-bound requester", async () => {
    const { service } = setup([
      ...users,
      person("partner", { role: "PARTNER_SERVICE", customerId: "cust" }),
      person("bound", { customerId: "cust" }),
      person("gone", { isActive: false }),
    ]);
    for (const memberIds of [
      ["partner"],
      ["bound"],
      ["gone"],
      ["nobody"],
      ["b", "partner"],
    ])
      assert.equal(
        await status(service.createConversation(viewer("a"), { memberIds })),
        400,
        memberIds.join(","),
      );
    assert.equal(
      await status(
        service.createConversation(viewer("bound", { customerId: "cust" }), {
          memberIds: ["a"],
        }),
      ),
      403,
    );
    assert.equal(
      await status(
        service.createConversation(viewer("a"), { memberIds: ["a"] }),
      ),
      400,
    );
  });

  it("a non-member gets 404 on every conversation route", async () => {
    const { service } = setup(users);
    const { id } = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    const sent = await service.send(viewer("a"), id, {
      text: "szia",
      clientMessageId: "client-001",
    });
    const outsider = viewer("c");
    assert.deepEqual(
      await Promise.all([
        status(service.detail(outsider, id)),
        status(service.messages(outsider, id, {})),
        status(
          service.send(outsider, id, {
            text: "x",
            clientMessageId: "client-002",
          }),
        ),
        status(service.markRead(outsider, id, sent.id)),
      ]),
      [404, 404, 404, 404],
    );
  });

  it("a deactivated colleague stays in the old conversation, marked inactive", async () => {
    const b = person("b");
    const { service } = setup([person("a"), b]);
    const { id } = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    await service.send(viewer("b"), id, {
      text: "régi üzenet",
      clientMessageId: "client-001",
    });
    b.isActive = false; // közben deaktiválták
    const detail = await service.detail(viewer("a"), id);
    assert.deepEqual(
      detail.members.map((m) => [m.userId, m.isActive]),
      [["b", false]],
    );
    const page = await service.messages(viewer("a"), id, {});
    assert.deepEqual(
      page.items.map((m) => [m.senderUserId, m.text]),
      [["b", "régi üzenet"]],
    );
    // újat viszont nem lehet vele indítani
    assert.equal(
      await status(
        service.createConversation(viewer("a"), { memberIds: ["b"] }),
      ),
      400,
    );
  });
});

describe("messages", () => {
  const users = [person("a", { nickname: "Anna" }), person("b"), person("c")];

  it("sends, announces to every member, and pushes to the others only", async () => {
    const { service, published, pushes } = setup(users);
    const { id } = await service.createConversation(
      viewer("a", { nickname: "Anna" }),
      {
        memberIds: ["b"],
      },
    );
    const message = await service.send(viewer("a", { nickname: "Anna" }), id, {
      text: "  Megérkezett már a pumpa?  ",
      clientMessageId: "client-001",
    });
    assert.equal(message.text, "Megérkezett már a pumpa?");
    assert.equal(message.clientMessageId, "client-001");
    assert.deepEqual(published, [
      `conversation.created -> a,b`,
      `message.created -> a,b`,
    ]);
    assert.deepEqual(
      pushes.map((p) => [p.userIds, p.title, p.body]),
      [[["b"], "Anna", "Megérkezett már a pumpa?"]],
    );
  });

  it("an empty message is refused; a resend returns the same message, never a second one", async () => {
    const { service, repo } = setup(users);
    const { id } = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    assert.equal(
      await status(
        service.send(viewer("a"), id, {
          text: "   ",
          clientMessageId: "client-001",
        }),
      ),
      400,
    );
    const once = await service.send(viewer("a"), id, {
      text: "x",
      clientMessageId: "client-001",
    });
    const twice = await service.send(viewer("a"), id, {
      text: "x",
      clientMessageId: "client-001",
    });
    assert.equal(twice.id, once.id);
    assert.equal(repo.messages.length, 1);
    const other = await service.createConversation(viewer("a"), {
      memberIds: ["c"],
    });
    assert.equal(
      await status(
        service.send(viewer("a"), other.id, {
          text: "x",
          clientMessageId: "client-001",
        }),
      ),
      409,
    );
  });

  it("a deleted message goes out without its text, and another sender's client id stays hidden", async () => {
    const { service, repo } = setup(users);
    const { id } = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    await service.send(viewer("a"), id, {
      text: "titok",
      clientMessageId: "client-001",
    });
    repo.messages[0]!.deletedAt = new Date();
    const page = await service.messages(viewer("b"), id, {});
    assert.deepEqual(
      page.items.map((m) => [m.text, m.deleted, m.clientMessageId]),
      [[null, true, null]],
    );
  });

  it("a read mark needs a message of this conversation, and tells the reader's other devices", async () => {
    const { service, published } = setup(users);
    const { id } = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    const other = await service.createConversation(viewer("a"), {
      memberIds: ["c"],
    });
    const elsewhere = await service.send(viewer("a"), other.id, {
      text: "x",
      clientMessageId: "client-009",
    });
    assert.equal(
      await status(service.markRead(viewer("b"), id, elsewhere.id)),
      404,
    );
    const here = await service.send(viewer("a"), id, {
      text: "y",
      clientMessageId: "client-010",
    });
    assert.deepEqual(await service.markRead(viewer("b"), id, here.id), {
      moved: true,
    });
    assert.equal(published.at(-1), `conversation.read -> b`);
  });

  it("the unread total sums the conversations, and counts those with any", async () => {
    const { service } = setup(users);
    assert.deepEqual(await service.unread(viewer("a")), {
      total: 7,
      conversations: 2,
    });
  });

  it("a bad cursor is a 400, not a full history", async () => {
    const { service } = setup(users);
    const { id } = await service.createConversation(viewer("a"), {
      memberIds: ["b"],
    });
    assert.equal(
      await status(service.messages(viewer("a"), id, { before: "nem-kurzor" })),
      400,
    );
  });
});

describe("the rules", () => {
  it("the cursor round-trips, and garbage reads as no cursor", () => {
    const row = { createdAt: new Date("2026-10-05T09:00:00.123Z"), id: "m1" };
    assert.deepEqual(decodeCursor(encodeCursor(row)), row);
    assert.equal(decodeCursor("semmi"), null);
  });
});

describe("the push", () => {
  it("goes to active, unmuted others who want every message", () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const m = (userId: string, over: Partial<MemberRow> = {}): MemberRow => ({
      userId,
      leftAt: null,
      notify: "ALL",
      mutedUntil: null,
      ...over,
    });
    assert.deepEqual(
      pushRecipients({
        senderUserId: "a",
        now,
        members: [
          m("a"),
          m("b"),
          m("left", { leftAt: new Date() }),
          m("muted", { mutedUntil: new Date("2026-10-05T11:00:00Z") }),
          m("unmuted", { mutedUntil: new Date("2026-10-05T09:00:00Z") }),
          m("none", { notify: "NONE" }),
          m("mentions", { notify: "MENTIONS" }),
        ],
      }),
      ["b", "unmuted"],
    );
  });

  it("names the sender in a direct chat, the group in a group, and is cut at 140", () => {
    assert.deepEqual(
      messagePushText({
        conversationTitle: null,
        senderName: "Kovács Anna",
        text: "Szia",
      }),
      { title: "Kovács Anna", body: "Szia" },
    );
    assert.equal(
      messagePushText({
        conversationTitle: "Webshop",
        senderName: "Anna",
        text: "x".repeat(200),
      }).body.length,
      "Anna: ".length + 140,
    );
  });
});

describe("the event bus", () => {
  it("a subscriber gets only the events addressed to them", async () => {
    const bus = new InMemoryMessageEventBus();
    const got = firstValueFrom(bus.subscribe("b").pipe(take(2), toArray()));
    const event = (id: string): MessageStreamEvent => ({
      type: "message.created",
      conversationId: "c1",
      messageId: id,
    });
    bus.publish(["a"], event("m1"));
    bus.publish(["a", "b"], event("m2"));
    bus.publish(["b", "b"], event("m3"));
    assert.deepEqual(
      (await got).map((e) => (e.type === "message.created" ? e.messageId : "")),
      ["m2", "m3"],
    );
  });
});
