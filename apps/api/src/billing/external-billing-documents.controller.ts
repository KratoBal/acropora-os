import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type BillingExternalDocumentDetail,
  type BillingExternalDocumentLine,
} from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  externalCustomerName,
  externalKindLabel,
  externalPaymentFields,
  simplePayOrderKey,
} from "./billing-document-list.js";
import {
  orderBuyerNamesByOrderNumber,
  ownPaymentMarksByInvoice,
  simplePayLinesByOrder,
} from "./billing-document-list.repository.js";
import { UNAS_SHOP_ORDER_PREFIX } from "../integrations/simplepay/simplepay-settlement.repository.js";
import type { ExternalInvoicePayment } from "./external-szamlazz-invoice.js";
import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";

/** A lista alakjából az adatlap vevő-blokkjának neve és jelzője. */
const customerFromOrder = (name: {
  customerName: string;
  customerNameFromOrder?: true;
}) =>
  name.customerNameFromOrder
    ? { name: name.customerName, nameFromOrder: true }
    : { name: name.customerName };

const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A KÜLSŐ KIMENŐ SZÁMLA ADATLAPJA, CSAK OLVASÁSRA (acrobot 25812): nincs
 * szerkesztés, sztornó, újraküldés. Forrás: a Számlázz.hu feedje (PDF-et nem
 * ad) vagy az OTP eBIZ szinkron (2026-10-02; a PDF-et letölti és eltárolja).
 * A jog ugyanaz, mint a listáé: `billing.view`.
 */
@Controller("billing/external-documents")
@RequirePermissions(PERMISSIONS.BILLING_VIEW)
export class ExternalBillingDocumentsController {
  private readonly database = prisma;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly documents: DocumentStore,
  ) {}

  @Get(":id")
  async detail(
    @Param("id") id: string,
  ): Promise<BillingExternalDocumentDetail> {
    const row = await this.database.externalBillingDocument.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Nincs ilyen külső bizonylat.");
    const decimals = row.currency.toUpperCase() === "HUF" ? 0 : 2;
    const marks =
      (await ownPaymentMarksByInvoice(this.database, [row.documentNumber])).get(
        row.documentNumber,
      ) ?? [];
    return {
      id: row.id,
      source: row.source === "EBIZ" ? "EBIZ" : "SZAMLAZZ",
      pdfAvailable: row.pdfStorageKey !== null,
      pdfMissingReason: row.pdfStorageKey ? null : row.pdfMissingReason,
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
        ...customerFromOrder(
          externalCustomerName(
            row,
            row.orderNumber
              ? (
                  await orderBuyerNamesByOrderNumber(this.database, [
                    row.orderNumber,
                  ])
                ).get(row.orderNumber)
              : null,
          ),
        ),
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
      ...externalPaymentFields(
        row,
        (await simplePayLinesByOrder(this.database, [row.orderNumber])).get(
          simplePayOrderKey(row.orderNumber, UNAS_SHOP_ORDER_PREFIX) ?? "",
        ) ?? [],
        marks,
      ),
      paymentsKnown: row.paymentsKnown === true,
      payments: (row.payments as unknown as ExternalInvoicePayment[]).map(
        (p) => ({
          date: p.date,
          title: p.title,
          amount: new Prisma.Decimal(p.amount).toFixed(decimals),
          note: p.note,
        }),
      ),
      ownPaymentMarks: marks.map((mark) => ({
        source: mark.source,
        date: day(mark.markDate)!,
        amount: mark.amount.toFixed(decimals),
      })),
      orderNumber: row.orderNumber,
      paymentMethodUnified: row.paymentMethodUnified,
      versionCount: row.versionCount,
      receivedAt: row.feedReceivedAt.toISOString(),
    };
  }

  /**
   * THE STORED PDF, AS IT CAME FROM THE SOURCE. Only reads what the sync
   * already stored; it never calls eBIZ, so it has no side effect (no entry
   * in `assistant-readonly.policy.ts`). No PDF: 404.
   */
  @Get(":id/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("id") id: string): Promise<StreamableFile> {
    const row = await this.database.externalBillingDocument.findUnique({
      where: { id },
      select: { id: true, documentNumber: true, pdfStorageKey: true },
    });
    if (!row?.pdfStorageKey)
      throw new NotFoundException("Ehhez a külső bizonylathoz nincs PDF.");
    const key = {
      owner: "external-invoice" as const,
      ownerId: row.id,
      documentId: row.pdfStorageKey.split("/").pop() ?? "",
    };
    assertStorageKeyMatches(row.pdfStorageKey, key);
    const bytes = await this.documents.get(key);
    if (!bytes)
      throw new NotFoundException("A PDF nem található a dokumentumtárban.");
    const fileName = `${row.documentNumber}.pdf`;
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }
}
