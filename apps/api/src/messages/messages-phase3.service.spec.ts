import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import type { DocumentKey } from "../service-assets/document-store/document-store.js";
import { InMemoryMessageEventBus } from "./message-event-bus.js";
import { AttachmentBindingError } from "./messages.repository.js";
import {
  encodeCursor,
  messageSearchPattern,
  notificationUpdate,
  searchSnippet,
} from "./messages.rules.js";
import { MessagesService, pinnedTitle } from "./messages.service.js";

/*
  AZ ÜZENETEK 3. FÁZISA (terv: agents/murena/megosztas/uzenetek-3-fazis-terv.md;
  Balázs válaszai 2026-10-05 15:07 UTC). MI PIROSÍT:
  - keresés: nem tag keres; a „%” joker marad; ékezetes szöveg nem jön elő
    ékezet nélküli kereséssel a környezetben; a túl rövid keresés átmegy;
  - ugrás: másik beszélgetés üzenete köré nyit; a cél kimarad; a kurzorok
    hamisan jeleznek folytatást;
  - megosztott tartalom: rossz kurzor átmegy;
  - értesítés: a „holnap reggel” nem budapesti 8 óra; a némítás a `notify`-t
    is átírja; a lejárt némítás némításnak látszik;
  - kitűzés: nem tag kitűz; törölt üzenet kitűzhető; kétszeri kitűzés kétszer
    naplóz; csak a szerző veheti le;
  - továbbítás: valamelyik tagság nélkül megy; törölt üzenet továbbítható; az
    eredeti szerző elveszik vagy a köztes továbbítóra cserélődik; a csatolmány
    közös kulcsra mutat ahelyett, hogy a cél beszélgetés kulcsára másolódna;
    egy újraküldés duplikál.
*/

const viewer = (id: string) =>
  ({
    id,
    email: `${id}@x.invalid`,
    displayName: `Teljes ${id}`,
    nickname: null,
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  }) as AuthenticatedUser;

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);

type Msg = {
  id: string;
  conversationId: string;
  senderUserId: string;
  type: string;
  text: string | null;
  clientMessageId: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  forwardedFromMessageId: string | null;
  forwardedFromUserId: string | null;
};

type Att = {
  id: string;
  conversationId: string;
  uploadedByUserId: string;
  messageId: string | null;
  kind: "IMAGE" | "FILE";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  thumbnailKey: string | null;
  createdAt: Date;
};

const name = (id: string) => ({ displayName: `Teljes ${id}`, nickname: null });

