import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  NAV_CONNECTION_ID,
  NavConnectionError,
  type NavConnectionErrorCode,
  type NavConnectionSettingRecord,
  type NavCredentialEnvelope,
  type StoredNavVerificationStatus,
} from "./nav-connection.types.js";

type CooldownOperation = "test" | "credential";

@Injectable()
export class NavConnectionRepository {
  async getSetting(): Promise<NavConnectionSettingRecord | null> {
    return prisma.navConnectionSetting.findUnique({
      where: { id: NAV_CONNECTION_ID },
    });
  }

  async claimCooldown(
    operation: CooldownOperation,
  ): Promise<NavConnectionSettingRecord | null> {
    const query =
      operation === "test"
        ? Prisma.sql`
            UPDATE "NavConnectionSetting"
            SET "testAttemptedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${NAV_CONNECTION_ID}
              AND (
                "testAttemptedAt" IS NULL
                OR "testAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '30 seconds'
              )
            RETURNING *
          `
        : Prisma.sql`
            UPDATE "NavConnectionSetting"
            SET "credentialAttemptedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${NAV_CONNECTION_ID}
              AND (
                "credentialAttemptedAt" IS NULL
                OR "credentialAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
              )
            RETURNING *
          `;
    const rows = await prisma.$queryRaw<NavConnectionSettingRecord[]>(query);
    if (rows[0]) return rows[0];
    if (!(await this.getSetting()))
      throw new NavConnectionError("NAV_CONNECTION_CONFIGURATION_MISSING");
    return null;
  }

  async replaceCredential(input: {
    envelope: NavCredentialEnvelope;
    revision: number;
    actorUserId: string;
    verifiedAt: Date;
  }): Promise<NavConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.navConnectionSetting.findUnique({
          where: { id: NAV_CONNECTION_ID },
        });
        if (!previous)
          throw new NavConnectionError("NAV_CONNECTION_CONFIGURATION_MISSING");
        if (previous.credentialRevision + 1 !== input.revision)
          throw new Error("NAV_CONNECTION_CONCURRENT_UPDATE");
        const setting = await transaction.navConnectionSetting.update({
          where: { id: NAV_CONNECTION_ID },
          data: {
            credentialMode: "DATABASE",
            encryptedCredentials: Uint8Array.from(
              input.envelope.encryptedCredentials,
            ),
            encryptionIv: Uint8Array.from(input.envelope.encryptionIv),
            authenticationTag: Uint8Array.from(
              input.envelope.authenticationTag,
            ),
            keyVersion: input.envelope.keyVersion,
            credentialRevision: input.revision,
            credentialUpdatedAt: input.verifiedAt,
            credentialUpdatedByUserId: input.actorUserId,
            verificationStatus: "SUCCESS",
            lastVerifiedAt: input.verifiedAt,
            lastVerificationCode: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.actorUserId,
            action: "nav.connection.credential-rotated",
            entityType: "NavConnectionSetting",
            entityId: NAV_CONNECTION_ID,
            metadata: {
              changedFields: ["credentials"],
              credentialRevision: input.revision,
              modeFrom: previous.credentialMode,
              modeTo: "DATABASE",
              verificationStatus: "SUCCESS",
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
  ): Promise<NavConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.navConnectionSetting.findUnique({
          where: { id: NAV_CONNECTION_ID },
        });
        if (!previous)
          throw new NavConnectionError("NAV_CONNECTION_CONFIGURATION_MISSING");
        const revision = previous.credentialRevision + 1;
        const setting = await transaction.navConnectionSetting.update({
          where: { id: NAV_CONNECTION_ID },
          data: {
            credentialMode: "DISABLED",
            encryptedCredentials: null,
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
            action: "nav.connection.credential-disabled",
            entityType: "NavConnectionSetting",
            entityId: NAV_CONNECTION_ID,
            metadata: {
              changedFields: ["credentials", "credentialMode"],
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
    status: Exclude<StoredNavVerificationStatus, "NEVER">;
    code: NavConnectionErrorCode | null;
    expectedCredentialMode: NavConnectionSettingRecord["credentialMode"];
    expectedCredentialRevision: number;
  }): Promise<NavConnectionSettingRecord> {
    return prisma.$transaction(async (transaction) => {
      await transaction.navConnectionSetting.updateMany({
        where: {
          id: NAV_CONNECTION_ID,
          credentialMode: input.expectedCredentialMode,
          credentialRevision: input.expectedCredentialRevision,
        },
        data: {
          verificationStatus: input.status,
          lastVerifiedAt: input.checkedAt,
          lastVerificationCode: input.code,
        },
      });
      const setting = await transaction.navConnectionSetting.findUnique({
        where: { id: NAV_CONNECTION_ID },
      });
      if (!setting)
        throw new NavConnectionError("NAV_CONNECTION_CONFIGURATION_MISSING");
      await transaction.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "nav.connection.tested",
          entityType: "NavConnectionSetting",
          entityId: NAV_CONNECTION_ID,
          metadata: {
            result: input.status,
            code: input.code,
            testedCredentialRevision: input.expectedCredentialRevision,
          } satisfies Prisma.JsonObject,
        },
      });
      return setting;
    });
  }

  async auditCredentialValidationFailure(
    actorUserId: string,
    code: NavConnectionErrorCode,
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: "nav.connection.credential-validation-failed",
        entityType: "NavConnectionSetting",
        entityId: NAV_CONNECTION_ID,
        metadata: { code } satisfies Prisma.JsonObject,
      },
    });
  }
}
