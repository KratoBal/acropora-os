import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

/** A javasolt dokumentum állapota (`IncomingSupplierDocument.reviewState`). */
export const SUGGESTED = "SUGGESTED";

export interface SuggestionRow {
  id: string;
  fileName: string;
  sender: string | null;
  subject: string | null;
  receivedAt: Date | null;
  suggestionConfidence: Prisma.Decimal | null;
  suggestionDecisionRunId: string | null;
  textReading: Prisma.JsonValue;
  createdAt: Date;
}

/** Egy döntés eredménye: `false`, ha a javaslat már nem vár döntésre. */
export type SuggestionDecided = boolean;

/**
 * A JEV JAVASLATAINAK ADATBÁZIS-OLDALA (levél-válogatás terv, 4. szelet;
 * acrobot 25803). Egy javaslat egy `reviewState = SUGGESTED` dokumentum, és a
 * begyűjtés `SUGGESTED` ítéletű sora mutat rá.
 *
 * MINDKÉT DÖNTÉS FELTÉTELES ÍRÁS: csak SUGGESTED állapotú dokumentumon hat, tehát
 * egy közben meghozott másik döntést nem ír felül, és kétszer sem fut le.
 */
@Injectable()
export class InvoiceCollectionSuggestionsRepository {
  private readonly database = prisma;

  list(): Promise<SuggestionRow[]> {
    return this.database.incomingSupplierDocument.findMany({
      where: { reviewState: SUGGESTED },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        fileName: true,
        sender: true,
        subject: true,
        receivedAt: true,
        suggestionConfidence: true,
        suggestionDecisionRunId: true,
        textReading: true,
        createdAt: true,
      },
    });
  }

  /** A javasolt PDF, hogy a döntő lássa; csak döntésre váró dokumentumé. */
  file(id: string): Promise<{ fileName: string; content: Uint8Array } | null> {
    return this.database.incomingSupplierDocument.findFirst({
      where: { id, reviewState: SUGGESTED },
      select: { fileName: true, content: true },
    });
  }

  /**
   * ELFOGADÁS: a dokumentum rendes begyűjtött dokumentum lesz (a jelöltek közé
   * kerül), a begyűjtés sora STORED. Ki és mikor: a dokumentumon és az
   * auditnaplóban.
   */
  accept(id: string, userId: string): Promise<SuggestionDecided> {
    return this.database.$transaction(async (transaction) => {
      const before = await transaction.incomingSupplierDocument.findFirst({
        where: { id, reviewState: SUGGESTED },
        select: {
          fileName: true,
          suggestionConfidence: true,
          suggestionDecisionRunId: true,
        },
      });
      if (!before) return false;
      const { count } = await transaction.incomingSupplierDocument.updateMany({
        where: { id, reviewState: SUGGESTED },
        data: {
          reviewState: null,
          reviewedAt: new Date(),
          reviewedByUserId: userId,
        },
      });
      if (count === 0) return false;
      await transaction.invoiceCollectionItem.updateMany({
        where: { documentId: id, verdict: SUGGESTED },
        data: { verdict: "STORED" },
      });
      await resolveRun(transaction, before.suggestionDecisionRunId, "ACCEPTED");
      await transaction.auditLog.create({
        data: {
          userId,
          action: "invoice-collection.suggestion-accepted",
          entityType: "IncomingSupplierDocument",
          entityId: id,
          metadata: {
            fileName: before.fileName,
            confidence: before.suggestionConfidence?.toString() ?? null,
            decisionRunId: before.suggestionDecisionRunId,
          },
        },
      });
      return true;
    });
  }

  /**
   * ELVETÉS: a dokumentum TÖRLŐDIK (egy nem számla PDF-jének tartalma nem marad
   * az adatbázisban, mint a begyűjtés minden nem tárolt fájljáé), a begyűjtés
   * sora NOT_INVOICE, és a következő futás sem olvassa újra (az ítélet végleges).
   * Az auditnapló a fájl nevét, lenyomatát és a Jev adatait őrzi, a tartalmát nem.
   */
  reject(id: string, userId: string): Promise<SuggestionDecided> {
    return this.database
      .$transaction(async (transaction) => {
        const before = await transaction.incomingSupplierDocument.findFirst({
          where: { id, reviewState: SUGGESTED },
          select: {
            fileName: true,
            sha256: true,
            suggestionConfidence: true,
            suggestionDecisionRunId: true,
          },
        });
        if (!before) return false;
        await transaction.invoiceCollectionItem.updateMany({
          where: { documentId: id, verdict: SUGGESTED },
          data: { verdict: "NOT_INVOICE", documentId: null },
        });
        const { count } = await transaction.incomingSupplierDocument.deleteMany(
          {
            where: { id, reviewState: SUGGESTED },
          },
        );
        // közben egy elfogadás megelőzte: a sor-módosítás se maradjon meg
        if (count === 0) throw new SuggestionAlreadyDecided();
        await resolveRun(
          transaction,
          before.suggestionDecisionRunId,
          "OVERRIDDEN",
        );
        await transaction.auditLog.create({
          data: {
            userId,
            action: "invoice-collection.suggestion-rejected",
            entityType: "IncomingSupplierDocument",
            entityId: id,
            metadata: {
              fileName: before.fileName,
              sha256: before.sha256,
              confidence: before.suggestionConfidence?.toString() ?? null,
              decisionRunId: before.suggestionDecisionRunId,
            },
          },
        });
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof SuggestionAlreadyDecided) return false;
        throw error;
      });
  }
}

/**
 * A JEV FUTÁSÁNAK FELOLDÁSA (nautilus #1356: a 4. szelet oldja fel a futást a
 * decisionRunId alapján). Elfogadva ACCEPTED, a Jev osztályával; elvetve
 * OVERRIDDEN, és az ember ítélete NOT_INVOICE. Csak nyitott futást old fel: egy
 * közben STALE-re állítottat nem ír felül.
 */
async function resolveRun(
  transaction: Prisma.TransactionClient,
  decisionRunId: string | null,
  resolution: "ACCEPTED" | "OVERRIDDEN",
): Promise<void> {
  if (!decisionRunId) return;
  await transaction.decisionRun.updateMany({
    where: { id: decisionRunId, resolution: null },
    data: {
      resolution,
      resolvedValue:
        resolution === "ACCEPTED" ? "BEJOVO_SZAMLA" : "NOT_INVOICE",
      resolvedAt: new Date(),
    },
  });
}

/** A tranzakció visszagörgetéséhez: a javaslatról közben már döntöttek. */
class SuggestionAlreadyDecided extends Error {}
