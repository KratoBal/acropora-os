import { Injectable } from "@nestjs/common";
import {
  Prisma,
  prisma,
  type PartnerOrderDocumentStep,
  type PartnerOrderStatus,
} from "@acropora/database";

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

@Injectable()
export class PartnerOrdersRepository {
  async list(page: number, pageSize: number, filter: OrderListFilter) {
    const where: Prisma.PartnerOrderWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { orderNumber: { contains: filter.q, mode: "insensitive" } },
              {
                quote: {
                  OR: [
                    { title: { contains: filter.q, mode: "insensitive" } },
                    {
                      quoteNumber: { contains: filter.q, mode: "insensitive" },
                    },
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
    const [rows, total] = await prisma.$transaction(
      [
        prisma.partnerOrder.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            customerId: true,
            createdAt: true,
            customer: { select: { displayName: true } },
            ...ORDER_CONTENT_SELECT,
          },
        }),
        prisma.partnerOrder.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const chain = rows.length
      ? await prisma.partnerOrderDocument.groupBy({
          by: ["orderId", "step"],
          where: { orderId: { in: rows.map((row) => row.id) } },
          _count: { _all: true },
        })
      : [];
    return { rows, total, chain };
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