function fake() {
  const members: Record<string, string[]> = {
    c1: ["a", "b"],
    c2: ["a", "c"],
    c3: ["b", "c"],
  };
  const messages: Msg[] = [];
  const attachments: Att[] = [];
  const pins: {
    conversationId: string;
    messageId: string;
    userId: string;
    createdAt: Date;
  }[] = [];
  const audits: string[] = [];
  const searched: { pattern: string; limit: number; cap: number }[] = [];
  const notifySaved: Record<
    string,
    { notify: "ALL" | "MENTIONS" | "NONE"; mutedUntil: Date | null }
  > = {};
  const stored = new Map<string, Uint8Array>();
  const keyOf = (k: DocumentKey) => `${k.owner}/${k.ownerId}/${k.documentId}`;
  let n = 0;

  const row = (m: Msg) => ({
    ...m,
    sender: name(m.senderUserId),
    attachments: attachments.filter((a) => a.messageId === m.id),
    reactions: [],
    replyTo: null,
    pins: pins
      .filter((p) => p.messageId === m.id)
      .map((_, i) => ({ id: `p${i}` })),
    forwardedFromUser: m.forwardedFromUserId
      ? name(m.forwardedFromUserId)
      : null,
  });
  const byTime = (x: Msg, y: Msg) =>
    x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id);
  const inConv = (c: string) =>
    messages.filter((m) => m.conversationId === c).sort(byTime);
  const before = (m: Msg, at: { createdAt: Date; id: string }) =>
    byTime(m, { ...m, createdAt: at.createdAt, id: at.id }) < 0;

  const add = (
    over: Partial<Msg> & { conversationId: string; senderUserId: string },
  ) => {
    const id = over.id ?? `m${++n}`;
    const m: Msg = {
      type: "TEXT",
      text: null,
      clientMessageId: null,
      replyToMessageId: null,
      createdAt: new Date(1_000_000 + messages.length * 1000),
      editedAt: null,
      deletedAt: null,
      forwardedFromMessageId: null,
      forwardedFromUserId: null,
      ...over,
      id,
    };
    messages.push(m);
    return m;
  };

  const repo = {
    audits,
    searched,
    pins,
    attachments,
    notifySaved,
    activeMembership: async (c: string, u: string) =>
      members[c]?.includes(u)
        ? {
            joinedAt: new Date(0),
            lastReadAt: null,
            lastReadMessageId: null,
            notify: notifySaved[`${c}:${u}`]?.notify ?? "ALL",
            mutedUntil: notifySaved[`${c}:${u}`]?.mutedUntil ?? null,
          }
        : null,
    messageByClientId: async (u: string, client: string) => {
      const m = messages.find(
        (x) => x.senderUserId === u && x.clientMessageId === client,
      );
      return m ? row(m) : null;
    },
    messageInConversation: async (c: string, id: string) => {
      const m = messages.find((x) => x.id === id && x.conversationId === c);
      return m ? { id: m.id, createdAt: m.createdAt } : null;
    },
    messagesByIds: async (ids: readonly string[]) =>
      messages.filter((m) => ids.includes(m.id)).map(row),
    messagesPage: async (input: {
      conversationId: string;
      before: { createdAt: Date; id: string } | null;
      limit: number;
    }) => {
      const older = inConv(input.conversationId)
        .filter((m) => !input.before || before(m, input.before))
        .reverse();
      return {
        rows: older.slice(0, input.limit).map(row),
        hasOlder: older.length > input.limit,
      };
    },
    messagesAfter: async (input: {
      conversationId: string;
      after: { createdAt: Date; id: string };
      limit: number;
    }) => {
      const newer = inConv(input.conversationId).filter(
        (m) => !before(m, input.after) && m.id !== input.after.id,
      );
      return {
        rows: newer.slice(0, input.limit).map(row),
        hasNewer: newer.length > input.limit,
      };
    },
    searchMessages: async (input: {
      conversationId: string;
      pattern: string;
      limit: number;
      cap: number;
    }) => {
      searched.push({
        pattern: input.pattern,
        limit: input.limit,
        cap: input.cap,
      });
      const needle = input.pattern.slice(1, -1).toLowerCase();
      const hits = inConv(input.conversationId)
        .reverse()
        .filter(
          (m) => !m.deletedAt && (m.text ?? "").toLowerCase().includes(needle),
        );
      return {
        ids: hits.slice(0, input.limit).map((m) => m.id),
        total: Math.min(hits.length, input.cap),
      };
    },
    sharedAttachments: async () => ({ rows: [], hasOlder: false }),
    unreadTotals: async (ids: readonly string[]) =>
      Object.fromEntries(ids.map((id, i) => [id, i + 2])),
    setNotification: async (
      c: string,
      u: string,
      data: { notify?: "ALL"; mutedUntil: Date | null },
    ) => {
      const now = notifySaved[`${c}:${u}`] ?? {
        notify: "MENTIONS" as const,
        mutedUntil: null,
      };
      notifySaved[`${c}:${u}`] = {
        notify: data.notify ?? now.notify,
        mutedUntil: data.mutedUntil,
      };
      return notifySaved[`${c}:${u}`]!;
    },
    message: async (id: string) => {
      const m = messages.find((x) => x.id === id);
      return m ? row(m) : null;
    },
    pin: async (input: {
      conversationId: string;
      messageId: string;
      userId: string;
    }) => {
      if (
        pins.some(
          (p) =>
            p.conversationId === input.conversationId &&
            p.messageId === input.messageId,
        )
      )
        return false;
      pins.push({ ...input, createdAt: new Date() });
      return true;
    },
    unpin: async (c: string, id: string) => {
      const i = pins.findIndex(
        (p) => p.conversationId === c && p.messageId === id,
      );
      if (i < 0) return false;
      pins.splice(i, 1);
      return true;
    },
    members: async (c: string) =>
      (members[c] ?? []).map((userId) => ({
        userId,
        leftAt: null,
        notify: "ALL",
        mutedUntil: null,
      })),
    conversation: async (id: string) => ({
      id,
      type: "DIRECT",
      audience: "INTERNAL",
      title: null,
      description: null,
      createdByUserId: "a",
      lastMessageId: null,
      lastMessageAt: null,
      members: [],
    }),
    unreadCounts: async () => new Map<string, number>(),
    audit: async (input: {
      action: string;
      conversationId: string;
      metadata: unknown;
    }) =>
      void audits.push(
        `${input.action} ${input.conversationId} ${JSON.stringify(input.metadata)}`,
      ),
    documentBytesInUse: async () => 0,
    createAttachment: async (
      input: Omit<Att, "messageId" | "createdAt"> & { sha256: string },
    ) => {
      attachments.push({ ...input, messageId: null, createdAt: new Date() });
      return input;
    },
    attachmentsForSend: async (ids: readonly string[]) =>
      attachments.filter((a) => ids.includes(a.id)),
    createMessage: async (input: {
      conversationId: string;
      senderUserId: string;
      text: string | null;
      clientMessageId: string;
      type?: string;
      attachmentIds?: readonly string[];
      forwardedFrom?: { messageId: string; userId: string } | null;
    }) => {
      const bindable = attachments.filter(
        (a) =>
          input.attachmentIds?.includes(a.id) &&
          a.conversationId === input.conversationId &&
          a.uploadedByUserId === input.senderUserId &&
          a.messageId === null,
      );
      if (bindable.length !== (input.attachmentIds?.length ?? 0))
        throw new AttachmentBindingError();
      const m = add({
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        type: input.type ?? "TEXT",
        text: input.text,
        clientMessageId: input.clientMessageId,
        forwardedFromMessageId: input.forwardedFrom?.messageId ?? null,
        forwardedFromUserId: input.forwardedFrom?.userId ?? null,
      });
      for (const a of bindable) a.messageId = m.id;
      return row(m);
    },
  };
  const store = {
    stored,
    put: async (k: DocumentKey, bytes: Uint8Array) =>
      void stored.set(keyOf(k), bytes),
    get: async (k: DocumentKey) => stored.get(keyOf(k)) ?? null,
    delete: async (k: DocumentKey) => stored.delete(keyOf(k)),
    describe: async () => ({ state: "ready" as const }),
  };
  const events: string[] = [];
  const bus = new InMemoryMessageEventBus();
  const publish = bus.publish.bind(bus);
  bus.publish = (ids, e) => {
    events.push(`${e.type} -> ${[...ids].sort().join(",")}`);
    publish(ids, e);
  };
  const pushes: {
    userIds: readonly string[];
    badges?: Record<string, number>;
  }[] = [];
  const service = new MessagesService(
    repo as never,
    bus,
    {
      notifyNewMessage: (notice: (typeof pushes)[number]) =>
        void pushes.push(notice),
    } as never,
    store as never,
  );
  return { service, repo, store, events, add, messages, pushes };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

