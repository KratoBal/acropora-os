import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { PartnerOrderDocumentStep } from "@acropora/database";
import {
  PARTNER_ORDER_DOCUMENT_STEPS,
  type AuthenticatedUser,
  type PartnerOrderCandidateDto,
  type PartnerOrderChain,
  type PartnerOrderDetailDto,
  type PartnerOrderDocumentDto,
  type PartnerOrderListResponse,
  type PartnerOrderStatusValue,
  type QuotePriceDisplay,
} from "@acropora/types";

import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { quoteText } from "../quotes/quote-dto.mapper.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "../service-assets/uploaded-file-type.js";
import { decideQuota } from "../service-assets/document-store/document-quota.js";

import { orderTotals, selectOrderItems } from "./partner-order-items.js";
import {
  MAX_DOCUMENTS_PER_ORDER,
  PartnerOrdersRepository,
  type OrderDocumentRow,
  type OrderContentRow,
} from "./partner-orders.repository.js";
import {
  systemDocumentsOf,
  withSystemDocuments,
} from "./partner-order-system-documents.js";

/** `AJ-2026-0042` becomes `MR-2026-0042`: one order per quote, so the quote's number is the order's. */
export function orderNumberFor(quoteNumber: string): string {
  return quoteNumber.startsWith("AJ-")
    ? `MR-${quoteNumber.slice(3)}`
    : `MR-${quoteNumber}`;
}

export function emptyChain(): PartnerOrderChain {
  return Object.fromEntries(
    PARTNER_ORDER_DOCUMENT_STEPS.map((step) => [step, 0]),
  ) as PartnerOrderChain;
}

/**
 * The lines, totals and header facts of the version and acceptance PINNED on the order. `accepted` is false
 * when the quote no longer stands on that acceptance (revoked, or another version accepted): the lines shown
 * are still the signed ones, the page only warns.
 */
export function orderBody(order: OrderContentRow) {
  const version = order.quoteVersion;
  const lines = selectOrderItems(
    version.blocks.flatMap((block) =>
      block.items.map((item) => ({
        id: item.id,
        blockPosition: block.position,
        position: item.position,
        name: item.name,
        description: quoteText(item.description),
        quantity: item.quantity,
        unit: item.unit,
        unitNetPrice: item.unitNetPrice,
        vatRatePercent: item.vatRatePercent,
        isOptional: item.isOptional,
      })),
    ),
    order.acceptance.selectedOptionalItemIds,
    version.currency,
  );
  return {
    accepted:
      order.quote.status === "ACCEPTED" &&
      order.quote.acceptedVersionId === version.id &&
      order.acceptance.revokedAt === null,
    currency: version.currency,
    versionNumber: version.versionNumber,
    priceDisplay: version.priceDisplay as QuotePriceDisplay,
    snapshot:
      version.customerSnapshot && typeof version.customerSnapshot === "object"
        ? (version.customerSnapshot as Record<string, unknown>)
        : null,
    lines,
    totals: orderTotals(lines, version.currency),
  };
}

