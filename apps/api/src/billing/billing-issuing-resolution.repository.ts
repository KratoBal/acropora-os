import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import type {
  BuyerSnapshot,
  SentLineAmounts,
} from "./billing-document-issue.js";
import { OWN_ROWS } from "./billing-own-rows.js";

/**
 * A KIVEZETŐ ÚT ÍRÁSAI (kártya 38e9271d). Minden írás FELTÉTELES: csak a
 * megerősített állapotú, ISSUING-ben álló, saját soron megy
 * (`status = ISSUING AND updatedAt = a megerősített`), és az AuditLog-sor
 * UGYANABBAN a tranzakcióban születik, mint az állapotváltás. Az írás maga
 * használja el az egyszeri megerősítést: a második kísérlet már nem ISSUING
 * sort talál.
 *
 * A KÜLÖN OSZTÁLY NEM VÉLETLEN: a kiállító repository `markIssued` útja a
 * normál kiállítás része, és annak a feltétele (ISSUING) más, mint ennek
 * (ISSUING ÉS a megerősített `updatedAt`).
 */
export const ISSUING_AUDIT = {
  check: "BILLING_ISSUING_CHECKED",
  recorded: "BILLING_ISSUING_RECORDED_ISSUED",
  backToDraft: "BILLING_ISSUING_BACK_TO_DRAFT",
} as const;

@Injectable()
export class BillingIssuingResolutionRepository {
  private readonly database = prisma;

  /** Az ellenőrzés nyoma. Csak szám, végösszeg és hibakód kerül a metaadatba, XML nem. */
  async audit(input: {
    actorUserId: string;
    invoiceId: string;
    action: string;
    metadata: Prisma.InputJsonObject;
  }): Promise<void> {
    await this.database.auditLog.create({
      data: {
        userId: input.actorUserId,
        action: input.action,
        entityType: "Invoice",
        entityId: input.invoiceId,
        metadata: input.metadata,
      },
    });
  }

  /**
   * A POZITÍV KONTROLL ALANYA: a legutóbb kiállított saját bizonylat, amelyet
   * a kiállítási út a külső azonosítójával (`szamlaKulsoAzon = Invoice.id`)
   * küldött. Ha nincs, a "nincs ilyen azonosító" válasz nem igazolható.
   */
  latestIssuedForControl(): Promise<{
    id: string;
    invoiceNumber: string;
  } | null> {
    return this.database.invoice
      .findFirst({
        where: {
          ...OWN_ROWS,
          status: "ISSUED",
          invoiceNumber: { not: null },
        },
        orderBy: [{ issueDate: "desc" }, { id: "desc" }],
        select: { id: true, invoiceNumber: true },
      })
      .then((row) =>
        row && row.invoiceNumber
          ? { id: row.id, invoiceNumber: row.invoiceNumber }
          : null,
      );
  }

  /**
   * ISSUING -> ISSUED a Számlázz.hu által igazolt számmal. A mezők ugyanazok,
   * mint a normál kiállításnál (`markIssued`): a vevő-snapshot, a sorok
   * KIKÜLDÖTT összegei, a végösszeg. `false`, ha a sor közben megváltozott.
   */
  async recordIssued(input: {
    id: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    invoiceNumber: string;
    issueDate: Date;
    buyer: BuyerSnapshot;
    lines: readonly SentLineAmounts[];
    totals: { netAmount: string; vatAmount: string; grossAmount: string };
    emailStatus: "PENDING" | "NOT_REQUIRED";
    auditMetadata: Prisma.InputJsonObject;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.invoice.updateMany({
        where: {
          id: input.id,
          ...OWN_ROWS,
          status: "ISSUING",
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          status: "ISSUED",
          invoiceNumber: input.invoiceNumber,
          issueDate: input.issueDate,
          partnerName: input.buyer.name,
          partnerTaxNumber: input.buyer.taxNumber,
          buyerSnapshot: input.buyer as unknown as Prisma.InputJsonValue,
          netAmount: input.totals.netAmount,
          vatAmount: input.totals.vatAmount,
          grossAmount: input.totals.grossAmount,
          emailStatus: input.emailStatus,
          syncStatus: "RECEIVED",
          syncError: null,
        },
      });
      if (updated.count !== 1) return false;
      for (const line of input.lines)
        await transaction.invoiceLine.update({
          where: { id: line.lineId },
          data: {
            netAmount: line.netAmount,
            vatAmount: line.vatAmount,
            grossAmount: line.grossAmount,
          },
        });
      await transaction.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: ISSUING_AUDIT.recorded,
          entityType: "Invoice",
          entityId: input.id,
          metadata: input.auditMetadata,
        },
      });
      return true;
    });
  }

  /**
   * ISSUING -> DRAFT. A próbálkozások száma marad (történet), a hibaszöveg
   * törlődik (a régi szöveg az AuditLog metaadatában él tovább). `false`, ha a
   * sor közben megváltozott.
   */
  async backToDraft(input: {
    id: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
    auditMetadata: Prisma.InputJsonObject;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.invoice.updateMany({
        where: {
          id: input.id,
          ...OWN_ROWS,
          status: "ISSUING",
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          status: "DRAFT",
          syncStatus: "PENDING",
          syncError: null,
          issuedByUserId: null,
        },
      });
      if (updated.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: ISSUING_AUDIT.backToDraft,
          entityType: "Invoice",
          entityId: input.id,
          metadata: input.auditMetadata,
        },
      });
      return true;
    });
  }
}