describe("the search rules", () => {
  it("escapes the wildcards, so 100% means 100%", () => {
    assert.equal(messageSearchPattern(" 100%_a\\b "), "%100\\%\\_a\\\\b%");
  });

  it("the snippet finds the match without accents and cuts with an ellipsis", () => {
    const text = `${"x".repeat(60)} a tartalék kötél a raktárban van ${"y".repeat(60)}`;
    const snippet = searchSnippet(text, "kotel", 10);
    assert.match(snippet, /^….*kötél.*…$/);
    assert.ok(snippet.includes("tartalék kötél a ra"), snippet);
  });

  it("the start and the end get no ellipsis; a short text is whole", () => {
    assert.equal(
      searchSnippet("Szia, megérkezett a pumpa?", "szia", 40),
      "Szia, megérkezett a pumpa?",
    );
    assert.equal(searchSnippet("ab\n\ncd", "zz", 40), "ab cd");
  });
});

describe("the notification modes", () => {
  const at = (iso: string) => new Date(iso);

  it("Minden új üzenet sets ALL and lifts the mute; Némítás feloldása lifts only the mute", () => {
    assert.deepEqual(notificationUpdate("ALL", at("2026-10-05T10:00:00Z")), {
      notify: "ALL",
      mutedUntil: null,
    });
    assert.deepEqual(notificationUpdate("UNMUTE", at("2026-10-05T10:00:00Z")), {
      mutedUntil: null,
    });
  });

  it("one hour is one hour", () => {
    assert.equal(
      notificationUpdate(
        "MUTE_1H",
        at("2026-10-05T10:00:00Z"),
      ).mutedUntil?.toISOString(),
      "2026-10-05T11:00:00.000Z",
    );
  });

  it("until the morning: the next 08:00 in Budapest, summer and winter and the night the clock turns", () => {
    const morning = (iso: string) =>
      notificationUpdate(
        "MUTE_UNTIL_MORNING",
        at(iso),
      ).mutedUntil?.toISOString();
    // 23:30 CEST -> next day 08:00 CEST
    assert.equal(morning("2026-10-05T21:30:00Z"), "2026-10-06T06:00:00.000Z");
    // 00:30 CEST: the morning of the same day, not a 31-hour mute
    assert.equal(morning("2026-10-05T22:30:00Z"), "2026-10-06T06:00:00.000Z");
    // 08:00 sharp CEST: tomorrow
    assert.equal(morning("2026-10-06T06:00:00Z"), "2026-10-07T06:00:00.000Z");
    // winter, 11:00 CET -> next day 08:00 CET
    assert.equal(morning("2026-11-10T10:00:00Z"), "2026-11-11T07:00:00.000Z");
    // Saturday 14:00 CEST; Sunday 25 October the clock goes back: 08:00 CET
    assert.equal(morning("2026-10-24T12:00:00Z"), "2026-10-25T07:00:00.000Z");
  });
});

