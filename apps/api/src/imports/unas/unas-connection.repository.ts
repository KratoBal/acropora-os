import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  UNAS_CONNECTION_ID,
  UnasConnectionError,
  type StoredUnasVerificationStatus,
  type UnasConnectionErrorCode,
  type UnasConnectionSettingRecord,
  type UnasCredentialEnvelope,
} from "./unas-connection.types.js";

type CooldownOperation = "test" | "credential";

export interface ManualTestPersistenceResult {
  setting: UnasConnectionSettingRecord;
  stale: boolean;
}

@Injectable()
export class UnasConnectionRepository {
  async getSetting(): Promise<UnasConnectionSettingRecord | null> {
    return prisma.unasConnectionSetting.findUnique({
      where: { id: UNAS_CONNECTION_ID },
    });
  }

  async claimCooldown(
    operation: CooldownOperation,
  ): Promise<UnasConnectionSettingRecord | null> {
    const query =
      operation === "test"
        ? Prisma.sql`
            UPDATE "UnasConnectionSetting"
            SET "testAttemptedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${UNAS_CONNECTION_ID}
              AND (
                "testAttemptedAt" IS NULL
                OR "testAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '30 seconds'
              )
            RETURNING *
          `
        : Prisma.sql`
            UPDATE "UnasConnectionSetting"
            SET "credentialAttemptedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${UNAS_CONNECTION_ID}
              AND (
                "credentialAttemptedAt" IS NULL
                OR "credentialAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
              )
            RETURNING *
          `;
    const rows = await prisma.$queryRaw<UnasConnectionSettingRecord[]>(query);
    if (rows[0]) return rows[0];
    if (!(await this.getSetting()))
      throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
    return null;
  }

  async replaceCredential(input: {
    envelope: UnasCredentialEnvelope;
    revision: number;
    actorUserId: string;
    verifiedAt: Date;
    verificationStatus: "SUCCESS" | "INDETERMINATE";
    verificationCode: UnasConnectionErrorCode | null;
  }): Promise<UnasConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.unasConnectionSetting.findUnique({
          where: { id: UNAS_CONNECTION_ID },
        });
        if (!previous)
          throw new UnasConnectionError(
            "UNAS_CONNECTION_CONFIGURATION_MISSING",
          );
        if (previous.credentialRevision + 1 !== input.revision)
          throw new Error("UNAS_CONNECTION_CONCURRENT_UPDATE");
        const setting = await transaction.unasConnectionSetting.update({
          where: { id: UNAS_CONNECTION_ID },
          data: {
            credentialMode: "DATABASE",
            encryptedApiKey: Uint8Array.from(input.envelope.encryptedApiKey),
            encryptionIv: Uint8Array.from(input.envelope.encryptionIv),
            authenticationTag: Uint8Array.from(
              input.envelope.authenticationTag,
            ),
            keyVersion: input.envelope.keyVersion,
            credentialRevision: input.revision,
            credentialUpdatedAt: input.verifiedAt,
            credentialUpdatedByUserId: input.actorUserId,
            verificationStatus: input.verificationStatus,
            lastVerifiedAt: input.verifiedAt,
            lastVerificationCode: input.verificationCode,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.actorUserId,
            action: "unas.connection.credential-rotated",
            entityType: "UnasConnectionSetting",
            entityId: UNAS_CONNECTION_ID,
            metadata: {
              changedFields: ["apiKey"],
              credentialRevision: input.revision,
              modeFrom: previous.credentialMode,
              modeTo: "DATABASE",
              verificationStatus: input.verificationStatus,
              verificationCode: input.verificationCode,
            } satisfies Prisma.JsonObject,
          },
        });
        return setting;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disable(
    actorUserId: string,
    now: Date,
  ): Promise<UnasConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.unasConnectionSetting.findUnique({
          where: { id: UNAS_CONNECTION_ID },
        });
        if (!previous)
          throw new UnasConnectionError(
            "UNAS_CONNECTION_CONFIGURATION_MISSING",
          );
        const revision = previous.credentialRevision + 1;
        const setting = await transaction.unasConnectionSetting.update({
          where: { id: UNAS_CONNECTION_ID },
          data: {
            credentialMode: "DISABLED",
            encryptedApiKey: null,
            encryptionIv: null,
            authenticationTag: null,
            keyVersion: null,
            credentialRevision: revision,
            credentialUpdatedAt: now,
            credentialUpdatedByUserId: actorUserId,
            verificationStatus: "NEVER",
            lastVerifiedAt: null,
            lastVerificationCode: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action: "unas.connection.credential-disabled",
            entityType: "UnasConnectionSetting",
            entityId: UNAS_CONNECTION_ID,
            metadata: {
              changedFields: ["apiKey", "credentialMode"],
              credentialRevision: revision,
              modeFrom: previous.credentialMode,
              modeTo: "DISABLED",
            } satisfies Prisma.JsonObject,
          },
        });
        return setting;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async recordManualTest(input: {
    actorUserId: string;
    checkedAt: Date;
    status: Exclude<StoredUnasVerificationStatus, "NEVER">;
    code: UnasConnectionErrorCode | null;
    expectedCredentialMode: UnasConnectionSettingRecord["credentialMode"];
    expectedCredentialRevision: number;
  }): Promise<ManualTestPersistenceResult> {
    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.unasConnectionSetting.updateMany({
        where: {
          id: UNAS_CONNECTION_ID,
          credentialMode: input.expectedCredentialMode,
          credentialRevision: input.expectedCredentialRevision,
        },
        data: {
          verificationStatus: input.status,
          lastVerifiedAt: input.checkedAt,
          lastVerificationCode: input.code,
        },
      });
      const setting = await transaction.unasConnectionSetting.findUnique({
        where: { id: UNAS_CONNECTION_ID },
      });
      if (!setting)
        throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
      const stale = updated.count !== 1;
      await transaction.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "unas.connection.tested",
          entityType: "UnasConnectionSetting",
          entityId: UNAS_CONNECTION_ID,
          metadata: stale
            ? ({
                result: "STALE_TEST_RESULT",
                testedCredentialMode: input.expectedCredentialMode,
                testedCredentialRevision: input.expectedCredentialRevision,
                currentCredentialMode: setting.credentialMode,
                currentCredentialRevision: setting.credentialRevision,
              } satisfies Prisma.JsonObject)
            : ({
                result: input.status,
                code: input.code,
              } satisfies Prisma.JsonObject),
        },
      });
      return { setting, stale };
    });
  }

  async auditCredentialValidationFailure(
    actorUserId: string,
    code: UnasConnectionErrorCode,
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: "unas.connection.credential-validation-failed",
        entityType: "UnasConnectionSetting",
        entityId: UNAS_CONNECTION_ID,
        metadata: { code } satisfies Prisma.JsonObject,
      },
    });
  }
}
