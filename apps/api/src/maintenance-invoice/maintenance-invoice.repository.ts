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

/**
 * The cancelled invoice was superseded by another request meanwhile (two clicks on "new invoice"): this draft is not written,
 * and the caller returns the live invoice the other request made.
 */
export class InvoiceSupersededMeanwhile extends Error {}

@Injectable()
export class MaintenanceInvoiceRepository {
  private readonly database = prisma;

  /**
   * A MÁR LÉTREHOZOTT PISZKOZAT, HA VAN.
   *
   * Az igazolás ÉLŐ számlája az idempotencia-kulcs (ADR-014; 2026-11-26 óta
   * részleges egyedi index, `supersededAt IS NULL`): ha erre a certificate-re
   * már áll élő számla, ÚJ Számlázz.hu-hívás nem indul, a meglévő sor jön
   * vissza. Kivétel a sztornózott számla: a szolgáltatás új piszkozattal váltja fel.
   */
  existingInvoice(certificateId: string) {
    // the LIVE invoice of the certificate: a cancelled one superseded by a new invoice (2026-11-26) is history, not the answer
    return this.database.invoice.findFirst({
      where: { completionCertificateId: certificateId, supersededAt: null },
      include: { lines: true },
    });
  }

  /**
   * A KIÁLLÍTOTT SZÁMLÁT SZTORNÓZTÁK-E (kártya 2cd1ed80): UGYANAZ A KÉT JEL, amit a számlázás lista a saját számlán használ (`billing-document-list`): egy kiállított
   * sztornó sor az OS-ben (`correctionInvoices`, STORNO és ISSUED), vagy a Számlázz.hu felületén sztornózott iker (`ExternalBillingDocument.cancelled`, a számlaszám
   * szerint). Csak kiállított számlára kérdezzük: piszkozat nem sztornózható.
   */
  async isCancelled(invoice: {
    id: string;
    invoiceNumber: string | null;
  }): Promise<boolean> {
    const storno = await this.database.invoice.count({
      where: {
        id: invoice.id,
        correctionInvoices: {
          some: { documentType: "STORNO", status: "ISSUED" },
        },
      },
    });
    if (storno > 0) return true;
    if (!invoice.invoiceNumber) return false;
    const twin = await this.database.externalBillingDocument.count({
      where: { documentNumber: invoice.invoiceNumber, cancelled: true },
    });
    return twin > 0;
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
    /**
     * THE CANCELLED INVOICE THIS DRAFT REPLACES on the same certificate (acrobot 62227). The caller saw the cancellation
     * (`isCancelled`); here it is marked superseded IN THE SAME TRANSACTION as the new row, and only while it is still live: a
     * second request finds it superseded and gets `InvoiceSupersededMeanwhile` (the partial unique index would refuse it too).
     */
    supersedes?: string;
  }) {
    const data = {
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
    } satisfies Prisma.InvoiceUncheckedCreateInput;
    if (!input.unsignedAudit && !input.supersedes)
      return this.database.invoice.create({ data, include: { lines: true } });
    const unsignedAudit = input.unsignedAudit;
    const supersedes = input.supersedes;
    return this.database.$transaction(async (transaction) => {
      if (supersedes) {
        const moved = await transaction.invoice.updateMany({
          where: {
            id: supersedes,
            completionCertificateId: input.completionCertificateId,
            supersededAt: null,
          },
          data: { supersededAt: new Date() },
        });
        if (moved.count !== 1) throw new InvoiceSupersededMeanwhile();
      }
      const invoice = await transaction.invoice.create({
        data,
        include: { lines: true },
      });
      if (unsignedAudit)
        await transaction.auditLog.create({
          data: {
            userId: unsignedAudit.userId,
            action: "maintenance-invoice.draft-without-signed-certificate",
            entityType: "CompletionCertificate",
            entityId: input.completionCertificateId,
            metadata: {
              certificateNumber: unsignedAudit.certificateNumber,
              invoiceId: input.id,
              acknowledged: true,
            },
          },
        });
      return invoice;
    });
  }
}