describe("search in the open conversation", () => {
  it("a member gets the hits, newest first, with the snippet; the count says if it was capped", async () => {
    const { service, repo, add } = fake();
    add({
      conversationId: "c1",
      senderUserId: "a",
      text: "Megérkezett már a Zoo-s pumpa?",
    });
    add({
      conversationId: "c1",
      senderUserId: "b",
      text: "A pumpa holnap reggel megy.",
    });
    add({
      conversationId: "c1",
      senderUserId: "b",
      text: "Ez nem az.",
      deletedAt: null,
    });
    add({ conversationId: "c2", senderUserId: "a", text: "pumpa máshol" });
    const result = await service.search(viewer("a"), "c1", " pumpa ");
    assert.deepEqual(
      result.items.map((hit) => [hit.messageId, hit.senderName]),
      [
        ["m2", "Teljes b"],
        ["m1", "Teljes a"],
      ],
    );
    assert.equal(result.items[1]!.snippet, "Megérkezett már a Zoo-s pumpa?");
    assert.deepEqual([result.total, result.totalCapped], [2, false]);
    assert.equal(repo.searched[0]!.pattern, "%pumpa%");
  });

  it("not a member: 404; a one-letter search: 400", async () => {
    const { service } = fake();
    assert.equal(await status(service.search(viewer("c"), "c1", "pumpa")), 404);
    assert.equal(await status(service.search(viewer("a"), "c1", " p ")), 400);
  });
});

