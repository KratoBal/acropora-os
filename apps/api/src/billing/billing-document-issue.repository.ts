import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import type {
  BuyerSnapshot,
  SentLineAmounts,
} from "./billing-document-issue.js";

/** A Számlázás modul saját sorai; ugyanaz a hatókör, mint a vázlat repository-jában. */
const OWN_ROWS = {
  direction: "OUTBOUND",
  source: "SZAMLAZZ",
  sourceType: { not: null },
  completionCertificateId: null,
} satisfies Prisma.InvoiceWhereInput;

/**
 * A KIÁLLÍTÁS ÁLLAPOTÁTMENETEI (#1267 állapotgépe), a karbantartási számla
 * mintájára (maintenance-invoice.repository.ts):
 *
 *   DRAFT -> ISSUING           feltételes: két kattintásból egy hívás lesz
 *   ISSUING -> ISSUED          szám, dátum, vevő-snapshot, a KIKÜLDÖTT összegek
 *   ISSUING -> ISSUE_FAILED    a Számlázz.hu hibakóddal elutasította
 *   ISSUING marad              ismeretlen kimenet: kézi ellenőrzés, nincs újrapróbálás
 */
@Injectable()
export class BillingDocumentIssueRepository {
  private readonly database = prisma;

  /** Csak a legutóbb betöltött vázlatot foglalja: ha azóta mentették, nem. */
  async claim(input: {
    id: string;
    expectedUpdatedAt: Date;
    actorUserId: string;
  }): Promise<boolean> {
    const claimed = await this.database.invoice.updateMany({
      where: {
        id: input.id,
        ...OWN_ROWS,
        status: "DRAFT",
        updatedAt: input.expectedUpdatedAt,
      },
      data: {
        status: "ISSUING",
        issueAttemptCount: { increment: 1 },
        issuedByUserId: input.actorUserId,
        syncStatus: "PENDING",
        syncError: null,
      },
    });
    return claimed.count === 1;
  }

  /**
   * A kiállított bizonylat: a szám, a vevő-snapshot, és a sorokon PONTOSAN azok
   * az összegek, amik a Számlázz.hu-ra mentek (a vázlat 4 tizedese helyett).
   * Egy tranzakcióban, hogy a fejléc és a sorok ne válhassanak el.
   */
  async markIssued(input: {
    id: string;
    invoiceNumber: string;
    issueDate: Date;
    buyer: BuyerSnapshot;
    lines: readonly SentLineAmounts[];
    totals: { netAmount: string; vatAmount: string; grossAmount: string };
    emailStatus: "PENDING" | "NOT_REQUIRED";
    /** A Számlázz.hu `vevoifiokurl`-je: a bizonylat online, a vevő fiókjában. */
    externalUrl: string | null;
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.invoice.update({
        where: { id: input.id },
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
          externalUrl: input.externalUrl,
          syncStatus: "RECEIVED",
          syncError: null,
        },
      });
      for (const line of input.lines)
        await transaction.invoiceLine.update({
          where: { id: line.lineId },
          data: {
            netAmount: line.netAmount,
            vatAmount: line.vatAmount,
            grossAmount: line.grossAmount,
          },
        });
    });
  }

  setPdf(id: string, pdfStorageKey: string) {
    return this.database.invoice.update({
      where: { id },
      data: { pdfStorageKey },
    });
  }

  /** Hibakóddal elutasítva: a bizonylat nem jött létre, mentés után újra kiállítható. */
  markFailed(id: string, reason: string) {
    return this.database.invoice.updateMany({
      where: { id, status: "ISSUING" },
      data: {
        status: "ISSUE_FAILED",
        syncStatus: "ERROR",
        syncError: reason.slice(0, 500),
      },
    });
  }

  /** Ismeretlen kimenet: a sor ISSUING-ben marad, az ok a syncError-ban. */
  markOutcomeUnknown(id: string, note: string) {
    return this.database.invoice.updateMany({
      where: { id, status: "ISSUING" },
      data: { syncStatus: "ERROR", syncError: note.slice(0, 500) },
    });
  }
}
