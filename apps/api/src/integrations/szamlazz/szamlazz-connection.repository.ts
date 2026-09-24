import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  SZAMLAZZ_CONNECTION_ID,
  SzamlazzConnectionError,
  type SzamlazzConnectionSettingRecord,
  type SzamlazzCredentialEnvelope,
} from "./szamlazz-connection.types.js";

/**
 * A Számlázz.hu Agent Key tárolása, az UNAS/Medusa kapcsolat-repository
 * mintájára. NINCS `claimCooldown("test")` ág, szemben a Medusával: nincs
 * ártalmatlan teszt-hívás, amit a visszatartás védene (lásd
 * szamlazz-connection.types.ts SzamlazzConnectionView doc-comment) -- csak
 * a kulcs-csere kap visszatartást.
 */
@Injectable()
export class SzamlazzConnectionRepository {
  async getSetting(): Promise<SzamlazzConnectionSettingRecord | null> {
    return prisma.szamlazzConnectionSetting.findUnique({
      where: { id: SZAMLAZZ_CONNECTION_ID },
    });
  }

  /**
   * VISSZATARTÁS, egyetlen lekérdezésben -- ugyanaz az indoklás, mint a
   * Medusa kapcsolat-repositoryban: a feltétel és az írás egy utasításban
   * van, hogy két egyszerre érkező csere közül pontosan az egyik nyerjen.
   */
  async claimCredentialCooldown(): Promise<SzamlazzConnectionSettingRecord | null> {
    const rows = await prisma.$queryRaw<SzamlazzConnectionSettingRecord[]>(
      Prisma.sql`
        UPDATE "SzamlazzConnectionSetting"
        SET "credentialAttemptedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${SZAMLAZZ_CONNECTION_ID}
          AND (
            "credentialAttemptedAt" IS NULL
            OR "credentialAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
          )
        RETURNING *
      `,
    );
    if (rows[0]) return rows[0];
    if (!(await this.getSetting()))
      throw new SzamlazzConnectionError(
        "SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING",
      );
    return null;
  }

  /**
   * Kulcs beállítása vagy cseréje. A `revision` ZÁR, ugyanúgy, mint a
   * Medusánál: a hívó a MEGLÉVŐ revízió plusz egyet adja át, és ha közben
   * más is írt, ez a feltétel elbukik.
   */
  async replaceCredential(input: {
    envelope: SzamlazzCredentialEnvelope;
    revision: number;
    actorUserId: string;
    updatedAt: Date;
  }): Promise<SzamlazzConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.szamlazzConnectionSetting.findUnique(
          { where: { id: SZAMLAZZ_CONNECTION_ID } },
        );
        if (!previous)
          throw new SzamlazzConnectionError(
            "SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING",
          );
        if (previous.credentialRevision + 1 !== input.revision)
          throw new Error("SZAMLAZZ_CONNECTION_CONCURRENT_UPDATE");
        const setting = await transaction.szamlazzConnectionSetting.update({
          where: { id: SZAMLAZZ_CONNECTION_ID },
          data: {
            credentialMode: "DATABASE",
            encryptedAgentKey: Uint8Array.from(
              input.envelope.encryptedAgentKey,
            ),
            agentKeyEncryptionIv: Uint8Array.from(input.envelope.encryptionIv),
            agentKeyAuthenticationTag: Uint8Array.from(
              input.envelope.authenticationTag,
            ),
            agentKeyVersion: input.envelope.keyVersion,
            credentialRevision: input.revision,
            credentialUpdatedAt: input.updatedAt,
            credentialUpdatedByUserId: input.actorUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.actorUserId,
            action: "szamlazz.connection.credential-rotated",
            entityType: "SzamlazzConnectionSetting",
            entityId: SZAMLAZZ_CONNECTION_ID,
            metadata: {
              changedFields: ["agentKey"],
              credentialRevision: input.revision,
              modeFrom: previous.credentialMode,
              modeTo: "DATABASE",
            } satisfies Prisma.JsonObject,
          },
        });
        return setting;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * A kapcsolat letiltása. A boríték mezőit ÜRESRE állítja, nem csak a
   * módot -- ugyanaz az indok, mint a Medusánál: egy letiltott kapcsolat
   * mellett ott felejtett titkosított kulcs olyan kockázat, amiért cserébe
   * semmit nem kapunk.
   */
  async disable(
    actorUserId: string,
    now: Date,
  ): Promise<SzamlazzConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.szamlazzConnectionSetting.findUnique(
          { where: { id: SZAMLAZZ_CONNECTION_ID } },
        );
        if (!previous)
          throw new SzamlazzConnectionError(
            "SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING",
          );
        const setting = await transaction.szamlazzConnectionSetting.update({
          where: { id: SZAMLAZZ_CONNECTION_ID },
          data: {
            credentialMode: "DISABLED",
            encryptedAgentKey: null,
            agentKeyEncryptionIv: null,
            agentKeyAuthenticationTag: null,
            agentKeyVersion: null,
            credentialUpdatedAt: now,
            credentialUpdatedByUserId: actorUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action: "szamlazz.connection.disabled",
            entityType: "SzamlazzConnectionSetting",
            entityId: SZAMLAZZ_CONNECTION_ID,
            metadata: {
              modeFrom: previous.credentialMode,
              modeTo: "DISABLED",
              credentialRevision: previous.credentialRevision,
            } satisfies Prisma.JsonObject,
          },
        });
        return setting;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