describe("the jump (around and after)", () => {
  const seed = () => {
    const f = fake();
    for (let i = 1; i <= 9; i += 1)
      f.add({ conversationId: "c1", senderUserId: "a", text: `t${i}` });
    f.add({ conversationId: "c2", senderUserId: "a", text: "másik" });
    return f;
  };

  it("opens around the target, both ways, with cursors only where more is left", async () => {
    const { service } = seed();
    const page = await service.messages(viewer("a"), "c1", {
      around: "m5",
      limit: 5,
    });
    assert.deepEqual(
      page.items.map((m) => m.id),
      ["m3", "m4", "m5", "m6", "m7"],
    );
    assert.ok(page.olderCursor);
    assert.ok(page.newerCursor);

    const newer = await service.messages(viewer("a"), "c1", {
      after: page.newerCursor!,
      limit: 5,
    });
    assert.deepEqual(
      newer.items.map((m) => m.id),
      ["m8", "m9"],
    );
    assert.equal(newer.newerCursor, null);

    const older = await service.messages(viewer("a"), "c1", {
      before: page.olderCursor!,
      limit: 5,
    });
    assert.deepEqual(
      older.items.map((m) => m.id),
      ["m1", "m2"],
    );
  });

  it("near the start: no older cursor", async () => {
    const { service } = seed();
    const page = await service.messages(viewer("a"), "c1", {
      around: "m1",
      limit: 5,
    });
    assert.deepEqual(
      page.items.map((m) => m.id),
      ["m1", "m2", "m3"],
    );
    assert.equal(page.olderCursor, null);
  });

  it("a message of another conversation: 404; two directions at once: 400", async () => {
    const { service } = seed();
    assert.equal(
      await status(service.messages(viewer("a"), "c1", { around: "m10" })),
      404,
    );
    assert.equal(
      await status(
        service.messages(viewer("a"), "c1", {
          around: "m5",
          after: encodeCursor({ createdAt: new Date(), id: "x" }),
        }),
      ),
      400,
    );
    assert.equal(
      await status(
        service.messages(viewer("a"), "c1", { after: "nem-kurzor" }),
      ),
      400,
    );
  });
});

describe("shared media and files", () => {
  it("a broken cursor is 400, a non-member 404", async () => {
    const { service } = fake();
    assert.equal(
      await status(
        service.sharedAttachments(viewer("a"), "c1", {
          kind: "IMAGE",
          before: "rossz",
        }),
      ),
      400,
    );
    assert.equal(
      await status(
        service.sharedAttachments(viewer("c"), "c1", { kind: "IMAGE" }),
      ),
      404,
    );
  });
});

describe("the notification setting", () => {
  it("saves the mode for the asker only; a mute keeps the notify value", async () => {
    const { service, repo } = fake();
    const state = await service.setNotification(viewer("a"), "c1", "MUTE_1H");
    assert.equal(state.notify, "MENTIONS");
    assert.ok(state.mutedUntil && Date.parse(state.mutedUntil) > Date.now());
    assert.equal(repo.notifySaved["c1:b"], undefined);
    assert.equal(
      await status(service.setNotification(viewer("c"), "c1", "ALL")),
      404,
    );
  });

  it("the conversation detail carries the asker's setting, and a mute that has passed reads as none", async () => {
    const { service, repo } = fake();
    const future = new Date(Date.now() + 60_000);
    repo.notifySaved["c1:a"] = { notify: "ALL", mutedUntil: future };
    assert.deepEqual((await service.detail(viewer("a"), "c1")).notification, {
      notify: "ALL",
      mutedUntil: future.toISOString(),
    });
    repo.notifySaved["c1:a"] = {
      notify: "ALL",
      mutedUntil: new Date(Date.now() - 1000),
    };
    assert.deepEqual((await service.detail(viewer("a"), "c1")).notification, {
      notify: "ALL",
      mutedUntil: null,
    });
  });
});

