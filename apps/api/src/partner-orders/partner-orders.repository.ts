import { Injectable } from "@nestjs/common";
import {
  Prisma,
  prisma,
  type PartnerOrderDocumentStep,
  type PartnerOrderStatus,
} from "@acropora/database";
import type { SystemDocumentSource } from "./partner-order-system-documents.js";

/** What an order's lines and totals are computed from: the accepted version and the customer's optional choices. */
const ACCEPTED_VERSION_SELECT = {
  id: true,
  versionNumber: true,
  currency: true,
  priceDisplay: true,
  customerSnapshot: true,
  blocks: {
    orderBy: { position: "asc" },
    select: {
      position: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          name: true,
          description: true,
          quantity: true,
          unit: true,
          unitNetPrice: true,
          vatRatePercent: true,
          isOptional: true,
        },
      },
    },
  },
} satisfies Prisma.QuoteVersionSelect;

/**
 * What an order's lines and totals are computed from: the version and the acceptance PINNED on the order
 * (the ones that were signed), plus the quote's current state, which only decides the "acceptance revoked"
 * flag. The quote's own `acceptedVersionId` is never the source of the lines.
 */
const ORDER_CONTENT_SELECT = {
  quoteVersion: { select: ACCEPTED_VERSION_SELECT },
  acceptance: {
    select: { id: true, selectedOptionalItemIds: true, revokedAt: true },
  },
  quote: {
    select: {
      id: true,
      quoteNumber: true,
      title: true,
      status: true,
      acceptedVersionId: true,
    },
  },
} satisfies Prisma.PartnerOrderSelect;

const DOCUMENT_LIST_SELECT = {
  id: true,
  step: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { displayName: true } },
} satisfies Prisma.PartnerOrderDocumentSelect;

export type OrderContentRow = Prisma.PartnerOrderGetPayload<{
  select: typeof ORDER_CONTENT_SELECT;
}>;
export type OrderDocumentRow = Prisma.PartnerOrderDocumentGetPayload<{
  select: typeof DOCUMENT_LIST_SELECT;
}>;

export interface OrderListFilter {
  q?: string;
  status?: PartnerOrderStatus;
}

/**
 * Cap on documents per order, so a runaway client cannot fill the shared volume through one order. It is a SOFT cap
 * on purpose: the count and the insert are not one transaction, so two parallel uploads at the edge can pass it by
 * a few files. The surface is internal (quotes.manage only) and the shared storage quota is checked on every upload.
 */
export const MAX_DOCUMENTS_PER_ORDER = 60;

/**
 * The certificates' part of the chain's system documents: their documents, their issued invoices and an issued
 * storno of each (acrobot 42859). A constant, so a real-Postgres test runs THIS select: a Prisma select with a
 * made-up field compiles (measured), and only the database says no.
 */
export const CERTIFICATE_SYSTEM_DOCUMENTS = {
  orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
  select: {
    id: true,
    number: true,
    documents: {
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, fileName: true, createdAt: true },
    },
    invoices: {
      select: {
        id: true,
        status: true,
        invoiceNumber: true,
        issueDate: true,
        // an issued storno of it (acrobot 42859): shown beside it, not counted
        correctionInvoices: {
          where: { documentType: "STORNO", status: "ISSUED" },
          orderBy: [{ issueDate: "asc" }, { id: "asc" }],
          take: 1,
          select: { invoiceNumber: true },
        },
      },
    },
  },
} satisfies Prisma.CompletionCertificateFindManyArgs;

const LIST_ORDER = [
  { createdAt: "desc" },
  { id: "desc" },
] satisfies Prisma.PartnerOrderOrderByWithRelationInput[];

const LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  customerId: true,
  createdAt: true,
  customer: { select: { displayName: true } },
  ...ORDER_CONTENT_SELECT,
} satisfies Prisma.PartnerOrderSelect;

