import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { InMemoryMessageEventBus } from "./message-event-bus.js";
import { MessagesService, mayDeleteConversation } from "./messages.service.js";

/*
  A HIBAJEGY PARTNERES BESZÉLGETÉSE (kártya 084e2c24, a terv 2.5 pontja;
  Balázs, 2026-10-06 12:36 UTC: „Mehet az 1-2”). MI PIROSÍT:
  - a partner a hibajegy BELSŐ beszélgetéséből bármit lát, vagy a partneres
    beszélgetést olyan hibajegynél is olvashatja, amit nem lát;
  - a láthatóság nem a partner saját hatókörével és azonosítójával kérdez;
  - belső fiók a partner-útvonalon olvas vagy ír;
  - a partner tag lesz (a hozzáférése túlélné a hozzárendelését);
  - a partner nézete rendszerüzenetet, törölt üzenetet vagy belső azonosítót
    ad ki, vagy rossz oldalt ír a szerző mellé;
  - a partner üzenetére a belső kör nem kap pusht, vagy partner, inaktív,
    szervizt nem látó fiók kerül a körbe; a kikerülő tag után a beszélgetés
    archív lesz;
  - egy újraküldés második üzenetet hoz létre;
  - a belső oldalon a partneres beszélgetésbe tag adható, abból kilépni,
    azt át- vagy lekötni, abba továbbítani vagy csatolmányt feltölteni lehet;
  - a belső „Beszélgetés” gomb a partnereset adja, vagy fordítva.
*/

const user = (id: string, over: Partial<AuthenticatedUser> = {}) =>
  ({
    id,
    email: `${id}@example.invalid`,
    displayName: `Teljes ${id}`,
    nickname: null,
    role: "SERVICE",
    customerId: null,
    supplierId: null,
    ...over,
  }) as AuthenticatedUser;

const partnerUser = user("partner", {
  role: "PARTNER_SERVICE",
  customerId: "cust1",
});
const supplierUser = user("szallito", {
  role: "PARTNER_SERVICE",
  supplierId: "sup1",
});

