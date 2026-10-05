import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { encodeCursor, decodeCursor, directKeyOf } from "./messages.rules.js";
import {
  AttachmentBindingError,
  MessagesRepository,
} from "./messages.repository.js";

/**
 * AZ ÜZENETEK ADATBÁZIS-OLDALA (kártya 51d7aba0): amit csak valódi Postgresen
 * lehet bizonyítani. MI PIROSÍT: két DIRECT beszélgetés ugyanarra a párra; az
 * olvasatlan-szám a saját vagy a törölt üzenetet is számolja, vagy nem nullázódik
 * olvasás után; a lapozás azonos pillanatú üzenetnél ismétel vagy kihagy; az
 * olvasottság visszafelé lép; egy `clientMessageId` kétszer is bekerül.
 *
 * Csak tesztelésre megnevezett adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);
const TEST_EMAIL_DOMAIN = "messages-integration.invalid";

describe(
  "MessagesRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new MessagesRepository();
    const suffix = `${process.pid}`;
    const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };

    async function removeLeftovers() {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      await prisma.conversation.deleteMany({
        where: { createdByUserId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const key of ["a", "b", "c"] as const) {
        const user = await prisma.user.create({
          data: {
            email: `${key}-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: `Üzenő ${key}`,
            role: "SERVICE",
          },
          select: { id: true },
        });
        ids[key] = user.id;
      }
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite felhasznaloi bent maradtak a takaritas utan",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    });

    it("two simultaneous starts of the same DIRECT make one conversation", async () => {
      const key = directKeyOf(ids.a, ids.b);
      const start = () =>
        repository.createConversation({
          type: "DIRECT",
          title: null,
          description: null,
          createdByUserId: ids.a,
          directKey: key,
          memberIds: [ids.a, ids.b],
        });
      const [one, two] = await Promise.all([start(), start()]);
      assert.equal(one.id, two.id);
      assert.equal(
        await prisma.conversation.count({ where: { directKey: key } }),
        1,
      );
    });

    it("unread counts others' live messages after the read mark, and drops to zero once read", async () => {
      const { id } = await repository.createConversation({
        type: "GROUP",
        title: "Teszt",
        description: null,
        createdByUserId: ids.a,
        directKey: null,
        memberIds: [ids.a, ids.b, ids.c],
      });
      const send = (sender: string, n: string) =>
        repository.createMessage({
          conversationId: id,
          senderUserId: sender,
          text: `üzenet ${n}`,
          clientMessageId: `client-${suffix}-${n}`,
        });
      await send(ids.b, "1");
      const second = await send(ids.c, "2");
      await send(ids.a, "3"); // a sajátja: neki nem olvasatlan
      // c törölt üzenete senkinek nem olvasatlan
      const deleted = await send(ids.c, "4");
      await prisma.message.update({
        where: { id: deleted.id },
        data: { deletedAt: new Date() },
      });

      assert.equal((await repository.unreadCounts(ids.a)).get(id) ?? 0, 0);
      // b a saját 1-esénél olvasott (a küldés olvasottnak jelöli): a 2 és a 3 olvasatlan, a törölt 4 nem
      assert.equal((await repository.unreadCounts(ids.b)).get(id), 2);

      assert.equal(
        await repository.markRead({
          conversationId: id,
          userId: ids.b,
          message: second,
        }),
        true,
      );
      assert.equal((await repository.unreadCounts(ids.b)).get(id), 1);

      // visszafelé nem lép: egy régebbi üzenet olvasottnak jelölése nem nyit újra semmit
      const first = (
        await repository.messagesPage({
          conversationId: id,
          before: null,
          limit: 10,
        })
      ).rows.at(-1)!;
      assert.equal(
        await repository.markRead({
          conversationId: id,
          userId: ids.b,
          message: first,
        }),
        false,
      );
      assert.equal((await repository.unreadCounts(ids.b)).get(id), 1);
    });

    it("paging walks the whole history once, even through messages of the same instant", async () => {
      const { id } = await repository.createConversation({
        type: "GROUP",
        title: "Lapozás",
        description: null,
        createdByUserId: ids.a,
        directKey: null,
        memberIds: [ids.a, ids.b],
      });
      const instant = new Date("2026-10-05T08:00:00.000Z");
      for (let n = 0; n < 5; n++)
        await prisma.message.create({
          data: {
            conversationId: id,
            senderUserId: ids.a,
            text: `${n}`,
            // három üzenet UGYANABBAN a pillanatban
            createdAt: n < 3 ? instant : new Date(instant.getTime() + n * 1000),
          },
        });
      const seen: string[] = [];
      let before: { createdAt: Date; id: string } | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page = await repository.messagesPage({
          conversationId: id,
          before,
          limit: 2,
        });
        seen.push(...page.rows.map((r) => r.id));
        if (!page.hasOlder) break;
        before = decodeCursor(encodeCursor(page.rows.at(-1)!));
      }
      assert.equal(seen.length, 5);
      assert.equal(new Set(seen).size, 5);
    });

    it("the same client id from the same sender is stored once", async () => {
      const { id } = await repository.createConversation({
        type: "GROUP",
        title: "Újraküldés",
        description: null,
        createdByUserId: ids.a,
        directKey: null,
        memberIds: [ids.a, ids.b],
      });
      const input = {
        conversationId: id,
        senderUserId: ids.a,
        text: "egyszer",
        clientMessageId: `client-${suffix}-dup`,
      };
      await repository.createMessage(input);
      await assert.rejects(
        repository.createMessage(input),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002",
      );

      it("a reaction is stored once per person, and a bad attachment binding rolls the whole send back", async () => {
        const { id } = await repository.createConversation({
          type: "GROUP",
          title: "2. fázis",
          description: null,
          createdByUserId: ids.a,
          directKey: null,
          memberIds: [ids.a, ids.b],
        });
        const message = await repository.createMessage({
          conversationId: id,
          senderUserId: ids.a,
          text: "reagálj",
          clientMessageId: `client-${suffix}-react`,
        });
        await repository.addReaction(message.id, ids.b, "👍");
        await repository.addReaction(message.id, ids.b, "👍");
        assert.equal(
          await prisma.messageReaction.count({
            where: { messageId: message.id },
          }),
          1,
        );

        // b feltöltése nem köthető a üzenetéhez: a küldés egésze visszagördül
        const foreign = await repository.createAttachment({
          id: `att-${suffix}-b`,
          conversationId: id,
          uploadedByUserId: ids.b,
          kind: "FILE",
          fileName: "b.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
          sha256: "0".repeat(64),
          storageKey: `messages/${id}/att-${suffix}-b`,
          thumbnailKey: null,
        });
        const before = await prisma.message.count({
          where: { conversationId: id },
        });
        await assert.rejects(
          repository.createMessage({
            conversationId: id,
            senderUserId: ids.a,
            text: null,
            clientMessageId: `client-${suffix}-bind`,
            type: "FILE",
            attachmentIds: [foreign.id],
          }),
          (error: unknown) => error instanceof AttachmentBindingError,
        );
        assert.equal(
          await prisma.message.count({ where: { conversationId: id } }),
          before,
        );
        assert.equal(
          (
            await prisma.messageAttachment.findUnique({
              where: { id: foreign.id },
            })
          )?.messageId,
          null,
        );
      });
    });
  },
);
