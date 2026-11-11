import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { AiContactRequestsRepository } from "./ai-contact-requests.repository.js";

/**
 * THE CONTACT REQUESTS IN THE DATABASE (card f5b8f7ba, slice 4c). WHAT TURNS IT RED: one customer message gives two rows (also when
 * two hand-overs of it run at once); a repeat reports itself as new; a second "handled" moves the time or the handler, or leaves no
 * audit row; the notification time moves on a second mark; the database takes an empty or over-long value when the server's rule is
 * bypassed; the list is not newest first.
 */
const gate = integrationDatabaseGate(process.env);
describe(
  "AI contact requests: the repository against the database",
  { skip: gate.mode === "skip" },
  () => {
    const run = randomUUID().slice(0, 8);
    const repository = new AiContactRequestsRepository();
    const input = (key: string, value = "vasarlo@example.hu") => ({
      channel: "EMAIL" as const,
      value,
      conversationRef: `conv-${run}`,
      requestKey: `msg-${run}-${key}`,
    });
    let userId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `ai-contact-${run}@example.invalid`,
            displayName: "Contact request test",
            role: "ADMIN",
          },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      const rows = await prisma.aiContactRequest.findMany({
        where: { requestKey: { contains: run } },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: rows.map((row) => row.id) } },
      });
      await prisma.aiContactRequest.deleteMany({
        where: { requestKey: { contains: run } },
      });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it("stores a request once per message: a repeat returns the same row as not created, also when two hand-overs run at once", async () => {
      const first = await repository.store(input("a"));
      assert.equal(first.created, true);
      assert.equal(first.notified, false);
      const again = await repository.store(input("a"));
      assert.deepEqual(again, {
        id: first.id,
        created: false,
        notified: false,
      });

      const [left, right] = await Promise.all([
        repository.store(input("race")),
        repository.store(input("race")),
      ]);
      assert.equal(left.id, right.id);
      assert.deepEqual([left.created, right.created].sort(), [false, true]);
      assert.equal(
        await prisma.aiContactRequest.count({
          where: { requestKey: `msg-${run}-race` },
        }),
        1,
      );
    });

    it("marks the notification once: the time does not move on a second mark, and a repeat of the hand-over sees it as notified", async () => {
      const { id } = await repository.store(input("notify"));
      await repository.markNotified(id);
      const first = await prisma.aiContactRequest.findUniqueOrThrow({
        where: { id },
      });
      assert.ok(first.notifiedAt);
      await repository.markNotified(id);
      const second = await prisma.aiContactRequest.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(second.notifiedAt?.getTime(), first.notifiedAt?.getTime());
      assert.equal((await repository.store(input("notify"))).notified, true);
    });

    it("handles a request once, by the first user, with one audit row; a second mark and an unknown id return null", async () => {
      const { id } = await repository.store(input("handle"));
      const view = await repository.markHandled(id, userId);
      assert.ok(view?.handledAt);
      const stored = await prisma.aiContactRequest.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(stored.handledById, userId);
      assert.equal(await repository.markHandled(id, null), null);
      assert.equal(
        await repository.markHandled("no-such-request", userId),
        null,
      );
      const after = await prisma.aiContactRequest.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(after.handledAt?.getTime(), stored.handledAt?.getTime());
      assert.equal(after.handledById, userId);
      const audit = await prisma.auditLog.findMany({
        where: { entityId: id, action: "ai-contact-request.handled" },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.userId, userId);
    });

    it("lists the newest first and honours the limit", async () => {
      const older = await repository.store(input("old"));
      await prisma.aiContactRequest.update({
        where: { id: older.id },
        data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      });
      const newer = await repository.store(input("new"));
      const rows = (await repository.list(500)).filter((row) =>
        row.conversationRef.endsWith(run),
      );
      const ids = rows.map((row) => row.id);
      assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id));
      assert.equal((await repository.list(1)).length, 1);
    });

    it("the database refuses an empty value and a value over 254 characters when the server's rule is bypassed", async () => {
      for (const value of ["", "   ", "x".repeat(255)])
        await assert.rejects(
          prisma.aiContactRequest.create({
            data: { ...input(`bad-${value.length}`), value },
          }),
          /AiContactRequest_value_shape|check constraint/i,
        );
    });
  },
);