describe("pins", () => {
  it("any member pins and unpins, once each in the audit; the message says pinned", async () => {
    const { service, repo, add, events } = fake();
    add({
      conversationId: "c1",
      senderUserId: "a",
      text: "Holnap 8:00-ra ott vagyunk.",
    });
    const pinned = await service.pin(viewer("b"), "m1", true);
    assert.equal(pinned.pinned, true);
    await service.pin(viewer("a"), "m1", true);
    assert.deepEqual(repo.audits, ['message.pinned c1 {"messageId":"m1"}']);
    assert.ok(events.includes("message.updated -> a,b"));

    const unpinned = await service.pin(viewer("a"), "m1", false);
    assert.equal(unpinned.pinned, false);
    await service.pin(viewer("a"), "m1", false);
    assert.equal(repo.audits.length, 2);
    assert.equal(repo.audits[1], 'message.unpinned c1 {"messageId":"m1"}');
  });

  it("not a member: 404; a deleted message: 400", async () => {
    const { service, add } = fake();
    add({ conversationId: "c1", senderUserId: "a", text: "x" });
    add({
      conversationId: "c1",
      senderUserId: "a",
      text: "y",
      deletedAt: new Date(),
    });
    assert.equal(await status(service.pin(viewer("c"), "m1", true)), 404);
    assert.equal(await status(service.pin(viewer("a"), "m2", true)), 400);
  });

  it("the pinned title: the first line, or the file's name, cut long", () => {
    assert.equal(
      pinnedTitle("\n  Holnap 8:00-ra ott vagyunk.\nmásodik sor", undefined),
      "Holnap 8:00-ra ott vagyunk.",
    );
    assert.equal(pinnedTitle(null, "munkalap.pdf"), "munkalap.pdf");
    assert.equal(pinnedTitle("", undefined), "Üzenet");
    const long = pinnedTitle("á".repeat(200), undefined);
    assert.equal([...long].length, 120);
    assert.ok(long.endsWith("…"));
  });
});

