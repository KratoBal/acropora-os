import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type BillingExternalDocumentDetail,
  type BillingExternalDocumentLine,
} from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  externalKindLabel,
  externalPaymentFields,
} from "./billing-document-list.js";
import type { ExternalInvoicePayment } from "./external-szamlazz-invoice.js";

const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A SZÁMLÁZZ.HU-BÓL KAPOTT KIMENŐ SZÁMLA ADATLAPJA, CSAK OLVASÁSRA (acrobot
 * 25812): nincs szerkesztés, sztornó, újraküldés, és PDF sincs (a Számlázz.hu
 * nem adja). A jog ugyanaz, mint a listáé: `billing.view`.
 */
@Controller("billing/external-documents")
@RequirePermissions(PERMISSIONS.BILLING_VIEW)
export class ExternalBillingDocumentsController {
  private readonly database = prisma;

  @Get(":id")
  async detail(
    @Param("id") id: string,
  ): Promise<BillingExternalDocumentDetail> {
    const row = await this.database.externalBillingDocument.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Nincs ilyen külső bizonylat.");
    const decimals = row.currency.toUpperCase() === "HUF" ? 0 : 2;
    return {
      id: row.id,
      source: "SZAMLAZZ",
      kindCode: row.kindCode,
      kindLabel: externalKindLabel(row.kindCode),
      documentNumber: row.documentNumber,
      invoiceFormat: row.electronic ? "ELECTRONIC" : "PAPER",
      issueDate: day(row.issueDate)!,
      fulfillmentDate: day(row.fulfillmentDate),
      dueDate: day(row.dueDate),
      paymentMethod: row.paymentMethod,
      currency: row.currency,
      customer: {
        name: row.customerName,
        taxNumber: row.customerTaxNumber,
        address: row.customerAddress,
      },
      lines: row.lines as unknown as BillingExternalDocumentLine[],
      totals: {
        netAmount: row.netAmount.toFixed(decimals),
        vatAmount: row.vatAmount.toFixed(decimals),
        grossAmount: row.grossAmount.toFixed(decimals),
      },
      cancelled: row.cancelled,
      ...externalPaymentFields(row),
      paymentsKnown: row.paymentsKnown === true,
      payments: (row.payments as unknown as ExternalInvoicePayment[]).map(
        (p) => ({
          date: p.date,
          title: p.title,
          amount: new Prisma.Decimal(p.amount).toFixed(decimals),
          note: p.note,
        }),
      ),
      versionCount: row.versionCount,
      receivedAt: row.feedReceivedAt.toISOString(),
    };
  }
}