function snapshotText(
  snapshot: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = snapshot?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** "1234 Város, Utca 1." from the snapshot's parts; the address stays the same on every document. */
function snapshotAddress(snapshot: Record<string, unknown> | null) {
  const street = snapshotText(snapshot, "address");
  const place = [
    snapshotText(snapshot, "postalCode"),
    snapshotText(snapshot, "city"),
  ]
    .filter(Boolean)
    .join(" ");
  const text = [place, street].filter(Boolean).join(", ");
  return text || null;
}

function documentDto(row: OrderDocumentRow): PartnerOrderDocumentDto {
  return {
    id: row.id,
    step: row.step,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedByName: row.uploadedBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class PartnerOrdersService {
  constructor(private readonly repository: PartnerOrdersRepository) {}

  async list(
    page: number,
    pageSize: number,
    filter: { q?: string; status?: PartnerOrderStatusValue },
  ): Promise<PartnerOrderListResponse> {
    const { rows, total, chain } = await this.repository.list(
      page,
      pageSize,
      filter,
    );
    const chains = new Map<string, PartnerOrderChain>();
    for (const entry of chain) {
      const current = chains.get(entry.orderId) ?? emptyChain();
      current[entry.step] = entry._count._all;
      chains.set(entry.orderId, current);
    }
    // the system-made documents count too: the list sees where the chain stands (acrobot 42589)
    const sources = await this.repository.systemDocumentSources(
      rows.map((row) => row.id),
    );
    for (const [orderId, source] of sources)
      chains.set(
        orderId,
        withSystemDocuments(
          chains.get(orderId) ?? emptyChain(),
          systemDocumentsOf(source),
        ),
      );
    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => {
        const body = orderBody(row);
        return {
          id: row.id,
          orderNumber: row.orderNumber,
          quoteId: row.quote.id,
          quoteNumber: row.quote.quoteNumber,
          title: row.quote.title,
          status: row.status,
          customerId: row.customerId,
          customerName: row.customer?.displayName ?? null,
          quoteAccepted: body.accepted,
          netTotal: body.totals.net,
          currency: body.currency,
          chain: chains.get(row.id) ?? emptyChain(),
          createdAt: row.createdAt.toISOString(),
        };
      }),
    };
  }

  async candidates(): Promise<PartnerOrderCandidateDto[]> {
    const rows = await this.repository.candidates();
    return rows.map((row) => ({
      quoteId: row.id,
      quoteNumber: row.quoteNumber,
      title: row.title,
      customerName: row.customer?.displayName ?? null,
      acceptedAt: row.updatedAt.toISOString(),
    }));
  }

  async detail(id: string): Promise<PartnerOrderDetailDto> {
    const row = await this.repository.detail(id);
    if (!row) throw new NotFoundException("A megrendelés nem található.");
    const body = orderBody(row);
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      quoteId: row.quote.id,
      quoteNumber: row.quote.quoteNumber,
      quoteVersionNumber: body.versionNumber,
      quoteAccepted: body.accepted,
      title: row.quote.title,
      currency: body.currency,
      priceDisplay: body.priceDisplay,
      customer: {
        id: row.customerId,
        name: row.customer?.displayName ?? snapshotText(body.snapshot, "name"),
        taxNumber:
          row.customer?.taxNumber ?? snapshotText(body.snapshot, "taxNumber"),
        address: snapshotAddress(body.snapshot),
      },
      lines: body.lines,
      totals: body.totals,
      documents: row.documents.map(documentDto),
      systemDocuments: systemDocumentsOf(
        (await this.repository.systemDocumentSources([row.id])).get(row.id)!,
      ),
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdBy?.displayName ?? null,
    };
  }

  /** Idempotent: a second call for the same quote returns the order that already exists. */
  async createFromQuote(quoteId: string, user: AuthenticatedUser) {
    const quote = await this.repository.quoteForOrder(quoteId);
    if (!quote) throw new NotFoundException("Az ajánlat nem található.");
    if (quote.partnerOrder) return { id: quote.partnerOrder.id };
    if (quote.status !== "ACCEPTED" || !quote.acceptedVersionId)
      throw new ConflictException(
        "Megrendelés csak elfogadott ajánlatból hozható létre.",
      );
    // The acceptance the order stands on: the newest live one given for the accepted version.
    const acceptance = quote.acceptances.find(
      (a) => a.quoteVersionId === quote.acceptedVersionId,
    );
    if (!acceptance)
      throw new ConflictException(
        "Az ajánlat elfogadása nem található, a megrendelés nem hozható létre.",
      );
    try {
      return await this.repository.create({
        orderNumber: orderNumberFor(quote.quoteNumber),
        quoteId: quote.id,
        quoteVersionId: quote.acceptedVersionId,
        acceptanceId: acceptance.id,
        customerId: quote.customerId,
        createdById: user.id,
      });
    } catch (error) {
      // A concurrent second click: the quote's unique key holds, return the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.repository.existingForQuote(quote.id);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async uploadDocument(
    orderId: string,
    step: string,
    file: Express.Multer.File,
    user: AuthenticatedUser,
  ): Promise<PartnerOrderDocumentDto> {
    if (!(PARTNER_ORDER_DOCUMENT_STEPS as readonly string[]).includes(step))
      throw new BadRequestException("Ismeretlen lépés a dokumentumhoz.");
    if (!(await this.repository.orderExists(orderId)))
      throw new NotFoundException("A megrendelés nem található.");
    const kind = detectUploadedFileKind(file.mimetype, file.buffer);
    if (kind === null)
      throw new BadRequestException(
        "Csak érvényes PDF, JPEG vagy PNG fájl tölthető fel.",
      );
    if (
      (await this.repository.documentCount(orderId)) >= MAX_DOCUMENTS_PER_ORDER
    )
      throw new ConflictException(
        `Egy megrendeléshez legfeljebb ${MAX_DOCUMENTS_PER_ORDER} dokumentum csatolható.`,
      );
    const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
    if (Number.isFinite(limitBytes) && limitBytes > 0) {
      const quota = decideQuota({
        usedBytes: await sumDocumentBytesInUse(),
        incomingBytes: file.buffer.length,
        limitBytes,
      });
      if (quota.state === "reject") throw new ConflictException(quota.reason);
    }
    const fileName = file.originalname
      .normalize("NFKC")
      .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
      .slice(0, 180);
    const row = await this.repository.addDocument({
      orderId,
      step: step as PartnerOrderDocumentStep,
      fileName,
      contentType: canonicalMimetypeFor(kind),
      sizeBytes: file.buffer.length,
      content: file.buffer,
      uploadedById: user.id,
    });
    return documentDto(row);
  }

  async document(orderId: string, documentId: string) {
    const document = await this.repository.document(orderId, documentId);
    if (!document) throw new NotFoundException("A dokumentum nem található.");
    if (!document.content)
      throw new ConflictException(
        "A dokumentum tartalma a fájltárolóban van, és innen most nem érhető el.",
      );
    return {
      fileName: document.fileName,
      contentType: document.contentType,
      bytes: Buffer.from(document.content),
    };
  }

  async deleteDocument(orderId: string, documentId: string) {
    const count = await this.repository.deleteDocument(orderId, documentId);
    if (count === 0) throw new NotFoundException("A dokumentum nem található.");
    return { deleted: true };
  }
}