type Audience = "INTERNAL" | "PARTNER";
type Conv = {
  id: string;
  type: "DIRECT" | "GROUP";
  audience: Audience;
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
type Msg = {
  id: string;
  conversationId: string;
  senderUserId: string;
  type: string;
  text: string | null;
  clientMessageId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  sender: { displayName: string; nickname: string | null };
  attachments: never[];
  reactions: never[];
  pins: never[];
  replyTo: null;
  replyToMessageId: null;
  forwardedFromMessageId: null;
  forwardedFromUserId: null;
  forwardedFromUser: null;
  assistantSource: null;
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
  const people = new Map(
    [
      person("a"),
      person("b"),
      person("vezeto", { role: "MANAGER" }),
      person("raktar", { role: "WAREHOUSE" }),
      person("inaktiv", { isActive: false }),
      person("partner", { role: "PARTNER_SERVICE", customerId: "cust1" }),
      person("szallito", { role: "PARTNER_SERVICE", supplierId: "sup1" }),
    ].map((p) => [p.id, p]),
  );
  // a hibajegy köre, ahogy a tároló adja (a delegáltak, vagy delegált nélkül a
  // „hibajegy nyílt” szerep); a szolgáltatás ebből is kiszűri a partnert és az
  // inaktívat
  let staff = ["a", "b", "inaktiv", "partner"];
  const staffAsks: string[] = [];
  const conversations = new Map<string, Conv>();
  const messages: Msg[] = [];
  const audits: {
    action: string;
    conversationId: string;
    metadata: unknown;
  }[] = [];
  const pushes: { userIds: string[] }[] = [];
  const visibilityAsks: unknown[] = [];
  const visible = new Set(["job1"]);
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
  const byContext = (type: string, id: string, audience: Audience) =>
    [...conversations.values()].find(
      (c) =>
        c.contextType === type &&
        c.contextId === id &&
        c.audience === audience &&
        !c.archivedAt,
    );
  const message = (over: Partial<Msg> & { conversationId: string }): Msg => {
    const sender = people.get(over.senderUserId ?? "a")!;
    const m: Msg = {
      id: `m${++n}`,
      senderUserId: "a",
      type: "TEXT",
      text: "szöveg",
      clientMessageId: null,
      createdAt: new Date(Date.UTC(2026, 9, 6, 12, 0, n)),
      editedAt: null,
      deletedAt: null,
      sender: { displayName: sender.displayName, nickname: null },
      attachments: [],
      reactions: [],
      pins: [],
      replyTo: null,
      replyToMessageId: null,
      forwardedFromMessageId: null,
      forwardedFromUserId: null,
      forwardedFromUser: null,
      assistantSource: null,
      ...over,
    };
    messages.push(m);
    return m;
  };
  const newConv = (over: Partial<Conv>): Conv => {
    const c: Conv = {
      id: `conv${++n}`,
      type: "GROUP",
      audience: "INTERNAL",
      title: null,
      description: null,
      createdByUserId: "a",
      lastMessageId: null,
      lastMessageAt: null,
      contextType: null,
      contextId: null,
      archivedAt: null,
      members: [],
      ...over,
    };
    conversations.set(c.id, c);
    return c;
  };

  const repo = {
    users: async (ids: readonly string[]) =>
      ids.flatMap((id) => (people.has(id) ? [people.get(id)!] : [])),
    partnerConversationStaff: async (jobId: string) => {
      staffAsks.push(jobId);
      return staff.map((id) => people.get(id)!);
    },
    serviceJobVisibleToPartner: async (id: string, input: unknown) => {
      visibilityAsks.push({ id, ...(input as object) });
      return visible.has(id)
        ? { id, jobNumber: "HJ-2026-007", customer: { displayName: "FANK" } }
        : null;
    },
    serviceJobForContext: async (id: string) =>
      id === "job1"
        ? {
            id,
            jobNumber: "HJ-2026-007",
            status: "IN_PROGRESS",
            createdAt: new Date("2026-10-04T10:00:00Z"),
            assignedUserId: "a",
            customer: { displayName: "FANK" },
          }
        : null,
    conversationByContext: async (
      type: string,
      id: string,
      audience: Audience = "INTERNAL",
    ) => byContext(type, id, audience)?.id ?? null,
    createConversation: async (input: {
      type: "DIRECT" | "GROUP";
      title: string | null;
      createdByUserId: string;
      memberIds: readonly string[];
      context?: { type: string; id: string } | null;
      audience?: Audience;
    }) => {
      const audience = input.audience ?? "INTERNAL";
      const taken =
        input.context &&
        byContext(input.context.type, input.context.id, audience);
      if (taken) return { id: taken.id, created: false };
      const c = newConv({
        type: input.type,
        audience,
        title: input.title,
        createdByUserId: input.createdByUserId,
        contextType: input.context?.type ?? null,
        contextId: input.context?.id ?? null,
        members: input.memberIds.map((userId) => ({ userId, leftAt: null })),
      });
      return { id: c.id, created: true };
    },
    conversation: async (id: string) => {
      const c = conversations.get(id);
      return c ? row(c) : null;
    },
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
    members: async (id: string) =>
      (conversations.get(id)?.members ?? []).map((m) => ({
        ...m,
        notify: "ALL" as const,
        mutedUntil: null,
      })),
    addMembers: async (id: string, userIds: readonly string[]) => {
      const c = conversations.get(id)!;
      for (const userId of userIds) {
        const m = c.members.find((x) => x.userId === userId);
        if (m) m.leftAt = null;
        else c.members.push({ userId, leftAt: null });
      }
    },
    removeMembers: async (id: string, userIds: readonly string[]) => {
      const c = conversations.get(id)!;
      for (const m of c.members)
        if (userIds.includes(m.userId) && m.leftAt === null)
          m.leftAt = new Date();
    },
    leave: async () => {
      throw new Error("a partneres beszélgetésből nem szabad kilépni");
    },
    setContext: async () => {
      throw new Error("a partneres beszélgetés kötése nem változhat");
    },
    messagesPage: async (input: {
      conversationId: string;
      before: { createdAt: Date; id: string } | null;
      limit: number;
    }) => {
      const rows = messages
        .filter((m) => m.conversationId === input.conversationId)
        .filter((m) => !input.before || m.createdAt < input.before.createdAt)
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
      return {
        rows: rows.slice(0, input.limit),
        hasOlder: rows.length > input.limit,
      };
    },
    partnerConversationWriters: async (conversationId: string) =>
      [
        ...new Set(
          messages
            .filter(
              (m) => m.conversationId === conversationId && m.type !== "SYSTEM",
            )
            .map((m) => m.senderUserId),
        ),
      ]
        .map((id) => people.get(id)!)
        .filter((p) => p.isActive && !p.customerId && !p.supplierId),
    message: async (id: string) => messages.find((m) => m.id === id) ?? null,
    messageByClientId: async (senderUserId: string, clientMessageId: string) =>
      messages.find(
        (m) =>
          m.senderUserId === senderUserId &&
          m.clientMessageId === clientMessageId,
      ) ?? null,
    createMessage: async (input: {
      conversationId: string;
      senderUserId: string;
      text: string | null;
      clientMessageId: string;
    }) => message(input),
    createSystemMessage: async (input: {
      conversationId: string;
      actorUserId: string;
      text: string;
    }) =>
      message({
        conversationId: input.conversationId,
        senderUserId: input.actorUserId,
        type: "SYSTEM",
        text: input.text,
      }),
    audit: async (input: {
      action: string;
      conversationId: string;
      metadata: unknown;
    }) => void audits.push(input),
    deleteConversation: async () => {
      throw new Error("a partneres beszélgetés nem törölhető");
    },
    unreadCounts: async () => new Map<string, number>(),
    unreadTotals: async () => ({}),
    messagesByIds: async () => [],
  };
  const bus = new InMemoryMessageEventBus();
  const events: { to: string[]; type: string; conversationId: string }[] = [];
  const publish = bus.publish.bind(bus);
  bus.publish = (ids, event) => {
    events.push({
      to: [...ids].sort(),
      type: event.type,
      conversationId: (event as { conversationId: string }).conversationId,
    });
    publish(ids, event);
  };
  const service = new MessagesService(
    repo as never,
    bus,
    {
      notifyNewMessage: (x: { userIds: string[] }) => void pushes.push(x),
    } as never,
    undefined as never,
  );
  return {
    service,
    events,
    conversations,
    messages,
    audits,
    pushes,
    visibilityAsks,
    visible,
    message,
    newConv,
    staffAsks,
    setStaff: (ids: string[]) => {
      staff = ids;
    },
  };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

const send = (
  f: ReturnType<typeof fake>,
  text: string,
  clientMessageId = `kliens-${text.length}-${f.messages.length}`,
  who: AuthenticatedUser = partnerUser,
) => f.service.sendAsPartner(who, "job1", { text, clientMessageId });

describe("the partner's view of a service job conversation", () => {
  it("never shows the job's INTERNAL conversation: only the PARTNER one bound to this job", async () => {
    const f = fake();
    const internal = f.newConv({
      contextType: "SERVICE_JOB",
      contextId: "job1",
      members: [{ userId: "a", leftAt: null }],
    });
    f.message({
      conversationId: internal.id,
      text: "belső: a partner ne lássa",
    });

    assert.deepEqual(
      await f.service.partnerConversation(partnerUser, "job1", {}),
      { items: [], olderCursor: null },
    );

    await send(f, "Mikor jön a szerelő?");
    const page = await f.service.partnerConversation(partnerUser, "job1", {});
    assert.deepEqual(
      page.items.map((m) => m.text),
      ["Mikor jön a szerelő?"],
    );
    const partnerConv = [...f.conversations.values()].find(
      (c) => c.audience === "PARTNER",
    )!;
    assert.notEqual(partnerConv.id, internal.id);
    assert.equal(partnerConv.contextType, "SERVICE_JOB");
    assert.equal(partnerConv.contextId, "job1");
  });

  it("asks visibility with the partner's own scope and id, on every call; a job it does not see is 404", async () => {
    const f = fake();
    await f.service.partnerConversation(partnerUser, "job1", {});
    await send(f, "Szia");
    await f.service.partnerConversation(supplierUser, "job1", {});
    assert.deepEqual(f.visibilityAsks, [
      {
        id: "job1",
        scope: { kind: "customer", customerId: "cust1" },
        userId: "partner",
      },
      {
        id: "job1",
        scope: { kind: "customer", customerId: "cust1" },
        userId: "partner",
      },
      {
        id: "job1",
        scope: { kind: "supplier", supplierId: "sup1" },
        userId: "szallito",
      },
    ]);

    f.visible.delete("job1");
    assert.equal(
      await status(f.service.partnerConversation(partnerUser, "job1", {})),
      404,
    );
    assert.equal(await status(send(f, "még itt vagyok?")), 404);
  });

  it("an internal account cannot use the partner route, neither to read nor to write", async () => {
    const f = fake();
    assert.equal(
      await status(f.service.partnerConversation(user("a"), "job1", {})),
      403,
    );
    assert.equal(
      await status(send(f, "belsőként", "kliens-0001", user("a"))),
      403,
    );
    assert.equal(f.conversations.size, 0);
  });

  it("the partner never becomes a member: its access is the job's, not a membership", async () => {
    const f = fake();
    await send(f, "Szia");
    const conv = [...f.conversations.values()][0]!;
    assert.ok(!conv.members.some((m) => m.userId === "partner"));
  });

  it("shows only live text: no system line, no deleted message, and only id, text, times, side, name, mine", async () => {
    const f = fake();
    await send(f, "Partner kérdése");
    const conv = [...f.conversations.values()][0]!;
    f.message({
      conversationId: conv.id,
      type: "SYSTEM",
      text: "a csatlakozott",
    });
    f.message({
      conversationId: conv.id,
      senderUserId: "b",
      text: "törölt",
      deletedAt: new Date(),
    });
    f.message({
      conversationId: conv.id,
      senderUserId: "b",
      text: "Holnap megyünk.",
    });

    const page = await f.service.partnerConversation(partnerUser, "job1", {});
    assert.deepEqual(
      page.items.map(({ text, side, authorName, mine }) => ({
        text,
        side,
        authorName,
        mine,
      })),
      [
        {
          text: "Partner kérdése",
          side: "PARTNER",
          authorName: "Teljes partner",
          mine: true,
        },
        {
          text: "Holnap megyünk.",
          side: "ACROPORA",
          authorName: "Teljes b",
          mine: false,
        },
      ],
    );
    assert.deepEqual(Object.keys(page.items[0]!).sort(), [
      "authorName",
      "createdAt",
      "editedAt",
      "id",
      "mine",
      "side",
      "text",
    ]);
  });
});

describe("the partner's message", () => {
  it("brings in this job's circle (active, internal only) and pushes to them, not to the partner", async () => {
    const f = fake();
    await send(f, "Elromlott a szivattyú");
    assert.deepEqual(f.staffAsks, ["job1"]);
    const conv = [...f.conversations.values()][0]!;
    assert.equal(conv.audience, "PARTNER");
    assert.deepEqual(
      conv.members
        .filter((m) => !m.leftAt)
        .map((m) => m.userId)
        .sort(),
      ["a", "b"],
    );
    assert.deepEqual(f.pushes.at(-1)!.userIds.sort(), ["a", "b"]);
  });

  it("the circle is recounted at every message: a new delegate joins, the old one and a mere opener are out, and the conversation stays live", async () => {
    const f = fake();
    f.setStaff(["a"]);
    await send(f, "első");
    const conv = [...f.conversations.values()][0]!;
    await f.service.openPartnerConversation(
      user("vezeto", { role: "MANAGER" }),
      "job1",
    );
    assert.deepEqual(
      conv.members
        .filter((m) => !m.leftAt)
        .map((m) => m.userId)
        .sort(),
      ["a", "vezeto"],
    );

    // a hibajegyet „b”-re delegálták át
    f.setStaff(["b"]);
    f.events.length = 0;
    await send(f, "második");
    // a kiesők listájáról push nélkül tűnik el (ugyanaz az esemény, mint a törlésnél)
    assert.deepEqual(
      f.events.filter((e) => e.type === "conversation.deleted"),
      [
        {
          to: ["a", "vezeto"],
          type: "conversation.deleted",
          conversationId: conv.id,
        },
      ],
    );
    assert.deepEqual(
      conv.members.filter((m) => !m.leftAt).map((m) => m.userId),
      ["b"],
    );
    assert.deepEqual(f.pushes.at(-1)!.userIds, ["b"]);

    f.setStaff([]);
    await send(f, "harmadik");
    assert.equal(conv.archivedAt, null);
  });

  it("whoever wrote in it from our side stays in the circle after a re-delegation (acrobot, 15:29)", async () => {
    const f = fake();
    f.setStaff(["a"]);
    await send(f, "első");
    const conv = [...f.conversations.values()][0]!;
    const manager = user("vezeto", { role: "MANAGER" });
    await f.service.openPartnerConversation(manager, "job1");
    await f.service.send(manager, conv.id, {
      text: "Holnap délelőtt ott leszünk.",
      clientMessageId: "kliens-vezeto-1",
    });

    f.setStaff(["b"]);
    await send(f, "Köszönjük, várjuk.");
    assert.deepEqual(
      conv.members
        .filter((m) => !m.leftAt)
        .map((m) => m.userId)
        .sort(),
      ["b", "vezeto"],
    );
    assert.deepEqual(f.pushes.at(-1)!.userIds.sort(), ["b", "vezeto"]);
  });

  it("a resend with the same client id returns the same message, and an empty text is refused", async () => {
    const f = fake();
    const first = await send(f, "Szia", "kliens-azonos");
    const again = await send(f, "Szia", "kliens-azonos");
    assert.equal(again.id, first.id);
    assert.equal(f.messages.length, 1);
    assert.equal(await status(send(f, "   ")), 400);
  });
});

describe("the partner conversation on the internal side", () => {
  it("„Beszélgetés a partnerrel” opens the PARTNER one, apart from the internal „Beszélgetés”, and the opener joins", async () => {
    const f = fake();
    const internal = await f.service.openContextConversation(
      user("vezeto", { role: "MANAGER" }),
      "SERVICE_JOB",
      "job1",
    );
    const partner = await f.service.openPartnerConversation(
      user("vezeto", { role: "MANAGER" }),
      "job1",
    );
    assert.notEqual(partner.id, internal.id);
    assert.equal(partner.audience, "PARTNER");
    assert.equal(f.conversations.get(internal.id)!.audience, "INTERNAL");
    assert.deepEqual(
      f.conversations
        .get(partner.id)!
        .members.map((m) => m.userId)
        .sort(),
      ["a", "b", "vezeto"],
    );
    const again = await f.service.openPartnerConversation(user("b"), "job1");
    assert.equal(again.id, partner.id);
    assert.equal(
      await status(f.service.openPartnerConversation(partnerUser, "job1")),
      403,
    );
  });

  it("nobody can delete it, neither its creator nor an admin (acrobot, 15:46)", async () => {
    const f = fake();
    const opener = user("a");
    const { id } = await f.service.openPartnerConversation(opener, "job1");
    assert.equal(f.conversations.get(id)!.createdByUserId, "a");
    const admin = user("b", { role: "ADMIN" });
    // a mondat a partneres beszélgetésről szól, nem a „csak a létrehozója vagy
    // admin” szabályról: itt a létrehozó és az admin sem törölheti
    for (const who of [opener, admin])
      await assert.rejects(
        f.service.deleteConversation(who, id),
        (error: unknown) =>
          (error as { getStatus?: () => number }).getStatus?.() === 403 &&
          /partneres beszélgetés nem törölhető/.test((error as Error).message),
      );
    assert.equal(f.conversations.get(id)!.archivedAt, null);
    const row = { type: "GROUP", createdByUserId: "a", members: [] };
    assert.equal(
      mayDeleteConversation(admin, { ...row, audience: "PARTNER" }),
      false,
    );
    assert.equal(
      mayDeleteConversation(opener, { ...row, audience: "PARTNER" }),
      false,
    );
    // a kontroll: ugyanez belső beszélgetésnél törölhető
    assert.equal(
      mayDeleteConversation(admin, { ...row, audience: "INTERNAL" }),
      true,
    );
  });

  it("its members and binding are fixed: no adding, leaving, relinking, unlinking, forwarding into it, or attachment", async () => {
    const f = fake();
    const { id } = await f.service.openPartnerConversation(user("a"), "job1");
    const other = f.newConv({
      members: [{ userId: "a", leftAt: null }],
    });
    const source = f.message({ conversationId: other.id, text: "belső titok" });

    assert.equal(
      await status(f.service.addMembers(user("a"), id, ["vezeto"])),
      400,
    );
    assert.equal(await status(f.service.leave(user("a"), id)), 400);
    assert.equal(
      await status(
        f.service.linkContext(user("a"), id, {
          type: "SERVICE_JOB",
          id: "job1",
        }),
      ),
      400,
    );
    assert.equal(await status(f.service.unlinkContext(user("a"), id)), 400);
    assert.equal(
      await status(
        f.service.forward(user("a"), source.id, {
          conversationId: id,
          clientMessageId: "kliens-tovabb",
        }),
      ),
      400,
    );
    assert.equal(
      await status(
        f.service.uploadAttachment(user("a"), id, {
          originalname: "a.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("x"),
        }),
      ),
      400,
    );
    assert.ok(
      !f.messages.some(
        (m) => m.conversationId === id && m.text === "belső titok",
      ),
    );
  });
});
