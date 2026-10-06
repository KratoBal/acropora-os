import { prisma, type Prisma } from "@acropora/database";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  EXPECTED_ARRIVAL_LIST_PAGE_SIZE,
  type ExpectedArrivalDetail,
  type ExpectedArrivalListItem,
  type ExpectedArrivalListQuery,
  type ExpectedArrivalListResponse,
  type SupplierInvoiceImportResult,
} from "@acropora/types";

import { supplierIdByTaxKey } from "./expected-arrival.intake.js";

type StoredSuggestion = ExpectedArrivalDetail["lineSuggestions"][number];

/** The number of lines that have a product suggestion to show. */
export function suggestedLineCount(stored: unknown): number {
  if (!Array.isArray(stored)) return 0;
  return (stored as StoredSuggestion[]).filter(
    (answer) => answer?.result?.suggestion,
  ).length;
}

/** One mail arrival as the list shows it (its documents newest first). */
export interface MailArrivalRow {
  id: string;
  status: "OPEN" | "RECEIVED" | "DISMISSED";
  supplierName: string;
  supplierId: string | null;
  orderReference: string | null;
  invoiceNumber: string | null;
  documents: Array<{
    kind: "INVOICE" | "PROFORMA" | null;
    status: string;
    receivedAt: Date | null;
    createdAt: Date;
    importResult: unknown;
    lineSuggestions: unknown;
  }>;
}

/**
 * The list row of a mail arrival. An open one shows its invoice (bookable)
 * or its proforma; a booked one is here only for a correction that arrived
 * after the booking, and shows that, without a way into the editor.
 */
export function mailListItem(arrival: MailArrivalRow): ExpectedArrivalListItem {
  const late =
    arrival.status === "RECEIVED"
      ? arrival.documents.find(
          (document) => document.status === "LATE_CORRECTION",
        )
      : undefined;
  const invoice = late
    ? undefined
    : arrival.documents.find(
        (document) => document.kind === "INVOICE" && document.status === "READ",
      );
  const shown = late ?? invoice ?? arrival.documents[0]!;
  const result =
    shown.importResult as unknown as SupplierInvoiceImportResult | null;
  return {
    source: "MAIL",
    id: arrival.id,
    supplierName: arrival.supplierName,
    supplierId: arrival.supplierId,
    orderReference: arrival.orderReference,
    invoiceNumber: arrival.invoiceNumber,
    stage: late ? "LATE_CORRECTION" : invoice ? "INVOICE" : "PROFORMA",
    arrivedAt: (shown.receivedAt ?? shown.createdAt).toISOString(),
    invoiceDate: result?.invoiceDate ?? null,
    currency: result?.currency ?? null,
    netTotal: result?.netTotal ?? null,
    lineCount: result?.lines.filter((line) => !line.isCharge).length ?? null,
    suggestedLineCount: invoice
      ? suggestedLineCount(invoice.lineSuggestions)
      : null,
    editorPath: invoice
      ? `/beszerzes/uj?beerkezes=${encodeURIComponent(arrival.id)}`
      : null,
  };
}

/** The documents a list row is built from, newest first. */
const MAIL_LIST_DOCUMENTS = {
  where: {
    status: { in: ["READ", "LATE_CORRECTION"] },
  } satisfies Prisma.IncomingSupplierDocumentWhereInput,
  orderBy: { createdAt: "desc" as const },
  select: {
    kind: true,
    status: true,
    receivedAt: true,
    createdAt: true,
    importResult: true,
    lineSuggestions: true,
  },
};

/** How many dismissed arrivals the list returns, to take back. */
const DISMISSED_SHOWN = 50;

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
 * It comes back only when a corrected version of its invoice arrives after
 * the booking (LATE_CORRECTION): shown, not bookable, for the person to
 * settle with the supplier and the accounts.
 */
