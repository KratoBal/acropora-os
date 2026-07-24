import type { Prisma } from "@acropora/database";
import type {
  NavIncomingInvoiceDetail,
  NavIncomingInvoiceStatus,
  NavIncomingInvoiceSummary,
} from "@acropora/types";

import type { ParsedNavInvoiceData } from "../../integrations/nav/nav-invoice-data.parser.js";

/// A NavIncomingInvoice.parsedData JSON mezőben tárolt pillanatkép alakja -
/// a queryInvoiceData válaszból parszolt üzleti adat (lásd
/// nav-invoice-data.parser.ts) plusz az akkor kiszámolt javasolt ÁFA-kulcs,
/// hogy ne kelljen minden lekérdezéskor újraszámolni.
export interface StoredNavInvoiceParsedData extends ParsedNavInvoiceData {
  suggestedVatRatePercent?: string;
}

export interface NavIncomingInvoiceRow {
  id: string;
  navInvoiceNumber: string;
  supplierTaxNumber: string;
  supplierName: string;
  invoiceIssueDate: Date;
  invoiceDeliveryDate: Date | null;
  paymentDate: Date | null;
  currency: string;
  invoiceNetAmount: Prisma.Decimal | null;
  invoiceVatAmount: Prisma.Decimal | null;
  insDate: Date;
  status: NavIncomingInvoiceStatus;
  parsedData: Prisma.JsonValue | null;
  errorCode: string | null;
  purchaseInvoiceId: string | null;
}

function parsedDataOf(
  row: NavIncomingInvoiceRow,
): StoredNavInvoiceParsedData | null {
  return row.parsedData as StoredNavInvoiceParsedData | null;
}

export function toNavIncomingInvoiceSummary(
  row: NavIncomingInvoiceRow,
): NavIncomingInvoiceSummary {
  return {
    id: row.id,
    navInvoiceNumber: row.navInvoiceNumber,
    supplierTaxNumber: row.supplierTaxNumber,
    supplierName: row.supplierName,
    invoiceIssueDate: row.invoiceIssueDate.toISOString(),
    invoiceDeliveryDate: row.invoiceDeliveryDate?.toISOString(),
    paymentDate: row.paymentDate?.toISOString(),
    currency: row.currency,
    invoiceNetAmount: row.invoiceNetAmount?.toString(),
    invoiceVatAmount: row.invoiceVatAmount?.toString(),
    insDate: row.insDate.toISOString(),
    status: row.status,
    purchaseInvoiceId: row.purchaseInvoiceId ?? undefined,
    errorCode: row.errorCode ?? undefined,
  };
}

export function toNavIncomingInvoiceDetail(
  row: NavIncomingInvoiceRow,
): NavIncomingInvoiceDetail {
  const parsed = parsedDataOf(row);
  return {
    ...toNavIncomingInvoiceSummary(row),
    supplierAddress: parsed?.supplierAddress,
    supplierBankAccountNumber: parsed?.supplierBankAccountNumber,
    suggestedVatRatePercent: parsed?.suggestedVatRatePercent,
    lines: (parsed?.lines ?? []).map((line) => ({
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      lineNetAmount: line.lineNetAmount,
      vatRatePercent: line.vatRatePercent,
    })),
  };
}
