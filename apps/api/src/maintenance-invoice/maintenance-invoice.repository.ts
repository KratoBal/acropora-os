import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import type { CertificateAmounts } from "../completion-certificates/completion-certificate-amounts.js";

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

  /** A PDF letöltéséhez elég adat: az azonosító és a tárolt kulcs. */
  invoicePdfLookup(invoiceId: string) {
    return this.database.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, pdfStorageKey: true },
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
  createDraft(input: {
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
      unitNet: Prisma.Decimal;
      vatRatePercent: Prisma.Decimal;
      netAmount: Prisma.Decimal;
      vatAmount: Prisma.Decimal;
      grossAmount: Prisma.Decimal;
    }[];
  }) {
    return this.database.invoice.create({
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
            unit: "db",
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
  }
}
