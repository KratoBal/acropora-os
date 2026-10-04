import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type IncomingDocumentDetail,
  type IncomingDocumentListResponse,
  type ReceiptsResponse,
} from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { IncomingDocumentListQueryDto } from "./dto/incoming-document-list-query.dto.js";
import {
  incomingListResponse,
  toIncomingDetail,
  toIncomingListItem,
} from "./incoming-billing-documents.js";
import {
  collectedPdfIds,
  collectedPdfIndex,
  type CollectedDocument,
} from "./incoming-collected-pdf.js";

const PDF_MAGIC = Buffer.from("%PDF-");

/**
 * A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” ÉS „NYUGTÁK” NÉZETE, CSAK OLVASÁSRA (Balázs
 * újraterv-promptja, acrobot 25869 és 25879). A jog ugyanaz, mint a kimenő
 * listáé: `billing.view`. A banki párosítás a Hiányzó számlák számításából jön,
 * új párosító logika nélkül.
 */
@Controller("billing")
@RequirePermissions(PERMISSIONS.BILLING_VIEW)
export class IncomingBillingDocumentsController {
  private readonly database = prisma;

  constructor(private readonly missing: MissingInvoicesService) {}

  @Get("incoming-documents")
  async list(
    @Query() query: IncomingDocumentListQueryDto,
  ): Promise<IncomingDocumentListResponse> {
    const [rows, pairings, collected] = await Promise.all([
      this.database.incomingBillingDocument.findMany(),
      this.missing.documentPairings(),
      this.collectedIndex(),
    ]);
    return incomingListResponse(
      rows.map((row) =>
        toIncomingListItem(
          row,
          pairings,
          collectedPdfIds(row, collected).length > 0,
        ),
      ),
      query,
    );
  }

  @Get("incoming-documents/:id")
  async detail(@Param("id") id: string): Promise<IncomingDocumentDetail> {
    const row = await this.database.incomingBillingDocument.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
    const [pairings, collected] = await Promise.all([
      this.missing.documentPairings(),
      this.collectedIndex(),
    ]);
    return toIncomingDetail(
      row,
      pairings,
      collectedPdfIds(row, collected).length > 0,
    );
  }

  /**
   * A számla PDF-je. ELŐSZÖR a Számlázz.hu-é, ha valódi PDF-et küldött (a
   * `pdfszamlabe` regisztrációnál; élesen 2026-10-04-én 85-ből 5). Ha nem, a
   * BEGYŰJTÖTT PDF, számlaszám és adószám-törzs szerint párosítva
   * (`incoming-collected-pdf.ts`). Egyik sem: 404, és a felület a `hasPdf`
   * alapján gombot sem mutat.
   */
  @Get("incoming-documents/:id/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("id") id: string) {
    const row = await this.database.incomingBillingDocument.findUnique({
      where: { id },
      select: {
        documentNumber: true,
        supplierTaxNumber: true,
        sourceDocumentId: true,
      },
    });
    if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
    const candidates = [
      ...(row.sourceDocumentId ? [row.sourceDocumentId] : []),
      ...collectedPdfIds(row, await this.collectedIndex()),
    ];
    let content: Buffer | null = null;
    for (const documentId of candidates) {
      const document = await this.database.incomingSupplierDocument.findUnique({
        where: { id: documentId },
        select: { content: true },
      });
      const bytes = document ? Buffer.from(document.content) : null;
      if (bytes && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
        content = bytes;
        break;
      }
    }
    if (!content)
      throw new NotFoundException("Ehhez a számlához nem érkezett PDF.");
    const fileName = `${row.documentNumber.replace(/[^\w.-]+/g, "_")}.pdf`;
    return new StreamableFile(content, {
      type: "application/pdf",
      length: content.length,
      disposition: `inline; filename="${fileName}"`,
    });
  }

  /**
   * A begyűjtött PDF-ek párosítási indexe, a tartalmuk nélkül: csak a kulcsok
   * (számlaszám, adószám) kellenek hozzá. A listánál egy lekérdezés az egész.
   */
  private async collectedIndex() {
    const documents: CollectedDocument[] =
      await this.database.incomingSupplierDocument.findMany({
        where: { fileName: { endsWith: ".pdf", mode: "insensitive" } },
        select: {
          id: true,
          fileName: true,
          createdAt: true,
          textReading: true,
          importResult: true,
        },
      });
    return collectedPdfIndex(documents);
  }

  /**
   * A NYUGTÁK a C szeletig: csak a beérkezett nyugták száma (különböző
   * azonosító, a változatok egyszer számítanak). A sorok mezőit az első valódi
   * köteg auditja után képezzük le; addig nem találunk ki mezőt.
   */
  @Get("receipts")
  async receipts(): Promise<ReceiptsResponse> {
    const received = await this.database.szamlazzFeedMessage.findMany({
      where: { kind: "NYUGTA" },
      distinct: ["externalId"],
      select: { externalId: true },
    });
    return { received: received.length, items: [] };
  }
}
