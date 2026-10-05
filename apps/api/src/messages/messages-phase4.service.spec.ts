import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { InMemoryMessageEventBus } from "./message-event-bus.js";
import { systemText } from "./messages.rules.js";
import { MessagesService } from "./messages.service.js";

/*
  AZ ÜZENETEK 4. FÁZISA (terv: uzenetek-4-fazis-terv.md; Balázs 2026-10-05: mind
  az 1-es). MI PIROSÍT:
  - a munkalapról indított beszélgetésbe nem kerül be a szerelő, vagy partner,
    inaktív kolléga is bekerül;
  - egy munkalaphoz második élő beszélgetés jön létre, vagy a meglévőbe a
    kérdező nem kerül be;
  - szervizjog nélkül indítani, kötni vagy leválasztani lehet;
  - a kártya szervizjog nélkül is kiadja a partnert és az állapotot;
  - közvetlen beszélgetés köthető, abból kilépni vagy abba tagot adni lehet;
  - már kötött beszélgetés csendben átköthető;
  - a tag hozzáadása vagy a kilépés nem látszik a beszélgetésben (rendszerüzenet),
    vagy nem naplózódik; a rendszerüzenet pusht küld;
  - az utolsó kilépő után a beszélgetés nem archív.
*/

const viewer = (id: string, role = "SERVICE") =>
  ({
    id,
    email: `${id}@x.invalid`,
    displayName: `Teljes ${id}`,
    nickname: null,
    role,
    customerId: null,
    supplierId: null,
  }) as AuthenticatedUser;

type Conv = {
  id: string;
  type: "DIRECT" | "GROUP";
  audience: "INTERNAL";
  title: string | null;
  description: string | null;
  createdByUserId: string;
  lastMessageId: string | null;
  lastMessageAt: Date | null;
  contextType: string | null;
  contextId: string | null;
  archivedAt: Date | null;
  members: { userId: string; leftAt: Date | null }[];
};