/** The search and the status of the list; the chain and open line filters are the service's (see `listAll`). */
function listWhere(filter: OrderListFilter): Prisma.PartnerOrderWhereInput {
  return {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.q
      ? {
          OR: [
            { orderNumber: { contains: filter.q, mode: "insensitive" } },
            {
              quote: {
                OR: [
                  { title: { contains: filter.q, mode: "insensitive" } },
                  { quoteNumber: { contains: filter.q, mode: "insensitive" } },
                ],
              },
            },
            {
              customer: {
                displayName: { contains: filter.q, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };
}

@Injectable()
export class PartnerOrdersRepository {
  async list(page: number, pageSize: number, filter: OrderListFilter) {
    const where = listWhere(filter);
    const [rows, total] = await prisma.$transaction(
      [
        prisma.partnerOrder.findMany({
          where,
          orderBy: LIST_ORDER,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: LIST_SELECT,
        }),
        prisma.partnerOrder.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { rows, total, chain: await this.chainCounts(rows) };
  }

  /**
   * EVERY ORDER THE FILTER MATCHES, not a page (S4): a filter on where the chain stands, or on open lines, is about
   * documents and certificates, so it can only be answered after they are read, and a page cut by the database
   * first would show the wrong orders on every page. The orders of one company are in the hundreds, and the
   * service reads the same chain and certificate data it reads for a page, once for all of them.
   *
   * THE BOUND: the chain counts, the system documents and the certified lines each take the matching orders' ids in
   * one `IN` list, and Postgres allows 32767 bind parameters in a statement. Today the orders are in the hundreds.
   * Before they come near thousands (many years of orders), read these in chunks of a few thousand ids instead.
   */
  async listAll(filter: OrderListFilter) {
    const rows = await prisma.partnerOrder.findMany({
      where: listWhere(filter),
      orderBy: LIST_ORDER,
      select: LIST_SELECT,
    });
    return { rows, chain: await this.chainCounts(rows) };
  }

  private chainCounts(rows: readonly { id: string }[]) {
    return rows.length
      ? prisma.partnerOrderDocument.groupBy({
          by: ["orderId", "step"],
          where: { orderId: { in: rows.map((row) => row.id) } },
          _count: { _all: true },
        })
      : Promise.resolve([]);
  }

  /** The certified lines of these orders, for the open line count (any certificate counts, as in the issue gate). */
  async certifiedLines(orderIds: readonly string[]) {
    if (!orderIds.length) return [];
    const rows = await prisma.completionCertificateLineItem.findMany({
      where: {
        certificate: { partnerOrderId: { in: [...orderIds] } },
        quoteItemId: { not: null },
      },
      select: {
        quoteItemId: true,
        quantity: true,
        certificate: { select: { partnerOrderId: true } },
      },
    });
    return rows.flatMap((row) =>
      row.quoteItemId && row.certificate.partnerOrderId
        ? [
            {
              orderId: row.certificate.partnerOrderId,
              quoteItemId: row.quoteItemId,
              quantity: row.quantity,
            },
          ]
        : [],
    );
  }

  detail(id: string) {
    return prisma.partnerOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        createdAt: true,
        customer: { select: { displayName: true, taxNumber: true } },
        createdBy: { select: { displayName: true } },
        ...ORDER_CONTENT_SELECT,
        documents: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: DOCUMENT_LIST_SELECT,
        },
      },
    });
  }

  /** The chain's system-made documents of these orders (`systemDocumentsOf`), keyed by order id. */
  async systemDocumentSources(
    orderIds: readonly string[],
  ): Promise<Map<string, SystemDocumentSource>> {
    if (orderIds.length === 0) return new Map();
    const rows = await prisma.partnerOrder.findMany({
      where: { id: { in: [...orderIds] } },
      select: {
        id: true,
        quote: { select: { id: true, quoteNumber: true } },
        quoteVersion: {
          select: {
            id: true,
            versionNumber: true,
            pdfStorageKey: true,
            publishedAt: true,
          },
        },
        completionCertificates: CERTIFICATE_SYSTEM_DOCUMENTS,
      },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          quoteId: row.quote.id,
          quoteNumber: row.quote.quoteNumber,
          version: row.quoteVersion,
          certificates: row.completionCertificates,
        },
      ]),
    );
  }

  /** Accepted quotes that have no order yet: the ones the page offers to carry on. */
  candidates() {
    return prisma.quote.findMany({
      where: {
        status: "ACCEPTED",
        acceptedVersionId: { not: null },
        partnerOrder: null,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        quoteNumber: true,
        title: true,
        updatedAt: true,
        customer: { select: { displayName: true } },
        acceptedVersion: { select: { currency: true } },
      },
    });
  }

  quoteForOrder(quoteId: string) {
    return prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        quoteNumber: true,
        status: true,
        acceptedVersionId: true,
        customerId: true,
        partnerOrder: { select: { id: true } },
        acceptances: {
          where: { revokedAt: null },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, quoteVersionId: true },
        },
      },
    });
  }

  create(input: {
    orderNumber: string;
    quoteId: string;
    quoteVersionId: string;
    acceptanceId: string;
    customerId: string | null;
    createdById: string;
  }) {
    return prisma.partnerOrder.create({
      data: input,
      select: { id: true },
    });
  }

  existingForQuote(quoteId: string) {
    return prisma.partnerOrder.findUnique({
      where: { quoteId },
      select: { id: true },
    });
  }

  orderExists(id: string) {
    return prisma.partnerOrder.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  documentCount(orderId: string) {
    return prisma.partnerOrderDocument.count({ where: { orderId } });
  }

  addDocument(input: {
    orderId: string;
    step: PartnerOrderDocumentStep;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    content: Buffer;
    uploadedById: string;
  }) {
    return prisma.partnerOrderDocument.create({
      data: { ...input, content: Uint8Array.from(input.content) },
      select: DOCUMENT_LIST_SELECT,
    });
  }

  document(orderId: string, documentId: string) {
    return prisma.partnerOrderDocument.findFirst({
      where: { id: documentId, orderId },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        content: true,
        storageKey: true,
      },
    });
  }

  async deleteDocument(orderId: string, documentId: string) {
    const result = await prisma.partnerOrderDocument.deleteMany({
      where: { id: documentId, orderId },
    });
    return result.count;
  }
}
