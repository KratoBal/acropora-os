import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { AssistantBudgetRepository } from "./assistant-budget.repository.js";

const gate = integrationDatabaseGate(process.env);
describe(
  "Assistant shared rate budget integration",
  { skip: gate.mode === "skip" },
  () => {
    let userId: string;
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `assistant-budget-${randomUUID()}@example.invalid`,
            displayName: "Budget test",
            role: "ADMIN",
          },
        })
      ).id;
    });
    after(async () => {
      if (!userId) return;
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      assert.equal(await prisma.auditLog.count({ where: { userId } }), 0);
    });
    it("concurrent requests across repository instances admit exactly six and record no questions or tokens", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          new AssistantBudgetRepository().consume(userId),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        6,
      );
      for (const result of results)
        if (result.status === "rejected")
          assert.equal(result.reason.getStatus(), 429);
      const rows = await prisma.auditLog.findMany({ where: { userId } });
      assert.equal(rows.length, 6);
      for (const row of rows) {
        assert.equal(row.action, "assistant.ask");
        assert.equal(row.metadata, null);
      }
    });
  },
);
