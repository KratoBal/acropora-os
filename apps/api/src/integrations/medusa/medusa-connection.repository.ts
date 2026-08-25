import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  MEDUSA_CONNECTION_ID,
  MedusaConnectionError,
  type MedusaConnectionErrorCode,
  type MedusaConnectionSettingRecord,
  type MedusaCredentialEnvelope,
} from "./medusa-connection.types.js";

/**
 * A Medusa admin kulcs tárolása. Az UNAS kapcsolat-repository mintája, a
 * kör határához igazítva: ami itt van, az a HELY. A kapcsolat tesztelése és a
 * hozzá tartozó várakoztatás a következő körben épül meg, amikor a modul is.
 */
@Injectable()
export class MedusaConnectionRepository {
  async getSetting(): Promise<MedusaConnectionSettingRecord | null> {
    return prisma.medusaConnectionSetting.findUnique({
      where: { id: MEDUSA_CONNECTION_ID },
    });
  }

  /**
   * Kulcs beállítása vagy cseréje.
   *
   * A `revision` nem sorszám-kozmetika, hanem ZÁR: a hívó a MEGLÉVŐ revízió
   * plusz egyet adja át, és ha közben más is írt, ez a feltétel elbukik. Két
   * párhuzamos csere közül így pontosan az egyik megy át, a másik hibát kap
   * ahelyett, hogy csendben felülírná az elsőt.
   *
   * A revízió emellett a hitelesített kiegészítő adat része is, tehát egy régi
   * boríték nem fejthető vissza az új revízióhoz: aki a sorokat összekeverné,
   * hibát kap, nem rossz kulcsot.
   */
  async replaceCredential(input: {
    envelope: MedusaCredentialEnvelope;
    revision: number;
    actorUserId: string;
    updatedAt: Date;
  }): Promise<MedusaConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.medusaConnectionSetting.findUnique({
          where: { id: MEDUSA_CONNECTION_ID },
        });
        if (!previous)
          throw new MedusaConnectionError(
            "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
          );
        if (previous.credentialRevision + 1 !== input.revision)
          throw new Error("MEDUSA_CONNECTION_CONCURRENT_UPDATE");
        const setting = await transaction.medusaConnectionSetting.update({
          where: { id: MEDUSA_CONNECTION_ID },
          data: {
            credentialMode: "DATABASE",
            encryptedApiKey: Uint8Array.from(input.envelope.encryptedApiKey),
            encryptionIv: Uint8Array.from(input.envelope.encryptionIv),
            authenticationTag: Uint8Array.from(
              input.envelope.authenticationTag,
            ),
            keyVersion: input.envelope.keyVersion,
            credentialRevision: input.revision,
            credentialUpdatedAt: input.updatedAt,
            credentialUpdatedByUserId: input.actorUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.actorUserId,
            action: "medusa.connection.credential-rotated",
            entityType: "MedusaConnectionSetting",
            entityId: MEDUSA_CONNECTION_ID,
            metadata: {
              changedFields: ["apiKey"],
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
   * A kapcsolat letiltása. A boríték mezőit ÜRESRE állítja, nem csak a módot:
   * egy letiltott kapcsolat mellett ott felejtett titkosított kulcs olyan
   * kockázat, amiért cserébe semmit nem kapunk.
   */
  async disable(
    actorUserId: string,
    now: Date,
  ): Promise<MedusaConnectionSettingRecord> {
    return prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.medusaConnectionSetting.findUnique({
          where: { id: MEDUSA_CONNECTION_ID },
        });
        if (!previous)
          throw new MedusaConnectionError(
            "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
          );
        const setting = await transaction.medusaConnectionSetting.update({
          where: { id: MEDUSA_CONNECTION_ID },
          data: {
            credentialMode: "DISABLED",
            encryptedApiKey: null,
            encryptionIv: null,
            authenticationTag: null,
            keyVersion: null,
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
            action: "medusa.connection.disabled",
            entityType: "MedusaConnectionSetting",
            entityId: MEDUSA_CONNECTION_ID,
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

  /**
   * A legutóbbi ellenőrzés eredménye. A `code` szándékosan `string`, nem a szűk
   * hibakód-típus: a következő körben a hívás oldali kódok is ide kerülnek, és
   * egy régi sort nem szabad azért eldobni, mert azóta bővült a felsorolás.
   */
  async recordVerification(input: {
    status: "SUCCESS" | "FAILED" | "INDETERMINATE";
    code: MedusaConnectionErrorCode | string | null;
    checkedAt: Date;
  }): Promise<MedusaConnectionSettingRecord> {
    return prisma.medusaConnectionSetting.update({
      where: { id: MEDUSA_CONNECTION_ID },
      data: {
        verificationStatus: input.status,
        lastVerifiedAt: input.checkedAt,
        lastVerificationCode: input.code,
        testAttemptedAt: input.checkedAt,
      },
    });
  }
}
