import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { MessagesRepository } from "./messages.repository.js";
import { messageSearchPattern } from "./messages.rules.js";

/**
 * AZ ÜZENETEK 3. FÁZISÁNAK ADATBÁZIS-OLDALA: amit csak valódi Postgresen lehet
 * bizonyítani. MI PIROSÍT: két egyszerre érkező kitűzésből két sor lesz; a
 * törölt üzenet kitűzése a listában marad; az ékezet nélküli keresés nem
 * találja az ékezetes szöveget; a „%” joker-karakterként illeszt; a törölt
 * üzenet találat; a számolás nem áll meg a korlátnál; a gazdátlan feltöltés
 * vagy a törölt üzenet csatolmánya megosztottként jelenik meg; az újabb oldal
 * azonos pillanatú üzenetnél kihagy; a beállítás más tagot is átír; a
 * továbbítás eredete nem tárolódik.
 *
 * Csak tesztelésre megnevezett adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);
const TEST_EMAIL_DOMAIN = "messages-phase3-integration.invalid";

describe(
  "MessagesRepository phase 3 integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new MessagesRepository();
    const suffix = `${process.pid}`;
    const ids: Record<"a" | "b", string> = { a: "", b: "" };
    let conversationId = "";
    let n = 0;

    const send = (sender: string, text: string | null) =>
      repository.createMessage({
        conversationId,
        senderUserId: sender,
        text,
        clientMessageId: `p3-${suffix}-${++n}`,
      });

    async function removeLeftovers() {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        select: { id: true },
      });
      await prisma.conversation.deleteMany({
        where: { createdByUserId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const key of ["a", "b"] as const) {
        const user = await prisma.user.create({
          data: {
            email: `${key}-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: `Harmadik ${key}`,
            role: "SERVICE",
          },
          select: { id: true },
        });
        ids[key] = user.id;
      }
      ({ id: conversationId } = await repository.createConversation({
        type: "GROUP",
        title: "Harmadik fázis",
        description: null,
        createdByUserId: ids.a,
        directKey: null,
        memberIds: [ids.a, ids.b],
      }));
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a 3. fazis suite felhasznaloi bent maradtak",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    });

    it("two pins of the same message at once leave one row; unpin answers once", async () => {
      const message = await send(ids.a, "kitűzendő");
      const results = await Promise.all([
        repository.pin({
          conversationId,
          messageId: message.id,
          userId: ids.a,
        }),
        repository.pin({
          conversationId,
          messageId: message.id,
          userId: ids.b,
        }),
      ]);
      assert.deepEqual(results.filter(Boolean).length, 1);
      assert.equal(
        await prisma.pinnedMessage.count({ where: { messageId: message.id } }),
        1,
      );
      assert.equal(await repository.unpin(conversationId, message.id), true);
      assert.equal(await repository.unpin(conversationId, message.id), false);
    });

    it("a deleted message's pin leaves the list, its row stays", async () => {
      const kept = await send(ids.a, "marad");
      const gone = await send(ids.b, "törlődik");
      await repository.pin({
        conversationId,
        messageId: kept.id,
        userId: ids.b,
      });
      await repository.pin({
        conversationId,
        messageId: gone.id,
        userId: ids.a,
      });
      await repository.deleteMessage(gone.id, ids.b);
      const listed = (await repository.pins(conversationId)).map(
        (p) => p.message.id,
      );
      assert.ok(listed.includes(kept.id));
      assert.ok(!listed.includes(gone.id));
      assert.equal(
        await prisma.pinnedMessage.count({ where: { messageId: gone.id } }),
        1,
      );
    });

    it("search: accents and case do not matter, % is a character, deleted is out, the count stops at the cap", async () => {
      const accented = await send(ids.a, "A tartalék KÖTÉL a raktárban van");
      const percent = await send(ids.b, "100% kész a munkalap");
      const plain = await send(ids.b, "100 darab csavar");
      const deleted = await send(ids.a, "kötél, de törölve");
      await repository.deleteMessage(deleted.id, ids.a);

      const kotel = await repository.searchMessages({
        conversationId,
        pattern: messageSearchPattern("kotel"),
        limit: 50,
        cap: 1000,
      });
      assert.deepEqual(kotel.ids, [accented.id]);
      assert.equal(kotel.total, 1);

      const hundred = await repository.searchMessages({
        conversationId,
        pattern: messageSearchPattern("100%"),
        limit: 50,
        cap: 1000,
      });
      assert.deepEqual(hundred.ids, [percent.id]);
      assert.ok(!hundred.ids.includes(plain.id));

      const capped = await repository.searchMessages({
        conversationId,
        pattern: messageSearchPattern("100"),
        limit: 50,
        cap: 1,
      });
      assert.equal(capped.total, 1);
      assert.equal(capped.ids.length, 2);
    });

    it("shared attachments: only a sent, not deleted message's, newest first", async () => {
      const sent = await send(ids.a, null);
      const removed = await send(ids.a, null);
      const base = {
        conversationId,
        uploadedByUserId: ids.a,
        kind: "IMAGE" as const,
        contentType: "image/jpeg",
        sizeBytes: 10,
        sha256: "0".repeat(64),
        thumbnailKey: null,
      };
      const make = (id: string, messageId: string | null, fileName: string) =>
        prisma.messageAttachment.create({
          data: {
            ...base,
            id: `${id}-${suffix}`,
            messageId,
            fileName,
            storageKey: `messages/${conversationId}/${id}`,
          },
        });
      await make("bound", sent.id, "bound.jpg");
      await make("orphan", null, "orphan.jpg");
      await make("onDeleted", removed.id, "deleted.jpg");
      await repository.deleteMessage(removed.id, ids.a);

      const { rows } = await repository.sharedAttachments({
        conversationId,
        kind: "IMAGE",
        before: null,
        limit: 50,
      });
      assert.deepEqual(
        rows.map((row) => row.fileName),
        ["bound.jpg"],
      );
      assert.equal(rows[0]!.message!.id, sent.id);
    });

    it("the newer page after a cursor skips nothing at the same instant", async () => {
      const at = new Date("2026-10-05T12:00:00.000Z");
      const first = await send(ids.a, "egy");
      const second = await send(ids.a, "kettő");
      const third = await send(ids.a, "három");
      await prisma.message.updateMany({
        where: { id: { in: [first.id, second.id, third.id] } },
        data: { createdAt: at },
      });
      const sorted = [first.id, second.id, third.id].sort();
      const page = await repository.messagesAfter({
        conversationId,
        after: { createdAt: at, id: sorted[0]! },
        limit: 10,
      });
      assert.deepEqual(
        page.rows.filter((row) => sorted.includes(row.id)).map((row) => row.id),
        sorted.slice(1),
      );
    });

    it("the unread totals per recipient (the iOS badge): others' live messages after the read mark, zero for nobody's", async () => {
      const before = await repository.unreadTotals([ids.a, ids.b]);
      await send(ids.a, "jelvény egy");
      await send(ids.a, "jelvény kettő");
      const deleted = await send(ids.a, "jelvény törölt");
      await repository.deleteMessage(deleted.id, ids.a);
      const after = await repository.unreadTotals([ids.a, ids.b]);
      assert.equal(
        after[ids.b]! - before[ids.b]!,
        2,
        "b: két új, a törölt nem számít",
      );
      assert.equal(
        after[ids.a],
        before[ids.a],
        "a saját üzenete a küldőnek nem olvasatlan",
      );
      assert.deepEqual(await repository.unreadTotals([]), {});
    });

    it("the notification setting changes only the asker's row; a forward stores its origin", async () => {
      await repository.setNotification(conversationId, ids.a, {
        mutedUntil: new Date("2030-01-01T07:00:00.000Z"),
      });
      const rows = await prisma.conversationMember.findMany({
        where: { conversationId },
        select: { userId: true, mutedUntil: true },
      });
      assert.equal(
        rows.find((r) => r.userId === ids.a)?.mutedUntil?.toISOString(),
        "2030-01-01T07:00:00.000Z",
      );
      assert.equal(rows.find((r) => r.userId === ids.b)?.mutedUntil, null);

      const original = await send(ids.b, "eredeti");
      const forwarded = await repository.createMessage({
        conversationId,
        senderUserId: ids.a,
        text: "eredeti",
        clientMessageId: `p3-${suffix}-fwd`,
        forwardedFrom: { messageId: original.id, userId: ids.b },
      });
      assert.equal(forwarded.forwardedFromMessageId, original.id);
      assert.equal(forwarded.forwardedFromUserId, ids.b);
      assert.equal(forwarded.forwardedFromUser?.displayName, "Harmadik b");
    });
  },
);
