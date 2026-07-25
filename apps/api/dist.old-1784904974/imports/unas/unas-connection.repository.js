var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import { UNAS_CONNECTION_ID, UnasConnectionError, } from "./unas-connection.types.js";
let UnasConnectionRepository = class UnasConnectionRepository {
    async getSetting() {
        return prisma.unasConnectionSetting.findUnique({
            where: { id: UNAS_CONNECTION_ID },
        });
    }
    async claimCooldown(operation) {
        const query = operation === "test"
            ? Prisma.sql `
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
            : Prisma.sql `
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
        const rows = await prisma.$queryRaw(query);
        if (rows[0])
            return rows[0];
        if (!(await this.getSetting()))
            throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
        return null;
    }
    async replaceCredential(input) {
        return prisma.$transaction(async (transaction) => {
            const previous = await transaction.unasConnectionSetting.findUnique({
                where: { id: UNAS_CONNECTION_ID },
            });
            if (!previous)
                throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
            if (previous.credentialRevision + 1 !== input.revision)
                throw new Error("UNAS_CONNECTION_CONCURRENT_UPDATE");
            const setting = await transaction.unasConnectionSetting.update({
                where: { id: UNAS_CONNECTION_ID },
                data: {
                    credentialMode: "DATABASE",
                    encryptedApiKey: Uint8Array.from(input.envelope.encryptedApiKey),
                    encryptionIv: Uint8Array.from(input.envelope.encryptionIv),
                    authenticationTag: Uint8Array.from(input.envelope.authenticationTag),
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
                    },
                },
            });
            return setting;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    async disable(actorUserId, now) {
        return prisma.$transaction(async (transaction) => {
            const previous = await transaction.unasConnectionSetting.findUnique({
                where: { id: UNAS_CONNECTION_ID },
            });
            if (!previous)
                throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
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
                    },
                },
            });
            return setting;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    async recordManualTest(input) {
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
                        ? {
                            result: "STALE_TEST_RESULT",
                            testedCredentialMode: input.expectedCredentialMode,
                            testedCredentialRevision: input.expectedCredentialRevision,
                            currentCredentialMode: setting.credentialMode,
                            currentCredentialRevision: setting.credentialRevision,
                        }
                        : {
                            result: input.status,
                            code: input.code,
                        },
                },
            });
            return { setting, stale };
        });
    }
    async auditCredentialValidationFailure(actorUserId, code) {
        await prisma.auditLog.create({
            data: {
                userId: actorUserId,
                action: "unas.connection.credential-validation-failed",
                entityType: "UnasConnectionSetting",
                entityId: UNAS_CONNECTION_ID,
                metadata: { code },
            },
        });
    }
};
UnasConnectionRepository = __decorate([
    Injectable()
], UnasConnectionRepository);
export { UnasConnectionRepository };
//# sourceMappingURL=unas-connection.repository.js.map