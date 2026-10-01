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
    const [rows, pairings] = await Promise.all([
      this.database.incomingBillingDocument.findMany(),
      this.missing.documentPairings(),
    ]);
    return incomingListResponse(
      rows.map((row) => toIncomingListItem(row, pairings)),
      query,
    );
  }

  @Get("incoming-documents/:id")
  async detail(@Param("id") id: string): Promise<IncomingDocumentDetail> {
    const row = await this.database.incomingBillingDocument.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
    return toIncomingDetail(row, await this.missing.documentPairings());
  }

  /**
   * A számla PDF-je, ha a Számlázz.hu valódi PDF-et küldött (a `pdfszamlabe`
   * regisztrációnál). Élesen 2026-10-01-én 73-ból 5 ilyen; a többinél 404, és a
   * felület a `hasPdf` alapján gombot sem mutat.
   */
  @Get("incoming-documents/:id/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("id") id: string) {
    const row = await this.database.incomingBillingDocument.findUnique({
      where: { id },
      select: { documentNumber: true, sourceDocumentId: true },
    });
    if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
    const source = row.sourceDocumentId
      ? await this.database.incomingSupplierDocument.findUnique({
          where: { id: row.sourceDocumentId },
          select: { content: true },
        })
      : null;
    const content = source ? Buffer.from(source.content) : null;
    if (!content || !content.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC))
      throw new NotFoundException("Ehhez a számlához nem érkezett PDF.");
    const fileName = `${row.documentNumber.replace(/[^\w.-]+/g, "_")}.pdf`;
    return new StreamableFile(content, {
      type: "application/pdf",
      length: content.length,
      disposition: `inline; filename="${fileName}"`,
    });
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
