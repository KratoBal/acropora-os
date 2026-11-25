import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import type { BuyerSnapshot } from "../billing/billing-document-issue.js";
import {
  draftDeleteRefusal,
  type DraftDeleteRefusal,
} from "../billing/billing-draft-delete.js";
import type { CertificateAmounts } from "../completion-certificates/completion-certificate-amounts.js";

/** The draft changed between the read and the conditional delete (an issue started): the transaction rolls back. */
class DraftChangedDuringDelete extends Error {}

@Injectable()
export class MaintenanceInvoiceRepository {
  private readonly database = prisma;

  /**
   * A MÁR LÉTREHOZOTT PISZKOZAT, HA VAN.
   *
   * Az `Invoice.completionCertificateId @unique` az idempotencia-kulcs
   * (ADR-014): ha erre a certificate-re már áll piszkozat, ÚJ Számlázz.hu-
   * hívás nem indul, a meglévő sor jön vissza.
   */
  existingInvoice(certificateId: string) {
    return this.database.invoice.findUnique({
      where: { completionCertificateId: certificateId },
      include: { lines: true },
    });
  }

  /**
   * A PARTNEREK OLDALON BEÁLLÍTOTT FIZETÉSI NAPOK (nem törölt partnerek): a TIG vevő-sora üres napjainál erre esik vissza a
   * határidő, mint a számla-szerkesztő (`BillingDocumentsRepository.customerPaymentDueDays`).
   */
  async partnerPaymentTerms() {
    const partners = await this.database.supplier.findMany({
      where: { paymentDueDays: { not: null }, deletedAt: null },
      select: { name: true, taxNumber: true, paymentDueDays: true },
    });
    return partners.map((partner) => ({
      name: partner.name,
      taxNumber: partner.taxNumber,
      paymentDueDays: partner.paymentDueDays!,
    }));
  }

