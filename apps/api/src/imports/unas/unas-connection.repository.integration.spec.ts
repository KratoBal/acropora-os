import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { UnasConnectionRepository } from "./unas-connection.repository.js";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

describe(
  "UnasConnectionRepository integration",
  { skip: !runIntegration },
  () => {
    const repository = new UnasConnectionRepository();
    let actorId = "";

    before(async () => {
      const actor = await prisma.user.create({
        data: {
          email: `unas-connection-${Date.now()}@example.invalid`,
          displayName: "UNAS connection integration actor",
          role: "ADMIN",
        },
      });
      actorId = actor.id;
      const migratedSingleton = await prisma.unasConnectionSetting.findUnique({
        where: { id: "unas" },
      });
      assert.equal(migratedSingleton?.credentialMode, "ENV_FALLBACK");
      await prisma.unasConnectionSetting.update({
        where: { id: "unas" },
        data: {
          credentialMode: "ENV_FALLBACK",
          encryptedApiKey: null,
          encryptionIv: null,
          authenticationTag: null,
          keyVersion: null,
          credentialRevision: 0,
          credentialUpdatedAt: null,
          credentialUpdatedByUserId: null,
          verificationStatus: "NEVER",
          lastVerifiedAt: null,
          lastVerificationCode: null,
          credentialAttemptedAt: null,
          testAttemptedAt: null,
        },
      });
    });

    after(async () => {
      await prisma.auditLog.deleteMany({
        where: { entityType: "UnasConnectionSetting", entityId: "unas" },
      });
      await prisma.unasConnectionSetting.update({
        where: { id: "unas" },
        data: {
          credentialMode: "ENV_FALLBACK",
          encryptedApiKey: null,
          encryptionIv: null,
          authenticationTag: null,
          keyVersion: null,
          credentialUpdatedByUserId: null,
          verificationStatus: "NEVER",
          lastVerifiedAt: null,
          lastVerificationCode: null,
        },
      });
      if (actorId) await prisma.user.delete({ where: { id: actorId } });
      await prisma.$disconnect();
    });

    it("atomically stores and disables an encrypted envelope with secret-free audit", async () => {
      const now = new Date("2026-07-20T12:00:00.000Z");
      const stored = await repository.replaceCredential({
        envelope: {
          encryptedApiKey: Buffer.from("opaque-ciphertext"),
          encryptionIv: Buffer.alloc(12, 1),
          authenticationTag: Buffer.alloc(16, 2),
          keyVersion: "1",
        },
        revision: 1,
        actorUserId: actorId,
        verifiedAt: now,
        verificationStatus: "SUCCESS",
        verificationCode: null,
      });
      assert.equal(stored.credentialMode, "DATABASE");
      assert.equal(stored.credentialRevision, 1);

      const rotationAudit = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: "unas.connection.credential-rotated",
          userId: actorId,
        },
        orderBy: { createdAt: "desc" },
      });
      const auditText = JSON.stringify(rotationAudit.metadata);
      assert.equal(auditText.includes("opaque-ciphertext"), false);
      assert.equal(auditText.includes("apiKey"), true);

      const disabled = await repository.disable(
        actorId,
        new Date(now.getTime() + 1),
      );
      assert.equal(disabled.credentialMode, "DISABLED");
      assert.equal(disabled.encryptedApiKey, null);
      assert.equal(disabled.encryptionIv, null);
      assert.equal(disabled.authenticationTag, null);
      assert.equal(disabled.keyVersion, null);
    });

    it("claims cooldown atomically and audits manual tests without payload", async () => {
      await prisma.unasConnectionSetting.update({
        where: { id: "unas" },
        data: { testAttemptedAt: null },
      });
      const now = new Date("2026-07-20T13:00:00.000Z");
      assert.ok(await repository.claimCooldown("test"));
      assert.equal(await repository.claimCooldown("test"), null);

      await repository.recordManualTest({
        actorUserId: actorId,
        checkedAt: now,
        status: "FAILED",
        code: "UNAS_CONNECTION_TIMEOUT",
        expectedCredentialMode: "DISABLED",
        expectedCredentialRevision: 2,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "unas.connection.tested", userId: actorId },
        orderBy: { createdAt: "desc" },
      });
      assert.deepEqual(audit.metadata, {
        result: "FAILED",
        code: "UNAS_CONNECTION_TIMEOUT",
      });
    });

    it("uses PostgreSQL time for the cooldown despite extreme application clocks", async () => {
      const applicationClocks = [
        new Date("1900-01-01T00:00:00.000Z"),
        new Date("2999-12-31T23:59:59.000Z"),
      ];
      assert.equal(applicationClocks.length, 2);
      await prisma.$executeRaw`
        UPDATE "UnasConnectionSetting"
        SET "testAttemptedAt" = CURRENT_TIMESTAMP - INTERVAL '31 seconds'
        WHERE "id" = 'unas'
      `;
      assert.ok(await repository.claimCooldown("test"));
      assert.equal(await repository.claimCooldown("test"), null);
      const [age] = await prisma.$queryRaw<Array<{ ageSeconds: unknown }>>`
        SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "testAttemptedAt")) AS "ageSeconds"
        FROM "UnasConnectionSetting"
        WHERE "id" = 'unas'
      `;
      assert.ok(Number(age?.ageSeconds) >= 0);
      assert.ok(Number(age?.ageSeconds) < 5);
    });

    it("does not persist a stale test result after a credential replacement", async () => {
      await prisma.unasConnectionSetting.update({
        where: { id: "unas" },
        data: { testAttemptedAt: null },
      });
      const tested = await repository.claimCooldown("test");
      assert.ok(tested);
      const replacement = await repository.replaceCredential({
        envelope: {
          encryptedApiKey: Buffer.from("replacement-ciphertext"),
          encryptionIv: Buffer.alloc(12, 3),
          authenticationTag: Buffer.alloc(16, 4),
          keyVersion: "1",
        },
        revision: tested.credentialRevision + 1,
        actorUserId: actorId,
        verifiedAt: new Date("2026-07-20T14:00:00.000Z"),
        verificationStatus: "SUCCESS",
        verificationCode: null,
      });
      const persisted = await repository.recordManualTest({
        actorUserId: actorId,
        checkedAt: new Date("2026-07-20T14:00:01.000Z"),
        status: "FAILED",
        code: "UNAS_CONNECTION_TIMEOUT",
        expectedCredentialMode: tested.credentialMode,
        expectedCredentialRevision: tested.credentialRevision,
      });
      assert.equal(persisted.stale, true);
      assert.equal(
        persisted.setting.credentialRevision,
        replacement.credentialRevision,
      );
      assert.equal(persisted.setting.verificationStatus, "SUCCESS");
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "unas.connection.tested", userId: actorId },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(
        (audit.metadata as Record<string, unknown>).result,
        "STALE_TEST_RESULT",
      );
    });

    it("does not persist a stale test result after disable", async () => {
      await prisma.unasConnectionSetting.update({
        where: { id: "unas" },
        data: { testAttemptedAt: null },
      });
      const tested = await repository.claimCooldown("test");
      assert.ok(tested);
      const disabled = await repository.disable(
        actorId,
        new Date("2026-07-20T15:00:00.000Z"),
      );
      const persisted = await repository.recordManualTest({
        actorUserId: actorId,
        checkedAt: new Date("2026-07-20T15:00:01.000Z"),
        status: "SUCCESS",
        code: null,
        expectedCredentialMode: tested.credentialMode,
        expectedCredentialRevision: tested.credentialRevision,
      });
      assert.equal(persisted.stale, true);
      assert.equal(
        persisted.setting.credentialRevision,
        disabled.credentialRevision,
      );
      assert.equal(persisted.setting.credentialMode, "DISABLED");
      assert.equal(persisted.setting.verificationStatus, "NEVER");
    });

    it("rejects a non-allowlisted verification code at the database boundary", async () => {
      const sensitiveValue = "private-value-must-never-be-public";
      await assert.rejects(
        prisma.$executeRaw`
          UPDATE "UnasConnectionSetting"
          SET "lastVerificationCode" = ${sensitiveValue}
          WHERE "id" = 'unas'
        `,
      );
      const current = await repository.getSetting();
      assert.notEqual(current?.lastVerificationCode, sensitiveValue);
    });

    it("fails closed when the singleton row is absent", async () => {
      await prisma.unasConnectionSetting.delete({ where: { id: "unas" } });
      try {
        await assert.rejects(
          repository.claimCooldown("test"),
          /UNAS_CONNECTION_CONFIGURATION_MISSING/,
        );
      } finally {
        await prisma.unasConnectionSetting.create({
          data: { id: "unas", credentialMode: "ENV_FALLBACK" },
        });
      }
    });
  },
);