const person = (id: string, over: Record<string, unknown> = {}) => ({
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

function fake() {
  const people = new Map([
    ["a", person("a")],
    ["b", person("b")],
    ["c", person("c")],
    ["raktar", person("raktar", { role: "WAREHOUSE" })],
    ["inaktiv", person("inaktiv", { isActive: false })],
    [
      "partner",
      person("partner", { role: "PARTNER_SERVICE", customerId: "cust1" }),
    ],
  ]);
  const conversations = new Map<string, Conv>();
  const messages: {
    id: string;
    conversationId: string;
    senderUserId: string;
    type: string;
    text: string;
  }[] = [];
  const audits: {
    userId: string;
    action: string;
    conversationId: string;
    metadata: unknown;
  }[] = [];
  const pushes: unknown[] = [];
  let n = 0;
  const live = (c: Conv) => c.members.filter((m) => m.leftAt === null);
  const row = (c: Conv) => ({
    ...c,
    members: live(c).map((m) => ({
      userId: m.userId,
      lastReadMessageId: null,
      user: people.get(m.userId)!,
    })),
  });
  const worksheets = new Map([
    [
      "ws1",
      {
        id: "ws1",
        number: "BIO-2026-001",
        createdAt: new Date("2026-10-05T08:00:00Z"),
        hiddenAt: null as Date | null,
        customer: { displayName: "Fővárosi Állatkert" },
        assignees: [
          { userId: "b" },
          { userId: "partner" },
          { userId: "inaktiv" },
        ],
        versions: [{ status: "DRAFT", _count: { lines: 2 } }],
      },
    ],
    [
      "rejtett",
      {
        id: "rejtett",
        number: "BIO-2026-002",
        createdAt: new Date(),
        hiddenAt: new Date() as Date | null,
        customer: { displayName: "X" },
        assignees: [],
        versions: [],
      },
    ],
  ]);
  const jobs = new Map([
    [
      "job1",
      {
        id: "job1",
        jobNumber: "HJ-2026-007",
        status: "IN_PROGRESS",
        createdAt: new Date("2026-10-04T10:00:00Z"),
        assignedUserId: "c",
        customer: { displayName: "FANK" },
      },
    ],
  ]);
  const contextTaken = (type: string, id: string) =>
    [...conversations.values()].some(
      (c) => c.contextType === type && c.contextId === id && !c.archivedAt,
    );

  const repo = {
    audits,
    conversations,
    messages,
    worksheets,
    users: async (ids: readonly string[]) =>
      ids.flatMap((id) => (people.has(id) ? [people.get(id)!] : [])),
    activeMembership: async (c: string, u: string) => {
      const conv = conversations.get(c);
      return conv && !conv.archivedAt && live(conv).some((m) => m.userId === u)
        ? {
            joinedAt: new Date(0),
            lastReadAt: null,
            lastReadMessageId: null,
            notify: "ALL",
            mutedUntil: null,
          }
        : null;
    },
    conversation: async (id: string) => {
      const c = conversations.get(id);
      return c ? row(c) : null;
    },
    conversationByContext: async (type: string, id: string) =>
      [...conversations.values()].find(
        (c) => c.contextType === type && c.contextId === id && !c.archivedAt,
      )?.id ?? null,
    createConversation: async (input: {
      type: "DIRECT" | "GROUP";
      title: string | null;
      createdByUserId: string;
      memberIds: readonly string[];
      context?: { type: string; id: string } | null;
    }) => {
      if (input.context && contextTaken(input.context.type, input.context.id)) {
        const existing = [...conversations.values()].find(
          (c) =>
            c.contextType === input.context!.type &&
            c.contextId === input.context!.id &&
            !c.archivedAt,
        )!;
        return { id: existing.id, created: false };
      }
      const id = `conv${++n}`;
      conversations.set(id, {
        id,
        type: input.type,
        audience: "INTERNAL",
        title: input.title,
        description: null,
        createdByUserId: input.createdByUserId,
        lastMessageId: null,
        lastMessageAt: null,
        contextType: input.context?.type ?? null,
        contextId: input.context?.id ?? null,
        archivedAt: null,
        members: input.memberIds.map((userId) => ({ userId, leftAt: null })),
      });
      return { id, created: true };
    },
    setContext: async (
      id: string,
      ctx: { type: string; id: string } | null,
    ) => {
      if (ctx && contextTaken(ctx.type, ctx.id)) return false;
      const c = conversations.get(id)!;
      c.contextType = ctx?.type ?? null;
      c.contextId = ctx?.id ?? null;
      return true;
    },
    addMembers: async (id: string, userIds: readonly string[]) => {
      const c = conversations.get(id)!;
      for (const userId of userIds) {
        const m = c.members.find((x) => x.userId === userId);
        if (m) m.leftAt = null;
        else c.members.push({ userId, leftAt: null });
      }
    },
    leave: async (id: string, userId: string) => {
      const c = conversations.get(id)!;
      for (const m of c.members) if (m.userId === userId) m.leftAt = new Date();
      const remaining = live(c).length;
      if (remaining === 0) c.archivedAt = new Date();
      return remaining;
    },
    createSystemMessage: async (input: {
      conversationId: string;
      actorUserId: string;
      text: string;
    }) => {
      const m = {
        id: `m${++n}`,
        conversationId: input.conversationId,
        senderUserId: input.actorUserId,
        type: "SYSTEM",
        text: input.text,
      };
      messages.push(m);
      return m;
    },
    members: async (id: string) =>
      (conversations.get(id)?.members ?? []).map((m) => ({
        ...m,
        notify: "ALL",
        mutedUntil: null,
      })),
    audit: async (input: {
      userId: string;
      action: string;
      conversationId: string;
      metadata: unknown;
    }) => void audits.push(input),
    worksheetForContext: async (id: string) => worksheets.get(id) ?? null,
    serviceJobForContext: async (id: string) => jobs.get(id) ?? null,
    unreadCounts: async () => new Map<string, number>(),
    messagesByIds: async () => [],
  };
  const events: string[] = [];
  const bus = new InMemoryMessageEventBus();
  const publish = bus.publish.bind(bus);
  bus.publish = (ids, e) => {
    events.push(`${e.type} -> ${[...ids].sort().join(",")}`);
    publish(ids, e);
  };
  const service = new MessagesService(
    repo as never,
    bus,
    { notifyNewMessage: (x: unknown) => void pushes.push(x) } as never,
    undefined as never,
  );
  return { service, repo, events, pushes };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

describe("the conversation of a worksheet or a service job", () => {
  it("from a worksheet: the starter and its mechanics, not the partner or the inactive; the name and a system line", async () => {
    const { service, repo, pushes } = fake();
    const detail = await service.openContextConversation(
      viewer("a"),
      "WORKSHEET",
      "ws1",
    );
    const conv = repo.conversations.get(detail.id)!;
    assert.deepEqual(conv.members.map((m) => m.userId).sort(), ["a", "b"]);
    assert.equal(conv.title, "BIO-2026-001 · Fővárosi Állatkert");
    assert.deepEqual([conv.contextType, conv.contextId], ["WORKSHEET", "ws1"]);
    assert.equal(
      repo.messages.at(-1)!.text,
      systemText.started("Teljes a", "WORKSHEET", "BIO-2026-001"),
    );
    assert.equal(repo.messages.at(-1)!.type, "SYSTEM");
    assert.equal(pushes.length, 0, "a system line sends no push");
    assert.deepEqual(detail.context, {
      type: "WORKSHEET",
      id: "ws1",
      number: "BIO-2026-001",
      restricted: false,
      partnerName: "Fővárosi Állatkert",
      status: "IN_PROGRESS",
      createdAt: "2026-10-05T08:00:00.000Z",
    });
  });

  it("from a service job: its assignee comes in", async () => {
    const { service, repo } = fake();
    const detail = await service.openContextConversation(
      viewer("a"),
      "SERVICE_JOB",
      "job1",
    );
    assert.deepEqual(
      repo.conversations
        .get(detail.id)!
        .members.map((m) => m.userId)
        .sort(),
      ["a", "c"],
    );
    assert.equal(detail.context?.status, "IN_PROGRESS");
    assert.equal(
      repo.messages.at(-1)!.text,
      "Teljes a beszélgetést indított ehhez a hibajegyhez: HJ-2026-007.",
    );
  });

  it("one live conversation per worksheet: the second press opens it and brings the asker in", async () => {
    const { service, repo } = fake();
    const first = await service.openContextConversation(
      viewer("a"),
      "WORKSHEET",
      "ws1",
    );
    const second = await service.openContextConversation(
      viewer("c"),
      "WORKSHEET",
      "ws1",
    );
    assert.equal(second.id, first.id);
    assert.equal(repo.conversations.size, 1);
    assert.ok(
      repo.conversations.get(first.id)!.members.some((m) => m.userId === "c"),
    );
    assert.equal(repo.messages.at(-1)!.text, systemText.joined("Teljes c"));
    const again = await service.openContextConversation(
      viewer("c"),
      "WORKSHEET",
      "ws1",
    );
    assert.equal(again.id, first.id);
    assert.equal(
      repo.messages.filter((m) => m.text === systemText.joined("Teljes c"))
        .length,
      1,
    );
  });

  it("without the service right: 403; a hidden or unknown worksheet: 404", async () => {
    const { service } = fake();
    assert.equal(
      await status(
        service.openContextConversation(
          viewer("raktar", "WAREHOUSE"),
          "WORKSHEET",
          "ws1",
        ),
      ),
      403,
    );
    assert.equal(
      await status(
        service.openContextConversation(viewer("a"), "WORKSHEET", "rejtett"),
      ),
      404,
    );
    assert.equal(
      await status(
        service.openContextConversation(viewer("a"), "WORKSHEET", "nincs"),
      ),
      404,
    );
  });

  it("a member without the service right sees only the number on the card", async () => {
    const { service } = fake();
    const detail = await service.openContextConversation(
      viewer("a"),
      "WORKSHEET",
      "ws1",
    );
    await service.addMembers(viewer("a"), detail.id, ["raktar"]);
    const card = (
      await service.detail(viewer("raktar", "WAREHOUSE"), detail.id)
    ).context;
    assert.deepEqual(card, {
      type: "WORKSHEET",
      id: "ws1",
      number: "BIO-2026-001",
      restricted: true,
      partnerName: null,
      status: null,
      createdAt: null,
    });
  });
});

describe("linking an existing group", () => {
  const group = async (f: ReturnType<typeof fake>) => {
    const { id } = await f.repo.createConversation({
      type: "GROUP",
      title: "Zoo szerviz",
      createdByUserId: "a",
      memberIds: ["a", "b"],
    });
    return id;
  };

  it("links with a line everyone sees, and is audited", async () => {
    const f = fake();
    const id = await group(f);
    const detail = await f.service.linkContext(viewer("b"), id, {
      type: "WORKSHEET",
      id: "ws1",
    });
    assert.equal(detail.context?.number, "BIO-2026-001");
    assert.equal(
      f.repo.messages.at(-1)!.text,
      "Teljes b ehhez a munkalaphoz kapcsolta a beszélgetést: BIO-2026-001.",
    );
    assert.ok(f.repo.audits.some((a) => a.action === "conversation.linked"));
  });

  it("a worksheet that already has a conversation: 409", async () => {
    const f = fake();
    await f.service.openContextConversation(viewer("a"), "WORKSHEET", "ws1");
    const id = await group(f);
    assert.equal(
      await status(
        f.service.linkContext(viewer("a"), id, {
          type: "WORKSHEET",
          id: "ws1",
        }),
      ),
      409,
    );
  });

  it("an already linked group is not relinked silently, even to a free worksheet: 409, the old link stays", async () => {
    const f = fake();
    const id = await group(f);
    await f.service.linkContext(viewer("a"), id, {
      type: "SERVICE_JOB",
      id: "job1",
    });
    // a ws1-nek NINCS beszélgetése: a 409 itt csak a „már kötött” szabályból jöhet
    assert.equal(
      await status(
        f.service.linkContext(viewer("a"), id, {
          type: "WORKSHEET",
          id: "ws1",
        }),
      ),
      409,
    );
    const conv = f.repo.conversations.get(id)!;
    assert.deepEqual(
      [conv.contextType, conv.contextId],
      ["SERVICE_JOB", "job1"],
    );
    // ugyanarra újra: nem hiba, és nem ír új sort
    const lines = f.repo.messages.length;
    await f.service.linkContext(viewer("a"), id, {
      type: "SERVICE_JOB",
      id: "job1",
    });
    assert.equal(f.repo.messages.length, lines);
  });

  it("a direct conversation cannot be linked; without the service right: 403", async () => {
    const f = fake();
    const { id } = await f.repo.createConversation({
      type: "DIRECT",
      title: null,
      createdByUserId: "a",
      memberIds: ["a", "b"],
    });
    assert.equal(
      await status(
        f.service.linkContext(viewer("a"), id, {
          type: "WORKSHEET",
          id: "ws1",
        }),
      ),
      400,
    );
    const g = await group(f);
    assert.equal(
      await status(
        f.service.linkContext(viewer("raktar", "WAREHOUSE"), g, {
          type: "WORKSHEET",
          id: "ws1",
        }),
      ),
      403,
    );
  });

  it("unlinking keeps the conversation, frees the worksheet, and says so", async () => {
    const f = fake();
    const opened = await f.service.openContextConversation(
      viewer("a"),
      "WORKSHEET",
      "ws1",
    );
    const after = await f.service.unlinkContext(viewer("a"), opened.id);
    assert.equal(after.context, null);
    assert.equal(
      f.repo.messages.at(-1)!.text,
      "Teljes a leválasztotta a beszélgetést erről a munkalapról: BIO-2026-001.",
    );
    const fresh = await f.service.openContextConversation(
      viewer("a"),
      "WORKSHEET",
      "ws1",
    );
    assert.notEqual(fresh.id, opened.id);
  });
});

describe("members: add and leave", () => {
  const group = async (f: ReturnType<typeof fake>) =>
    (
      await f.repo.createConversation({
        type: "GROUP",
        title: "Csoport",
        createdByUserId: "a",
        memberIds: ["a", "b"],
      })
    ).id;

  it("any member adds; the line names them; audited; the new member hears of the conversation", async () => {
    const f = fake();
    const id = await group(f);
    await f.service.addMembers(viewer("b"), id, ["c", "a"]);
    assert.ok(
      f.repo.conversations.get(id)!.members.some((m) => m.userId === "c"),
    );
    assert.equal(
      f.repo.messages.at(-1)!.text,
      "Teljes b új tagot adott hozzá: Teljes c.",
    );
    assert.deepEqual(f.repo.audits.at(-1), {
      userId: "b",
      action: "conversation.members_added",
      conversationId: id,
      metadata: { userIds: ["c"] },
    });
    assert.ok(f.events.includes("conversation.created -> c"));
  });

  it("no partner, no inactive, no one into a direct conversation, not by a non-member", async () => {
    const f = fake();
    const id = await group(f);
    assert.equal(
      await status(f.service.addMembers(viewer("a"), id, ["partner"])),
      400,
    );
    assert.equal(
      await status(f.service.addMembers(viewer("a"), id, ["inaktiv"])),
      400,
    );
    assert.equal(
      await status(f.service.addMembers(viewer("c"), id, ["c"])),
      404,
    );
    const { id: direct } = await f.repo.createConversation({
      type: "DIRECT",
      title: null,
      createdByUserId: "a",
      memberIds: ["a", "b"],
    });
    assert.equal(
      await status(f.service.addMembers(viewer("a"), direct, ["c"])),
      400,
    );
  });

  it("leaving: a line while still a member, audited; not from a direct one; the last one archives", async () => {
    const f = fake();
    const id = await group(f);
    assert.deepEqual(await f.service.leave(viewer("a"), id), {
      left: true,
      archived: false,
    });
    assert.equal(f.repo.messages.at(-1)!.text, systemText.left("Teljes a"));
    assert.ok(
      f.repo.audits.some((a) => a.action === "conversation.member_left"),
    );
    assert.deepEqual(await f.service.leave(viewer("b"), id), {
      left: true,
      archived: true,
    });
    assert.ok(f.repo.conversations.get(id)!.archivedAt);
    const { id: direct } = await f.repo.createConversation({
      type: "DIRECT",
      title: null,
      createdByUserId: "a",
      memberIds: ["a", "c"],
    });
    assert.equal(await status(f.service.leave(viewer("a"), direct)), 400);
  });
});

describe("the system lines", () => {
  it("the Hungarian forms: -hoz for munkalap, -hez for hibajegy, no case ending on names", () => {
    assert.equal(
      systemText.started("Kovács Anna", "WORKSHEET", "BIO-2026-001"),
      "Kovács Anna beszélgetést indított ehhez a munkalaphoz: BIO-2026-001.",
    );
    assert.equal(
      systemText.unlinked("Kovács Anna", "SERVICE_JOB", "HJ-1"),
      "Kovács Anna leválasztotta a beszélgetést erről a hibajegyről: HJ-1.",
    );
    assert.equal(
      systemText.added("Balázs", ["Kiss Dániel", "Nagy Péter"]),
      "Balázs új tagokat adott hozzá: Kiss Dániel, Nagy Péter.",
    );
  });
});