describe("forwarding", () => {
  const saved = process.env.DOCUMENT_STORE_ROOT;
  before(() => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/never-used-by-the-fake";
  });
  after(() => {
    if (saved === undefined) delete process.env.DOCUMENT_STORE_ROOT;
    else process.env.DOCUMENT_STORE_ROOT = saved;
  });

  it("a member of both: a new message in the target, from the forwarder, naming the original author", async () => {
    const { service, add } = fake();
    add({
      conversationId: "c1",
      senderUserId: "b",
      text: "A pumpa holnap megy.",
    });
    const sent = await service.forward(viewer("a"), "m1", {
      conversationId: "c2",
      clientMessageId: "fwd-000001",
    });
    assert.deepEqual(
      [
        sent.conversationId,
        sent.senderUserId,
        sent.text,
        sent.forwardedFrom?.senderName,
      ],
      ["c2", "a", "A pumpa holnap megy.", "Teljes b"],
    );
  });

  it("a forwarded message forwarded again keeps the ORIGINAL author", async () => {
    const { service, add } = fake();
    add({ conversationId: "c1", senderUserId: "b", text: "eredeti" });
    await service.forward(viewer("a"), "m1", {
      conversationId: "c2",
      clientMessageId: "fwd-000001",
    });
    const again = await service.forward(viewer("c"), "m2", {
      conversationId: "c3",
      clientMessageId: "fwd-000002",
    });
    assert.equal(again.forwardedFrom?.senderName, "Teljes b");
  });

  it("not a member of the source or of the target: 404; deleted or system: 400", async () => {
    const { service, add } = fake();
    add({ conversationId: "c1", senderUserId: "b", text: "x" });
    add({
      conversationId: "c1",
      senderUserId: "b",
      text: "y",
      deletedAt: new Date(),
    });
    add({ conversationId: "c1", senderUserId: "b", text: "z", type: "SYSTEM" });
    assert.equal(
      await status(
        service.forward(viewer("c"), "m1", {
          conversationId: "c2",
          clientMessageId: "fwd-000001",
        }),
      ),
      404,
    );
    assert.equal(
      await status(
        service.forward(viewer("b"), "m1", {
          conversationId: "c2",
          clientMessageId: "fwd-000002",
        }),
      ),
      404,
    );
    assert.equal(
      await status(
        service.forward(viewer("a"), "m2", {
          conversationId: "c2",
          clientMessageId: "fwd-000003",
        }),
      ),
      400,
    );
    assert.equal(
      await status(
        service.forward(viewer("a"), "m3", {
          conversationId: "c2",
          clientMessageId: "fwd-000004",
        }),
      ),
      400,
    );
  });

  it("a retry with the same client id returns the same message, not a second one", async () => {
    const { service, add, messages } = fake();
    add({ conversationId: "c1", senderUserId: "b", text: "x" });
    const first = await service.forward(viewer("a"), "m1", {
      conversationId: "c2",
      clientMessageId: "fwd-000001",
    });
    const second = await service.forward(viewer("a"), "m1", {
      conversationId: "c2",
      clientMessageId: "fwd-000001",
    });
    assert.equal(second.id, first.id);
    assert.equal(messages.length, 2);
  });

  it("the attachment is COPIED under the target conversation's own key, with a new id", async () => {
    const { service, repo, store, add } = fake();
    add({ conversationId: "c1", senderUserId: "b", text: null, type: "FILE" });
    repo.attachments.push({
      id: "att-src",
      conversationId: "c1",
      uploadedByUserId: "b",
      messageId: "m1",
      kind: "FILE",
      fileName: "munkalap.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.length,
      storageKey: "messages/c1/att-src",
      thumbnailKey: null,
      createdAt: new Date(),
    });
    store.stored.set("message/c1/att-src", PDF);

    const sent = await service.forward(viewer("a"), "m1", {
      conversationId: "c2",
      clientMessageId: "fwd-000001",
    });
    assert.equal(sent.attachments.length, 1);
    const copy = sent.attachments[0]!;
    assert.notEqual(copy.id, "att-src");
    assert.equal(copy.fileName, "munkalap.pdf");
    assert.deepEqual(store.stored.get(`message/c2/${copy.id}`), PDF);
    assert.equal(
      repo.attachments.find((a) => a.id === copy.id)?.conversationId,
      "c2",
    );
    assert.equal(
      repo.attachments.find((a) => a.id === "att-src")?.messageId,
      "m1",
    );
  });

  it("the source file missing from the store: 404, and no message", async () => {
    const { service, repo, add, messages } = fake();
    add({
      conversationId: "c1",
      senderUserId: "b",
      text: "fájllal",
      type: "FILE",
    });
    repo.attachments.push({
      id: "att-gone",
      conversationId: "c1",
      uploadedByUserId: "b",
      messageId: "m1",
      kind: "FILE",
      fileName: "x.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      storageKey: "messages/c1/att-gone",
      thumbnailKey: null,
      createdAt: new Date(),
    });
    assert.equal(
      await status(
        service.forward(viewer("a"), "m1", {
          conversationId: "c2",
          clientMessageId: "fwd-000001",
        }),
      ),
      404,
    );
    assert.equal(messages.length, 1);
  });
});

describe("the app icon number on a new message push", () => {
  it("the push carries each recipient's unread total; if the count fails, the push still goes", async () => {
    const { service, repo, pushes } = fake();
    await service.send(viewer("a"), "c1", {
      text: "Szia",
      clientMessageId: "badge-00001",
    });
    assert.deepEqual(pushes.at(-1)?.userIds, ["b"]);
    assert.deepEqual(pushes.at(-1)?.badges, { b: 2 });

    (repo as { unreadTotals: unknown }).unreadTotals = async () => {
      throw new Error("adatbázis");
    };
    await service.send(viewer("a"), "c1", {
      text: "Még egy",
      clientMessageId: "badge-00002",
    });
    assert.equal(pushes.length, 2);
    assert.equal(pushes.at(-1)?.badges, undefined);
  });
});
