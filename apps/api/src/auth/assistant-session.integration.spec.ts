import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma, PrismaClient } from "@acropora/database";
import {
  SessionRepository,
  ASSISTANT_SESSION_TTL_MS,
} from "./session.repository.js";
import { hashSessionToken } from "./session-token.util.js";
import { AssistantAuditRepository } from "./assistant-audit.repository.js";
import {
  AssistantAuditMiddleware,
  type AssistantHttpResponse,
} from "./assistant-audit.middleware.js";
import { UnauthorizedException } from "@nestjs/common";

import { integrationDatabaseGate } from "../common/integration-database.js";
const gate = integrationDatabaseGate(process.env);
const enabled = gate.mode !== "skip";
const userId = `sutyerak-${Date.now()}`;
const client = new PrismaClient();
const writer = new SessionRepository();
const reader = new SessionRepository();
Object.defineProperty(reader, "database", { value: client });

describe("assistant sessions on PostgreSQL", { skip: !enabled }, () => {
  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        displayName: "Sutyerák test",
        role: "SERVICE",
      },
    });
  });
  after(async () => {
    if (gate.mode !== "run") return;
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await client.$disconnect();
    await prisma.$disconnect();
  });

  it("migration backfills a legacy session to USER without changing its expiry", async () => {
    const migration = await readFile(
      new URL(
        "../../../../packages/database/prisma/migrations/20261002150000_assistant_readonly_session/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE SCHEMA "sutyerak_migration_test"');
      await tx.$executeRawUnsafe(
        'SET LOCAL search_path TO "sutyerak_migration_test", public',
      );
      await tx.$executeRawUnsafe(
        'CREATE TABLE "Session" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP NOT NULL)',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "Session" VALUES ('legacy', 'actor', '2026-10-02 15:00:00')`,
      );
      for (const sql of migration.split(";").filter((sql) => sql.trim()))
        await tx.$executeRawUnsafe(sql);
      const rows = await tx.$queryRaw<
        Array<{ kind: string; expiresAt: Date }>
      >`SELECT "kind", "expiresAt" FROM "Session" WHERE "id" = 'legacy'`;
      assert.equal(rows[0]!.kind, "USER");
      assert.equal(
        rows[0]!.expiresAt.toISOString(),
        "2026-10-02T15:00:00.000Z",
      );
      await tx.$executeRawUnsafe(
        'DROP SCHEMA "sutyerak_migration_test" CASCADE',
      );
    });
  });

  it("default USER and max three concurrent assistants across independent clients", async () => {
    const userSession = await writer.create(userId, `${userId}-user`, 60_000);
    assert.equal(userSession.kind, "USER");
    const before = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? reader : writer).createAssistant(
          userId,
          `${userId}-assistant-${i}`,
        ),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      3,
    );
    for (const result of results) {
      if (result.status === "rejected")
        assert.equal(result.reason.getStatus(), 429);
      else {
        assert.equal(result.value.kind, "ASSISTANT_READONLY");
        assert.ok(
          result.value.expiresAt.getTime() >= before + ASSISTANT_SESSION_TTL_MS,
        );
        assert.ok(
          result.value.expiresAt.getTime() <=
            Date.now() + ASSISTANT_SESSION_TTL_MS,
        );
      }
    }
    assert.equal(
      await prisma.session.count({
        where: { userId, kind: "ASSISTANT_READONLY" },
      }),
      3,
    );
  });

  it("fixed expiry and no session update/delete on active or expired lookup; expiry frees a slot", async () => {
    const row = await prisma.session.findFirstOrThrow({
      where: { userId, kind: "ASSISTANT_READONLY" },
    });
    const token = Array.from(
      { length: 12 },
      (_, i) => `${userId}-assistant-${i}`,
    ).find((token) => hashSessionToken(token) === row.tokenHash)!;
    const initial = await prisma.session.findUniqueOrThrow({
      where: { id: row.id },
    });
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await reader.findActive(token, 8 * 60 * 60 * 1000))?.extended,
        false,
      );
    assert.deepEqual(
      await prisma.session.findUniqueOrThrow({ where: { id: row.id } }),
      initial,
    );
    await prisma.session.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    const expired = await prisma.session.findUniqueOrThrow({
      where: { id: row.id },
    });
    assert.equal(await reader.findActive(token, 8 * 60 * 60 * 1000), null);
    assert.deepEqual(
      await prisma.session.findUniqueOrThrow({ where: { id: row.id } }),
      expired,
    );
    await reader.createAssistant(userId, `${userId}-replacement`);
    assert.equal(
      await prisma.session.count({
        where: {
          userId,
          kind: "ASSISTANT_READONLY",
          expiresAt: { gt: new Date() },
        },
      }),
      3,
    );
  });

  it("expired assistant attempt persists actor/endpoint/timestamp/401 audit while preserving the row", async () => {
    const row = await prisma.session.findFirstOrThrow({
      where: { userId, kind: "ASSISTANT_READONLY", expiresAt: new Date(0) },
    });
    const token = Array.from(
      { length: 12 },
      (_, i) => `${userId}-assistant-${i}`,
    ).find((token) => hashSessionToken(token) === row.tokenHash)!;
    const callbacks: Record<string, () => void> = {};
    const audit = new AssistantAuditRepository();
    let completed: Promise<void> | undefined;
    const complete = audit.complete.bind(audit);
    audit.complete = (...args) => (completed = complete(...args));
    const response: AssistantHttpResponse = {
      statusCode: 401,
      once: (event, listener) => {
        callbacks[event] = listener;
      },
    };
    await assert.rejects(
      new AssistantAuditMiddleware(reader, audit).use(
        {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          originalUrl: "/products?do-not-log=this",
        },
        response,
        () => assert.fail("expired token must not proceed"),
      ),
      UnauthorizedException,
    );
    callbacks.finish!();
    await completed;
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { userId, action: "assistant.request" },
    });
    const metadata = log.metadata as Record<string, unknown>;
    assert.equal(metadata.actorUserId, userId);
    assert.equal(metadata.endpoint, "/products");
    assert.equal(metadata.status, 401);
    assert.equal(metadata.result, "REJECTED");
    assert.ok(!Number.isNaN(Date.parse(String(metadata.timestamp))));
    assert.equal(log.entityId, row.id);
    assert.ok(!JSON.stringify(log).includes(token));
    assert.deepEqual(
      await prisma.session.findUniqueOrThrow({ where: { id: row.id } }),
      row,
    );
  });
});
