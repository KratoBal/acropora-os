import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  MEDUSA_CONNECTION_ID,
  MedusaConnectionError,
  type MedusaConnectionErrorCode,
  type MedusaConnectionSettingRecord,
  type MedusaCredentialEnvelope,
} from "./medusa-connection.types.js";

type CooldownOperation = "test" | "credential";

/**
 * A Medusa admin kulcs tárolása, az UNAS kapcsolat-repository mintájára.
 *
 * A visszatartás (`claimCooldown`) ebben a körben került ide, a beállító
 * felülettel együtt: a teszt-gomb és a kulcs-csere is korlátozva van. Ez nem
 * csak védelem a másik oldal felé, hanem az, ami a tábla két utolsó mezőjét
 * ÍRT mezővé teszi.
 */
@Injectable()
export class MedusaConnectionRepository {
  async getSetting(): Promise<MedusaConnectionSettingRecord | null> {
    return prisma.medusaConnectionSetting.findUnique({
      where: { id: MEDUSA_CONNECTION_ID },
    });
  }

  /**
   * VISSZATARTÁS, egyetlen lekérdezésben.
   *
   * A feltétel és az írás ugyanabban az utasításban van, ezért két egyszerre
   * érkező kérés közül pontosan az egyik nyer: a másik nulla sort kap vissza. Ha
   * előbb olvasnánk és utána írnánk, a kettő között mindkettő átmenne.
   *
   * A két művelet külön mezőt és külön határidőt kap. A teszt olcsó és
   * ártalmatlan, ezért rövidebb (harminc másodperc); a kulcs-csere ritka és
   * súlyos, ezért hosszabb (hatvan). Ez az UNAS és a NAV mintája, változatlanul.
   *
   * A `credentialAttemptedAt` ezzel válik ÍRT mezővé. Enélkül ott állna a
   * táblában és a felületen anélkül, hogy bármi töltené, és pontosan azt
   * állítanánk elő magunknál, amit a Medusa `last_used_at` mezőjénél leletként
   * neveztünk meg.
   */
  async claimCooldown(
    operation: CooldownOperation,
  ): Promise<MedusaConnectionSettingRecord | null> {
    const query =
      operation === "test"
        ? Prisma.sql`
            UPDATE "MedusaConnectionSetting"
            SET "testAttemptedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${MEDUSA_CONNECTION_ID}
              AND (
                "testAttemptedAt" IS NULL
                OR "testAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '30 seconds'
              )
            RETURNING *
          `
        : Prisma.sql`
            UPDATE "MedusaConnectionSetting"
            SET "credentialAttemptedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${MEDUSA_CONNECTION_ID}
              AND (
                "credentialAttemptedAt" IS NULL
                OR "credentialAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
              )
            RETURNING *
          `;
    const rows = await prisma.$queryRaw<MedusaConnectionSettingRecord[]>(query);
    if (rows[0]) return rows[0];
    /**
     * Nulla sor KÉT dolgot jelenthet, és a kettő nem ugyanaz: vagy a
     * visszatartás fogta meg a kérést, vagy nincs is beállítás-sor. A második
     * hiba, tehát nem szabad „várj egy kicsit" válasznak látszania.
     */
    if (!(await this.getSetting()))
      throw new MedusaConnectionError(
        "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
      );
    return null;
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
