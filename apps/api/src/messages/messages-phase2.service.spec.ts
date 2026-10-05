import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import type { DocumentKey } from "../service-assets/document-store/document-store.js";
import { MessageAttachmentCleanup } from "./message-attachment-cleanup.js";
import { InMemoryMessageEventBus } from "./message-event-bus.js";
import { AttachmentBindingError } from "./messages.repository.js";
import { messageTypeFor, ORPHAN_ATTACHMENT_TTL_MS } from "./messages.rules.js";
import { MessagesService } from "./messages.service.js";

/*
  AZ ÜZENETEK 2. FÁZISA (kártya 51d7aba0, terv uzenetek-2-fazis-terv.md). MI
  PIROSÍT:
  - csatolmány: más felhasználó, másik beszélgetés vagy már elküldött fájl
    köthető egy üzenethez; nem tag letöltheti; egy el nem küldött feltöltést
    más is lát; törölt üzenet csatolmánya kimegy; kikapcsolt tárolónál a
    feltöltés az adatbázisba esik;
  - válasz másik beszélgetés üzenetére; a törölt eredeti szövege kimegy;
  - szerkesztés vagy törlés más üzenetén; törölt üzenet szerkeszthető;
  - ismeretlen reakció; a reakció a törölt üzeneten látszik;
  - a takarítás elküldött vagy friss feltöltést töröl.
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

function fake() {
  const members: Record<string, string[]> = { c1: ["a", "b"], c2: ["a", "c"] };
  const messages: Record<string, Record<string, unknown>> = {};
  const attachments: Att[] = [];
  const reactions: { messageId: string; userId: string; reaction: string }[] =
    [];
  const audits: string[] = [];
  const stored = new Map<string, Uint8Array>();
  const keyOf = (k: DocumentKey) => `${k.owner}/${k.ownerId}/${k.documentId}`;
  let n = 0;
  const row = (id: string) => {
    const m = messages[id];
    if (!m) return null;
    const reply = m.replyToMessageId
      ? messages[m.replyToMessageId as string]
      : null;
    return {
      ...m,
      sender: { displayName: `Teljes ${m.senderUserId}`, nickname: null },
      attachments: attachments.filter((a) => a.messageId === id),
      reactions: reactions.filter((r) => r.messageId === id),
      // a 3. fázis mezői: itt nincs kitűzés és továbbítás
      pins: [],
      forwardedFromUser: null,
      replyTo: reply
        ? {
            id: reply.id,
            text: reply.text,
            deletedAt: reply.deletedAt,
            sender: {
              displayName: `Teljes ${reply.senderUserId}`,
              nickname: null,
            },
            attachments: [],
          }
        : null,
    };
  };
  const repo = {
    audits,
    attachments,
    messages,
    activeMembership: async (c: string, u: string) =>
      members[c]?.includes(u)
        ? { joinedAt: new Date(0), lastReadAt: null, lastReadMessageId: null }
        : null,
    messageByClientId: async () => null,
    messageInConversation: async (c: string, id: string) =>
      messages[id]?.conversationId === c ? { id, createdAt: new Date() } : null,
    attachmentsForSend: async (ids: readonly string[]) =>
      attachments.filter((a) => ids.includes(a.id)),
    createMessage: async (input: {
      conversationId: string;
      senderUserId: string;
      text: string | null;
      clientMessageId: string;
      type?: string;
      replyToMessageId?: string | null;
      attachmentIds?: readonly string[];
    }) => {
      const id = `m${++n}`;
      const bindable = attachments.filter(
        (a) =>
          input.attachmentIds?.includes(a.id) &&
          a.conversationId === input.conversationId &&
          a.uploadedByUserId === input.senderUserId &&
          a.messageId === null,
      );
      if (bindable.length !== (input.attachmentIds?.length ?? 0))
        throw new AttachmentBindingError();
      messages[id] = {
        id,
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        type: input.type ?? "TEXT",
        text: input.text,
        clientMessageId: input.clientMessageId,
        replyToMessageId: input.replyToMessageId ?? null,
        createdAt: new Date(1000 + n),
        editedAt: null,
        deletedAt: null,
      };
      for (const a of bindable) a.messageId = id;
      return row(id);
    },
    message: async (id: string) => row(id),
    editMessage: async (id: string, text: string) => {
      messages[id]!.text = text;
      messages[id]!.editedAt = new Date();
    },
    deleteMessage: async (id: string) => {
      messages[id]!.deletedAt = new Date();
    },
    addReaction: async (
      messageId: string,
      userId: string,
      reaction: string,
    ) => {
      if (
        !reactions.some(
          (r) =>
            r.messageId === messageId &&
            r.userId === userId &&
            r.reaction === reaction,
        )
      )
        reactions.push({ messageId, userId, reaction });
    },
    removeReaction: async (
      messageId: string,
      userId: string,
      reaction: string,
    ) => {
      const i = reactions.findIndex(
        (r) =>
          r.messageId === messageId &&
          r.userId === userId &&
          r.reaction === reaction,
      );
      if (i >= 0) reactions.splice(i, 1);
    },
    members: async (c: string) =>
      (members[c] ?? []).map((userId) => ({
        userId,
        leftAt: null,
        notify: "ALL",
        mutedUntil: null,
      })),
    conversation: async () => ({ type: "DIRECT", title: null }),
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
    attachment: async (id: string) => {
      const a = attachments.find((x) => x.id === id);
      return a
        ? {
            ...a,
            message: a.messageId
              ? { deletedAt: messages[a.messageId]!.deletedAt as Date | null }
              : null,
          }
        : null;
    },
    orphanAttachments: async (olderThan: Date) =>
      attachments.filter(
        (a) => a.messageId === null && a.createdAt < olderThan,
      ),
    deleteOrphanAttachment: async (id: string) => {
      const i = attachments.findIndex(
        (a) => a.id === id && a.messageId === null,
      );
      if (i < 0) return false;
      attachments.splice(i, 1);
      return true;
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
  const notifications = { notifyNewMessage: () => undefined };
  const service = new MessagesService(
    repo as never,
    bus,
    notifications as never,
    store as never,
  );
  return { service, repo, store, events };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

const attach = (
  repo: ReturnType<typeof fake>["repo"],
  over: Partial<Att> & { id: string },
) =>
  repo.attachments.push({
    conversationId: "c1",
    uploadedByUserId: "a",
    messageId: null,
    kind: "IMAGE",
    fileName: "pumpa.jpg",
    contentType: "image/jpeg",
    sizeBytes: 10,
    storageKey: `messages/c1/${over.id}`,
    thumbnailKey: null,
    createdAt: new Date(),
    ...over,
  });

describe("upload", () => {
  const saved = process.env.DOCUMENT_STORE_ROOT;
  before(() => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/never-used-by-the-fake";
  });
  after(() => {
    if (saved === undefined) delete process.env.DOCUMENT_STORE_ROOT;
    else process.env.DOCUMENT_STORE_ROOT = saved;
  });

  it("a member uploads a PDF into the store; a non-member gets 404; no store, no upload", async () => {
    const { service, store, repo } = fake();
    const file = {
      originalname: "szamla.pdf",
      mimetype: "application/pdf",
      buffer: PDF,
    };
    const item = await service.uploadAttachment(viewer("a"), "c1", file);
    assert.deepEqual(
      [item.kind, item.fileName, item.hasThumbnail],
      ["FILE", "szamla.pdf", false],
    );
    assert.ok(store.stored.has(`message/c1/${item.id}`));
    assert.equal(repo.attachments[0]!.messageId, null);
    assert.equal(
      await status(service.uploadAttachment(viewer("c"), "c1", file)),
      404,
    );
    delete process.env.DOCUMENT_STORE_ROOT;
    assert.equal(
      await status(service.uploadAttachment(viewer("a"), "c1", file)),
      503,
    );
  });

  it("a forged type is refused (the shared intake: PDF, JPEG, PNG only)", async () => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/never-used-by-the-fake";
    const { service } = fake();
    assert.equal(
      await status(
        service.uploadAttachment(viewer("a"), "c1", {
          originalname: "x.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("not a pdf"),
        }),
      ),
      400,
    );
  });
});

describe("send with attachments and replies", () => {
  it("an attachment alone may go; the message takes its kind", async () => {
    const { service, repo } = fake();
    attach(repo, { id: "f1" });
    const sent = await service.send(viewer("a"), "c1", {
      clientMessageId: "client-001",
      attachmentIds: ["f1"],
    });
    assert.deepEqual(
      [sent.type, sent.text, sent.attachments.map((a) => a.id)],
      ["IMAGE", null, ["f1"]],
    );
    assert.equal(messageTypeFor(["IMAGE", "FILE"]), "FILE");
  });

  it("refuses another user's, another conversation's or an already sent attachment, and empty sends", async () => {
    const { service, repo } = fake();
    attach(repo, { id: "theirs", uploadedByUserId: "b" });
    attach(repo, { id: "elsewhere", conversationId: "c2" });
    attach(repo, { id: "sent", messageId: "m0" });
    for (const id of ["theirs", "elsewhere", "sent", "missing"])
      assert.equal(
        await status(
          service.send(viewer("a"), "c1", {
            clientMessageId: `client-${id}-x`,
            attachmentIds: [id],
          }),
        ),
        400,
        id,
      );
    assert.equal(
      await status(
        service.send(viewer("a"), "c1", { clientMessageId: "client-empty-1" }),
      ),
      400,
    );
  });

  it("a reply stays in its conversation, and a deleted original keeps the link without its text", async () => {
    const { service, repo } = fake();
    const other = await service.send(viewer("a"), "c2", {
      text: "máshol",
      clientMessageId: "client-c2-01",
    });
    assert.equal(
      await status(
        service.send(viewer("a"), "c1", {
          text: "x",
          clientMessageId: "client-c1-01",
          replyToMessageId: other.id,
        }),
      ),
      400,
    );
    const original = await service.send(viewer("b"), "c1", {
      text: "eredeti",
      clientMessageId: "client-c1-02",
    });
    const reply = await service.send(viewer("a"), "c1", {
      text: "válasz",
      clientMessageId: "client-c1-03",
      replyToMessageId: original.id,
    });
    assert.deepEqual(reply.replyTo, {
      id: original.id,
      senderName: "Teljes b",
      text: "eredeti",
      deleted: false,
      attachmentKind: null,
    });
    repo.messages[original.id]!.deletedAt = new Date();
    const again = await service.message(viewer("a"), reply.id);
    assert.deepEqual(
      [again.replyTo?.text, again.replyTo?.deleted],
      [null, true],
    );
  });
});

describe("download", () => {
  it("members only; an unsent upload only for its uploader; nothing of a deleted message", async () => {
    const { service, repo, store } = fake();
    attach(repo, { id: "f1", thumbnailKey: "messages/c1/f1-thumb" });
    await store.put(
      { owner: "message", ownerId: "c1", documentId: "f1" },
      new Uint8Array([1]),
    );
    await store.put(
      { owner: "message", ownerId: "c1", documentId: "f1-thumb" },
      new Uint8Array([2]),
    );
    assert.equal(await status(service.attachmentBytes(viewer("b"), "f1")), 404);
    const sent = await service.send(viewer("a"), "c1", {
      clientMessageId: "client-001",
      attachmentIds: ["f1"],
    });
    assert.deepEqual(
      [...(await service.attachmentBytes(viewer("b"), "f1")).bytes],
      [1],
    );
    const thumb = await service.attachmentBytes(viewer("b"), "f1", "thumbnail");
    assert.deepEqual(
      [[...thumb.bytes], thumb.contentType],
      [[2], "image/jpeg"],
    );
    assert.equal(await status(service.attachmentBytes(viewer("c"), "f1")), 404);
    await service.remove(viewer("a"), sent.id);
    assert.equal(await status(service.attachmentBytes(viewer("b"), "f1")), 404);
  });
});

describe("edit, delete and reactions", () => {
  it("only the sender edits; a deleted message cannot be edited; the edit is announced", async () => {
    const { service, events } = fake();
    const m = await service.send(viewer("a"), "c1", {
      text: "elso",
      clientMessageId: "client-001",
    });
    assert.equal(await status(service.edit(viewer("b"), m.id, "más")), 403);
    const edited = await service.edit(viewer("a"), m.id, " javított ");
    assert.deepEqual(
      [edited.text, edited.editedAt !== null],
      ["javított", true],
    );
    assert.equal(events.at(-1), "message.updated -> a,b");
    await service.remove(viewer("a"), m.id);
    assert.equal(await status(service.edit(viewer("a"), m.id, "újra")), 409);
  });

  it("only the sender deletes; the delete is audited without text and is idempotent", async () => {
    const { service, repo } = fake();
    const m = await service.send(viewer("a"), "c1", {
      text: "titok",
      clientMessageId: "client-001",
    });
    assert.equal(await status(service.remove(viewer("b"), m.id)), 403);
    await service.remove(viewer("a"), m.id);
    await service.remove(viewer("a"), m.id);
    assert.deepEqual(repo.audits, [
      `message.deleted c1 {"messageId":"${m.id}"}`,
    ]);
    const seen = await service.message(viewer("b"), m.id);
    assert.deepEqual(
      [seen.text, seen.deleted, seen.attachments],
      [null, true, []],
    );
  });

  it("four reactions only, once per person, removable, summarised with mine", async () => {
    const { service } = fake();
    const m = await service.send(viewer("a"), "c1", {
      text: "x",
      clientMessageId: "client-001",
    });
    assert.equal(
      await status(service.react(viewer("b"), m.id, "🔥", true)),
      400,
    );
    await service.react(viewer("b"), m.id, "👍", true);
    await service.react(viewer("b"), m.id, "👍", true);
    const both = await service.react(viewer("a"), m.id, "👍", true);
    assert.deepEqual(both.reactions, [
      { reaction: "👍", count: 2, mine: true },
    ]);
    const after = await service.react(viewer("a"), m.id, "👍", false);
    assert.deepEqual(after.reactions, [
      { reaction: "👍", count: 1, mine: false },
    ]);
    assert.equal(
      await status(service.react(viewer("c"), m.id, "👍", true)),
      404,
    );
    await service.remove(viewer("a"), m.id);
    assert.equal(
      await status(service.react(viewer("b"), m.id, "❤️", true)),
      409,
    );
    assert.deepEqual((await service.message(viewer("b"), m.id)).reactions, []);
  });
});

describe("the orphan sweep", () => {
  it("removes only unsent uploads older than 24 h, the row first, then the bytes", async () => {
    const { repo, store } = fake();
    const now = new Date("2026-10-05T12:00:00Z");
    const old = new Date(now.getTime() - ORPHAN_ATTACHMENT_TTL_MS - 1000);
    attach(repo, {
      id: "old",
      createdAt: old,
      thumbnailKey: "messages/c1/old-thumb",
    });
    attach(repo, {
      id: "fresh",
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    });
    attach(repo, { id: "sentOld", createdAt: old, messageId: "m9" });
    for (const id of ["old", "old-thumb", "fresh", "sentOld"])
      await store.put(
        { owner: "message", ownerId: "c1", documentId: id },
        new Uint8Array([1]),
      );
    const sweep = new MessageAttachmentCleanup(repo as never, store as never);
    assert.equal(await sweep.sweep(now), 1);
    assert.deepEqual(repo.attachments.map((a) => a.id).sort(), [
      "fresh",
      "sentOld",
    ]);
    assert.deepEqual([...store.stored.keys()].sort(), [
      "message/c1/fresh",
      "message/c1/sentOld",
    ]);
  });
});