  /** A PDF letöltéséhez elég adat: az azonosító és a tárolt kulcs. */
  invoicePdfLookup(invoiceId: string) {
    return this.database.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        status: true,
        invoiceNumber: true,
        pdfStorageKey: true,
      },
    });
  }

  invoiceById(invoiceId: string) {
    return this.database.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true },
    });
  }

  /**
   * A TIG PISZKOZAT TÖRLÉSE (Luca kérése, acrobot 61225; KT-2026-009): a szabály a számlázás vázlat-törlésének
   * `draftDeleteRefusal`-ja (csak sorszám nélküli DRAFT, amire nem hivatkozik másik bizonylat), az írás itt, egy tranzakcióban.
   * A TIG piszkozat forrás nélküli sor (`sourceType` null), ezért a számlázás saját törlése (`OWN_ROWS`) nem éri el: ez a
   * karbantartási modul saját útja, és CSAK a teljesítési igazoláshoz kötött sort találja meg (`completionCertificateId` nem null).
   *
   * A kiállítás kezdete (`claimForIssue`: DRAFT -> ISSUING) és ez a törlés ugyanarra a sorra FELTÉTELES írás: a törlés a
   * `status = DRAFT` és az olvasáskori `updatedAt` mellett fut, tehát a kettő közül pontosan egy nyer. A tétel-sorok és a
   * levelezési rekordok nem maradnak lógva; levelezési rekord egy piszkozaton nem létezhet, ezért ha mégis van, a törlés megáll.
   * Az eredmény a törölt sor tárolt PDF-kulcsa (a hívó a tárolóból törli), vagy az elutasítás.
   */
  async deleteDraft(input: {
    invoiceId: string;
    actorUserId: string | null;
  }): Promise<
    | { refusal: DraftDeleteRefusal }
    | { removed: { pdfStorageKey: string | null } }
  > {
    try {
      return await this.database.$transaction(async (transaction) => {
        const row = await transaction.invoice.findFirst({
          where: {
            id: input.invoiceId,
            completionCertificateId: { not: null },
          },
          select: {
            id: true,
            status: true,
            invoiceNumber: true,
            updatedAt: true,
            partnerName: true,
            grossAmount: true,
            currency: true,
            pdfStorageKey: true,
            completionCertificateId: true,
          },
        });
        if (!row)
          return {
            refusal: {
              code: "NOT_FOUND" as const,
              message: "A piszkozat-számla nem található.",
            },
          };
        const referencedBy = await transaction.invoice.count({
          where: {
            OR: [
              { referencedInvoiceId: row.id },
              { proformaInvoiceId: row.id },
            ],
          },
        });
        const mailRecords = await transaction.billingDocumentMailDelivery.count(
          { where: { invoiceId: row.id } },
        );
        const refusal =
          draftDeleteRefusal(row, referencedBy, row.updatedAt) ??
          (mailRecords > 0
            ? {
                code: "REFERENCED" as const,
                message:
                  "Ehhez a piszkozathoz levelezési rekord tartozik, ezért nem törölhető.",
              }
            : null);
        if (refusal) return { refusal };
        await transaction.invoiceLine.deleteMany({
          where: { invoiceId: row.id },
        });
        const removed = await transaction.invoice.deleteMany({
          where: {
            id: row.id,
            completionCertificateId: { not: null },
            status: "DRAFT",
            invoiceNumber: null,
            updatedAt: row.updatedAt,
          },
        });
        if (removed.count !== 1) throw new DraftChangedDuringDelete();
        await transaction.auditLog.create({
          data: {
            userId: input.actorUserId,
            action: "maintenance-invoice.draft-deleted",
            entityType: "Invoice",
            entityId: row.id,
            metadata: {
              completionCertificateId: row.completionCertificateId,
              partnerName: row.partnerName,
              grossAmount: row.grossAmount?.toString() ?? null,
              currency: row.currency,
            },
          },
        });
        return { removed: { pdfStorageKey: row.pdfStorageKey } };
      });
    } catch (error) {
      if (error instanceof DraftChangedDuringDelete)
        return {
          refusal: {
            code: "STALE" as const,
            message:
              "A piszkozat közben megváltozott (például elindult a kiállítása), ezért nem törölhető. Töltsd újra az oldalt.",
          },
        };
      throw error;
    }
  }

  /**
   * DRAFT -> ISSUING IN ONE CONDITIONAL UPDATE. Of two requests at the same
   * moment (a double click, two people) exactly one gets `true`: the real
   * Számlázz.hu call runs at most once per invoice.
   */
  async claimForIssue(invoiceId: string): Promise<boolean> {
    const claimed = await this.database.invoice.updateMany({
      where: { id: invoiceId, status: "DRAFT" },
      data: { status: "ISSUING", syncError: null },
    });
    return claimed.count === 1;
  }

  /** Számlázz.hu said no, and nothing was issued: back to the draft. */
  releaseClaim(invoiceId: string) {
    return this.database.invoice.updateMany({
      where: { id: invoiceId, status: "ISSUING" },
      data: { status: "DRAFT" },
    });
  }

  /** The outcome is not known: the row stays ISSUING, with the reason. */
  markOutcomeUnknown(invoiceId: string, note: string) {
    return this.database.invoice.updateMany({
      where: { id: invoiceId, status: "ISSUING" },
      data: { syncStatus: "ERROR", syncError: note.slice(0, 500) },
    });
  }

  markIssued(
    invoiceId: string,
    issued: {
      invoiceNumber: string;
      issueDate: Date;
      pdfStorageKey: string | null;
      /** The invoice's own certificate: the issued row's source (`sourceId`). */
      completionCertificateId: string;
      /** The dates the invoice carries (the confirmed ones, card 7ba97e0d S3): the details page shows them. */
      fulfillmentDate?: Date;
      dueDate?: Date;
      /** What the request carried (`fizmod`), and the buyer as sent: the billing page reads them (card 7ba97e0d follow-up). */
      paymentMethod?: string;
      buyerSnapshot?: BuyerSnapshot;
    },
  ) {
    return this.database.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "ISSUED",
        invoiceNumber: issued.invoiceNumber,
        issueDate: issued.issueDate,
        pdfStorageKey: issued.pdfStorageKey,
        // AZ ISSUED TIG-SZÁMLA SAJÁT SOR (Balázs 2026-11-11 13:22 UTC): a forrás a teljesítési igazolás, és e-számla
        // (a kérés `eszamla` nélkül megy, az alapérték e-számla); a sztornó ebből tudja, mit kérjen
        sourceType: "COMPLETION_CERTIFICATE",
        sourceId: issued.completionCertificateId,
        invoiceFormat: "ELECTRONIC",
        fulfillmentDate: issued.fulfillmentDate,
        dueDate: issued.dueDate,
        paymentMethod: issued.paymentMethod,
        buyerSnapshot: issued.buyerSnapshot as
          Prisma.InputJsonValue | undefined,
        syncStatus: "RECEIVED",
        syncError: null,
      },
      include: { lines: true },
    });
  }

  /**
   * A PISZKOZAT LÉTREHOZÁSA -- MINDIG `status: DRAFT`, `invoiceNumber: null`,
   * `salesOrderId: null`.
   *
   * A `salesOrderId: null` NEM mellékes: ez zárja ki szerkezetileg, hogy ez a
   * sor valaha megjelenjen egy webshop-rendelés `invoices` relációjában
   * (lásd a git grep felmérést, nautilus 2026-09-24) -- egy karbantartási
   * piszkozat sosem webshop-rendeléshez tartozik.
   *
   * Az `id`-t A HÍVÓ ADJA (nem a séma alapértelmezése): a PDF-et a
   * dokumentum-tárolóba ELŐBB kell írni, mint ahogy ez a sor létrejön (lásd
   * `document-intake.ts` doc-commentjét ugyanerről a sorrendről), és a
   * tároló kulcsa ehhez az azonosítóhoz kötődik -- tehát az azonosítónak
   * MÁR MEG KELL LENNIE az írás előtt.
   */
  /**
   * The draft row. With `unsignedAudit`, the confirmation of invoicing without a signed certificate is logged IN THE
   * SAME TRANSACTION (barracuda, #2172 and #2176 review): who, which certificate, which draft. A failed audit write
   * leaves no draft behind, so a retry cannot return an existing draft that was never logged.
   */
  async createDraft(input: {
    id: string;
    completionCertificateId: string;
    customerId: string;
    partnerName: string;
    partnerTaxNumber: string | null;
    currency: string;
    totals: CertificateAmounts;
    pdfStorageKey: string;
    lines: readonly {
      description: string;
      quantity: Prisma.Decimal;
      /** The unit as sent to Számlázz.hu (the certificate's, or "alkalom" for an old line without one). */
      unit: string;
      unitNet: Prisma.Decimal;
      vatRatePercent: Prisma.Decimal;
      netAmount: Prisma.Decimal;
      vatAmount: Prisma.Decimal;
      grossAmount: Prisma.Decimal;
    }[];
    /** only the order's certificate can get here (`prepare` refuses a worksheet one without a signature) */
    unsignedAudit?: { userId: string | null; certificateNumber: string };
  }) {
    const create = this.database.invoice.create({
      data: {
        id: input.id,
        direction: "OUTBOUND",
        documentType: "INVOICE",
        source: "SZAMLAZZ",
        status: "DRAFT",
        invoiceNumber: null,
        completionCertificateId: input.completionCertificateId,
        customerId: input.customerId,
        salesOrderId: null,
        partnerName: input.partnerName,
        partnerTaxNumber: input.partnerTaxNumber,
        currency: input.currency,
        netAmount: input.totals.netAmount,
        vatAmount: input.totals.vatAmount,
        grossAmount: input.totals.grossAmount,
        pdfStorageKey: input.pdfStorageKey,
        lines: {
          create: input.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitNet: line.unitNet,
            vatRatePercent: line.vatRatePercent,
            netAmount: line.netAmount,
            vatAmount: line.vatAmount,
            grossAmount: line.grossAmount,
          })),
        },
      },
      include: { lines: true },
    });
    if (!input.unsignedAudit) return create;
    const [invoice] = await this.database.$transaction([
      create,
      this.database.auditLog.create({
        data: {
          userId: input.unsignedAudit.userId,
          action: "maintenance-invoice.draft-without-signed-certificate",
          entityType: "CompletionCertificate",
          entityId: input.completionCertificateId,
          metadata: {
            certificateNumber: input.unsignedAudit.certificateNumber,
            invoiceId: input.id,
            acknowledged: true,
          },
        },
      }),
    ]);
    return invoice;
  }
}