@Injectable()
export class ExpectedArrivalService {
  async list(
    query: ExpectedArrivalListQuery = {},
  ): Promise<ExpectedArrivalListResponse> {
    const [arrivals, navInvoices, dismissed] = await Promise.all([
      prisma.expectedArrival.findMany({
        where: {
          OR: [
            { status: "OPEN" },
            // a corrected invoice after the booking: shown, not bookable
            {
              status: "RECEIVED",
              documents: { some: { status: "LATE_CORRECTION" } },
            },
          ],
        },
        include: { documents: MAIL_LIST_DOCUMENTS },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.navIncomingInvoice.findMany({
        where: {
          status: { in: ["NEW", "DATA_FETCHED"] },
          purchaseInvoiceId: null,
          // a módosító és a sztornó okirat nem vételezhető be
          invoiceOperation: "CREATE",
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
      prisma.expectedArrival.findMany({
        where: { status: "DISMISSED" },
        include: { documents: MAIL_LIST_DOCUMENTS },
        orderBy: { updatedAt: "desc" },
        take: DISMISSED_SHOWN,
      }),
    ]);

    const mail: ExpectedArrivalListItem[] = arrivals
      .filter((arrival) => arrival.documents.length > 0)
      .map(mailListItem);

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

    return pageArrivalList(
      {
        items: [...mail, ...nav].sort((a, b) =>
          (b.arrivedAt ?? "").localeCompare(a.arrivedAt ?? ""),
        ),
        dismissed: dismissed
          .filter((arrival) => arrival.documents.length > 0)
          .map((arrival) => ({ ...mailListItem(arrival), editorPath: null })),
      },
      query,
    );
  }

  /**
   * "NEM KELL" (acrobot 25064, 2026-09-30): a mail arrival that will not be
   * booked leaves the list. Only an OPEN one; a person's act, so it is
   * audited, and `restore` takes it back. NAV rows are not arrivals and have
   * no such button.
   */
  dismiss(id: string, actorUserId: string): Promise<void> {
    return this.move(id, "OPEN", "DISMISSED", actorUserId);
  }

  restore(id: string, actorUserId: string): Promise<void> {
    return this.move(id, "DISMISSED", "OPEN", actorUserId);
  }

  private async move(
    id: string,
    from: "OPEN" | "DISMISSED",
    to: "OPEN" | "DISMISSED",
    actorUserId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // conditional: two clicks, or a booking in between, change one row once
      const moved = await tx.expectedArrival.updateMany({
        where: { id, status: from },
        data: { status: to },
      });
      if (moved.count === 0) {
        const arrival = await tx.expectedArrival.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!arrival)
          throw new NotFoundException("A várható beérkezés nem található.");
        throw new ConflictException(
          arrival.status === "RECEIVED"
            ? "Ez a várható beérkezés már be van vételezve."
            : to === "DISMISSED"
              ? "Ez a tétel már ki van véve."
              : "Ez a tétel nincs kivéve.",
        );
      }
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action:
            to === "DISMISSED"
              ? "purchasing.expected-arrival.dismissed"
              : "purchasing.expected-arrival.restored",
          entityType: "ExpectedArrival",
          entityId: id,
          metadata: { from, to },
        },
      });
    });
  }

  /**
   * What the editor needs to open an arrival: its invoice's reading and the
   * suggestions kept from the arrival. Only an OPEN arrival whose invoice has
   * arrived can be opened: a proforma is not booked.
   */
  /**
   * THE SUPPLIER RECORDED AFTER THE ARRIVAL (Balázs ran into it, 2026-09-30):
   * the five Aquarioom arrivals came in at 07:51-07:52 UTC, the supplier was
   * recorded at 07:53:52, so the arrivals kept `supplierId = NULL`. The editor
   * selects a supplier only by the detail's id, and without one it asks for
   * no line suggestion. The detail resolves it now, by the same tax key as
   * the intake. It does not write it back: the detail is a read (a
   * PURCHASING_VIEW viewer may open it); the next document of the order
   * fills the arrival's NULL at intake.
   */
  private async supplierIdLater(
    vatId: string | null | undefined,
  ): Promise<string | null> {
    if (!vatId) return null;
    return supplierIdByTaxKey(
      vatId,
      await prisma.supplier.findMany({
        where: { deletedAt: null, taxNumber: { not: null } },
        select: { id: true, taxNumber: true },
      }),
    );
  }

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
        arrival.status === "DISMISSED"
          ? "Ez a tétel ki van véve (Nem kell); előbb vedd vissza."
          : "Ez a várható beérkezés már be van vételezve.",
      );
    const invoice = arrival.documents[0];
    if (!invoice?.importResult)
      throw new ConflictException(
        "Ehhez a rendeléshez még csak a proforma érkezett meg, a számla nem.",
      );
    const importResult =
      invoice.importResult as unknown as SupplierInvoiceImportResult;

    return {
      id: arrival.id,
      supplierId:
        arrival.supplierId ??
        (await this.supplierIdLater(importResult.supplier.vatId)),
      supplierName: arrival.supplierName,
      orderReference: arrival.orderReference,
      invoiceNumber: arrival.invoiceNumber,
      documentId: invoice.id,
      fileName: invoice.fileName,
      importResult,
      lineSuggestions: Array.isArray(invoice.lineSuggestions)
        ? (invoice.lineSuggestions as unknown as StoredSuggestion[])
        : [],
    };
  }
}

/**
 * A LISTA SZŰRÉSE ÉS LAPOZÁSA (kártya dd0aef31; barracuda 2026-10-06: a
 * Sutyerák egyetlen valódi csonkulása, a válasz mindig a teljes, 59 536 bájtos
 * lista volt, a `limit` hatástalan).
 *
 * A két forrás (levél és NAV) a memóriában egyesül és rendeződik, ezért a
 * lapozás is itt történik, az egyesítés UTÁN: egy adatbázis-oldali lapozás
 * forrásonként vágna, és a lapok sorrendje összekeveredne.
 *
 * Lapozó mező (`page`, `pageSize`, `limit`) nélkül a lista teljes, és a válasz
 * `pagination` nélküli: a webes oldal ezt kéri, és így nem változik. A szűrő
 * (`source`, `q`) lapozás nélkül is szűr. A „Nem kell”-lel kivett tételek
 * (`dismissed`) rövid listája változatlanul jön.
 */
export function pageArrivalList(
  full: ExpectedArrivalListResponse,
  query: ExpectedArrivalListQuery,
): ExpectedArrivalListResponse {
  const needle = query.q?.trim().toLowerCase() ?? "";
  const items = full.items.filter(
    (item) =>
      (!query.source || item.source === query.source) &&
      (!needle ||
        [item.supplierName, item.invoiceNumber, item.orderReference].some((v) =>
          (v ?? "").toLowerCase().includes(needle),
        )),
  );
  const size = query.pageSize ?? query.limit;
  if (query.page === undefined && size === undefined) return { ...full, items };
  const pageSize = size ?? EXPECTED_ARRIVAL_LIST_PAGE_SIZE.default;
  const page = query.page ?? 1;
  return {
    ...full,
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      totalItems: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
    },
  };
}
