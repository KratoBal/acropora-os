import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { MessagesRepository } from "./messages.repository.js";

/**
 * AZ ÜZENETEK 4. FÁZISÁNAK ADATBÁZIS-OLDALA. A szolgáltatás tesztje egy hamis
 * tárral fut, ezért azt, hogy objektumonként EGY élő beszélgetés lehet, CSAK a
 * migráció részleges egyedi indexe bizonyítja (`Conversation_one_live_per_context_key`).
 * A szolgáltatás „meglévő-e” előellenőrzése ehhez képest gyorsítás: a kalibráció
 * szerint nélküle is ugyanaz a viselkedés, mert a második létrehozás itt bukik el.
 *
 * MI PIROSÍT: két egyszerre indított beszélgetés ugyanahhoz a munkalaphoz két sort
 * hoz; a kötés egy foglalt munkalapra átmegy; az archivált beszélgetés foglalva
 * tartja a munkalapot; a visszatérő tag a régi olvasási mutatóval jön vissza; az
 * utolsó kilépő után a beszélgetés nem archív; a rendszerüzenet nem `SYSTEM`, vagy
 * nem kerül az előnézetbe.
 */
const gate = integrationDatabaseGate(process.env);
const TEST_EMAIL_DOMAIN = "messages-phase4-integration.invalid";

describe(
  "MessagesRepository phase 4 integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new MessagesRepository();
    const suffix = `${process.pid}`;
    const ids: Record<"a" | "b", string> = { a: "", b: "" };
    const ctx = (name: string) => ({
      type: "WORKSHEET",
      id: `ws-${name}-${suffix}`,
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

    const group = (context: { type: string; id: string } | null) =>
      repository.createConversation({
        type: "GROUP",
        title: "Negyedik fázis",
        description: null,
        createdByUserId: ids.a,
        directKey: null,
        memberIds: [ids.a, ids.b],
        context,
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const key of ["a", "b"] as const) {
        const user = await prisma.user.create({
          data: {
            email: `${key}-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: `Negyedik ${key}`,
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
          nev: "a 4. fazis suite felhasznaloi bent maradtak",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    });

    it("two concurrent starts for one worksheet make ONE conversation, and both get its id", async () => {
      const context = ctx("parhuzamos");
      const [one, two] = await Promise.all([group(context), group(context)]);
      assert.equal(one.id, two.id);
      assert.equal([one.created, two.created].filter(Boolean).length, 1);
      assert.equal(
        await prisma.conversation.count({
          where: { contextType: context.type, contextId: context.id },
        }),
        1,
      );
    });

    it("linking to a worksheet that has a live conversation is refused; an archived one frees it", async () => {
      const context = ctx("foglalt");
      const first = await group(context);
      const other = await group(null);
      assert.equal(await repository.setContext(other.id, context), false);
      await prisma.conversation.update({
        where: { id: first.id },
        data: { archivedAt: new Date() },
      });
      assert.equal(await repository.setContext(other.id, context), true);
      assert.equal(
        await repository.conversationByContext(context.type, context.id),
        other.id,
      );
    });

    it("a member who comes back gets a fresh join, not the old read mark; the last to leave archives", async () => {
      const { id } = await group(null);
      await prisma.conversationMember.updateMany({
        where: { conversationId: id, userId: ids.b },
        data: { lastReadAt: new Date("2026-01-01T00:00:00Z") },
      });
      assert.equal(await repository.leave(id, ids.b), 1);
      await repository.addMembers(id, [ids.b]);
      const back = await prisma.conversationMember.findUniqueOrThrow({
        where: { conversationId_userId: { conversationId: id, userId: ids.b } },
      });
      assert.equal(back.leftAt, null);
      assert.equal(back.lastReadAt, null);
      assert.ok(back.joinedAt.getTime() > Date.now() - 60_000);

      assert.equal(await repository.leave(id, ids.a), 1);
      assert.equal(await repository.leave(id, ids.b), 0);
      const archived = await prisma.conversation.findUniqueOrThrow({
        where: { id },
      });
      assert.ok(archived.archivedAt);
    });

    it("a system line is SYSTEM, becomes the preview, and is read for its actor", async () => {
      const { id } = await group(null);
      const line = await repository.createSystemMessage({
        conversationId: id,
        actorUserId: ids.a,
        text: "Negyedik a csatlakozott a beszélgetéshez.",
      });
      assert.equal(line.type, "SYSTEM");
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(conv.lastMessageId, line.id);
      const unreadForActor =
        (await repository.unreadCounts(ids.a)).get(id) ?? 0;
      const unreadForOther =
        (await repository.unreadCounts(ids.b)).get(id) ?? 0;
      assert.equal(unreadForActor, 0);
      assert.equal(unreadForOther, 1);
    });
  },
);
