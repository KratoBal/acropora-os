import { prisma } from "@acropora/database";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ExpectedArrivalDetail,
  ExpectedArrivalListItem,
  ExpectedArrivalListResponse,
  SupplierInvoiceImportResult,
} from "@acropora/types";

type StoredSuggestion = ExpectedArrivalDetail["lineSuggestions"][number];

/** The number of lines that have a product suggestion to show. */
export function suggestedLineCount(stored: unknown): number {
  if (!Array.isArray(stored)) return 0;
  return (stored as StoredSuggestion[]).filter(
    (answer) => answer?.result?.suggestion,
  ).length;
}

/**
 * VÁRHATÓ BEÉRKEZÉSEK, THE LIST AND THE EDITOR'S PREFILL (Balázs, 2026-09-30:
 * "a Várható beérkezések menüpontban ott van a lista, miből kiválasztja,
 * melyik számlát akarja bevételezni").
 *
 * One list, by source (acrobot, 2026-09-30):
 * - MAIL: the open expected arrivals from the info@ mailbox; an order with only
 *   its proforma is shown, but it cannot be booked until the invoice arrives;
 * - NAV: the NAV incoming invoices not yet booked (NEW, DATA_FETCHED), which
 *   the editor already prefills (`?navInvoiceId=`).
 * A booked item leaves the list: the save marks it RECEIVED
 * (purchase-invoice.repository.ts), in the same transaction as the invoice.
 */
@Injectable()
export class ExpectedArrivalService {
  async list(): Promise<ExpectedArrivalListResponse> {
    const [arrivals, navInvoices] = await Promise.all([
      prisma.expectedArrival.findMany({
        where: { status: "OPEN" },
        include: {
          documents: {
            where: { status: "READ" },
            orderBy: { createdAt: "desc" },
            select: {
              kind: true,
              receivedAt: true,
              createdAt: true,
              importResult: true,
              lineSuggestions: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.navIncomingInvoice.findMany({
        where: {
          status: { in: ["NEW", "DATA_FETCHED"] },
          purchaseInvoiceId: null,
        },
        orderBy: { invoiceIssueDate: "desc" },
        select: {
          id: true,
          navInvoiceNumber: true,
          supplierName: true,
          invoiceIssueDate: true,
          currency: true,
          invoiceNetAmount: true,
        },
      }),
    ]);

    const mail: ExpectedArrivalListItem[] = arrivals
      .filter((arrival) => arrival.documents.length > 0)
      .map((arrival) => {
        const invoice = arrival.documents.find(
          (document) => document.kind === "INVOICE",
        );
        const shown = invoice ?? arrival.documents[0]!;
        const result =
          shown.importResult as unknown as SupplierInvoiceImportResult | null;
        return {
          source: "MAIL",
          id: arrival.id,
          supplierName: arrival.supplierName,
          supplierId: arrival.supplierId,
          orderReference: arrival.orderReference,
          invoiceNumber: arrival.invoiceNumber,
          stage: invoice ? "INVOICE" : "PROFORMA",
          arrivedAt: (shown.receivedAt ?? shown.createdAt).toISOString(),
          invoiceDate: result?.invoiceDate ?? null,
          currency: result?.currency ?? null,
          netTotal: result?.netTotal ?? null,
          lineCount:
            result?.lines.filter((line) => !line.isCharge).length ?? null,
          suggestedLineCount: invoice
            ? suggestedLineCount(invoice.lineSuggestions)
            : null,
          editorPath: invoice
            ? `/beszerzes/uj?beerkezes=${encodeURIComponent(arrival.id)}`
            : null,
        };
      });

    const nav: ExpectedArrivalListItem[] = navInvoices.map((invoice) => ({
      source: "NAV",
      id: invoice.id,
      supplierName: invoice.supplierName,
      supplierId: null,
      orderReference: null,
      invoiceNumber: invoice.navInvoiceNumber,
      stage: "INVOICE",
      arrivedAt: invoice.invoiceIssueDate.toISOString(),
      invoiceDate: invoice.invoiceIssueDate.toISOString().slice(0, 10),
      currency: invoice.currency,
      netTotal:
        invoice.invoiceNetAmount === null
          ? null
          : Number(invoice.invoiceNetAmount),
      lineCount: null,
      suggestedLineCount: null,
      editorPath: `/beszerzes/uj?navInvoiceId=${encodeURIComponent(invoice.id)}`,
    }));

    return {
      items: [...mail, ...nav].sort((a, b) =>
        (b.arrivedAt ?? "").localeCompare(a.arrivedAt ?? ""),
      ),
    };
  }

  /**
   * What the editor needs to open an arrival: its invoice's reading and the
   * suggestions kept from the arrival. Only an OPEN arrival whose invoice has
   * arrived can be opened: a proforma is not booked.
   */
  async detail(id: string): Promise<ExpectedArrivalDetail> {
    const arrival = await prisma.expectedArrival.findUnique({
      where: { id },
      include: {
        documents: {
          where: { status: "READ", kind: "INVOICE" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!arrival)
      throw new NotFoundException("A várható beérkezés nem található.");
    if (arrival.status !== "OPEN")
      throw new ConflictException(
        "Ez a várható beérkezés már be van vételezve.",
      );
    const invoice = arrival.documents[0];
    if (!invoice?.importResult)
      throw new ConflictException(
        "Ehhez a rendeléshez még csak a proforma érkezett meg, a számla nem.",
      );

    return {
      id: arrival.id,
      supplierId: arrival.supplierId,
      supplierName: arrival.supplierName,
      orderReference: arrival.orderReference,
      invoiceNumber: arrival.invoiceNumber,
      documentId: invoice.id,
      fileName: invoice.fileName,
      importResult:
        invoice.importResult as unknown as SupplierInvoiceImportResult,
      lineSuggestions: Array.isArray(invoice.lineSuggestions)
        ? (invoice.lineSuggestions as unknown as StoredSuggestion[])
        : [],
    };
  }
}
